from __future__ import annotations

import pendulum
import json
import boto3
import os
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

from airflow.decorators import dag, task

# ---- Variables de Entorno ----
DYNAMO_TABLE = os.environ.get("INCIDENTS_TABLE")
S3_BUCKET = os.environ.get("ANALYTICS_BUCKET_NAME")

# --- Tareas de Boto/Python ---


@task
def extract_transform_to_s3(ds_nodash, **kwargs) -> str:
    """
    Extrae todos los incidentes de DynamoDB y los guarda en S3.
    Retorna el prefijo s3 (ej: "s3://bucket/raw_data/year=YYYY/month=MM/day=DD/")
    """
    if not DYNAMO_TABLE or not S3_BUCKET:
        raise ValueError("Error de configuración: Faltan las variables INCIDENTS_TABLE o ANALYTICS_BUCKET_NAME.")

    # 1. Inicializar Clientes de AWS
    dynamodb = boto3.resource("dynamodb")
    s3_client = boto3.client("s3")

    # --- Extracción (E) ---
    print(f"Iniciando escaneo de la tabla {DYNAMO_TABLE}...")

    table = dynamodb.Table(DYNAMO_TABLE)
    response = table.scan()
    incidents_data = response.get("Items", [])

    # Manejar paginación si tu tabla es muy grande
    while "LastEvaluatedKey" in response:
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
        incidents_data.extend(response.get("Items", []))

    print(f"Total de incidentes extraídos: {len(incidents_data)}")

    # --- Transformación (T) ---
    # Serializar los datos a un string JSON.
    data_string = json.dumps(incidents_data, default=str, ensure_ascii=False)

    # --- Carga (L) ---
    year = ds_nodash[:4]
    month = ds_nodash[4:6]
    day = ds_nodash[6:]

    s3_key = f"raw_data/year={year}/month={month}/day={day}/incidents_{ds_nodash}.json"

    s3_client.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=data_string.encode("utf-8"))
    print(f"Datos crudos cargados exitosamente en s3://{S3_BUCKET}/{s3_key}")

    # Retorna el path S3 (prefijo) para que la siguiente tarea lo use
    return f"s3://{S3_BUCKET}/raw_data/year={year}/month={month}/day={day}/"


@task
def run_athena_queries(data_path: str) -> Dict[str, Any]:
    """
    Toma el prefijo devuelto por extract_transform_to_s3 (ej: s3://bucket/raw_data/year=YYYY/.../).
    - Busca el archivo incidents_YYYYMMDD.json dentro de ese prefijo.
    - Lo descarga y ejecuta análisis simples en Python:
      * total_incidents
      * por_categoria
      * por_urgencia
      * por_estado
      * top_locations (si hay campo ubicacion)
      * incidents_per_hour (por createdAt)
    - Devuelve un dict con los resultados que servirá como 'final_results' para store_final_report.
    """
    if not S3_BUCKET:
        raise ValueError("Error de configuración: ANALYTICS_BUCKET_NAME no definido")

    s3 = boto3.client("s3")

    # extraer prefijo relativo (raw_data/.../...) desde data_path
    # data_path suele ser: s3://{BUCKET}/raw_data/year=YYYY/month=MM/day=DD/
    prefix = ""
    if data_path.startswith("s3://"):
        # quitar s3://bucket/
        parts = data_path.split("/", 3)
        if len(parts) >= 4:
            prefix = parts[3]
        else:
            prefix = ""
    else:
        prefix = data_path.lstrip("/")

    # listar objetos con este prefijo y encontrar un incidents_*.json
    resp = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=prefix, MaxKeys=100)
    items = resp.get("Contents", []) if resp else []
    target_key: Optional[str] = None
    for it in items:
        key = it.get("Key", "")
        if "incidents_" in key and key.endswith(".json"):
            target_key = key
            break

    if not target_key:
        # fallback: intentar listar sin prefijo directo en raw_data/ (por si data_path no coincide)
        fallback = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix="raw_data/", MaxKeys=100)
        for it in fallback.get("Contents", []):
            key = it.get("Key", "")
            if "incidents_" in key and key.endswith(".json"):
                target_key = key
                break

    if not target_key:
        raise FileNotFoundError("No se encontró archivo incidents_YYYYMMDD.json en el prefijo proporcionado")

    print(f"run_athena_queries - leyendo clave S3: {target_key}")

    obj = s3.get_object(Bucket=S3_BUCKET, Key=target_key)
    raw = obj["Body"].read()
    text = raw.decode("utf-8")
    try:
        incidents: List[Dict[str, Any]] = json.loads(text)
    except Exception as e:
        # si el JSON no es parseable, devolver vacío y registrar el error
        print("Error parseando JSON desde S3:", e)
        incidents = []

    # --- ANALISIS SIMPLE (en memoria) ---
    total = len(incidents)
    by_categoria = Counter()
    by_urgencia = Counter()
    by_estado = Counter()
    ubicaciones = Counter()
    per_hour = Counter()

    for inc in incidents:
        # categorias: normalizar campo 'categoria'
        cat = inc.get("categoria") or inc.get("category") or "sin_categoria"
        by_categoria[str(cat)] += 1

        urg = inc.get("urgencia") or inc.get("prioridad") or inc.get("urgency") or "medio"
        by_urgencia[str(urg)] += 1

        estado = inc.get("estado") or inc.get("status") or "pendiente"
        by_estado[str(estado)] += 1

        ubic = inc.get("ubicacion")
        if isinstance(ubic, dict):
            # formar un label con texto si hay 'nombre' o lat/lng
            if ubic.get("nombre"):
                loclabel = str(ubic.get("nombre"))
            else:
                lat = ubic.get("lat") or ubic.get("latitude")
                lng = ubic.get("lng") or ubic.get("longitude")
                loclabel = f"{lat},{lng}" if lat is not None and lng is not None else "sin_ubicacion"
        else:
            loclabel = str(ubic or "sin_ubicacion")
        ubicaciones[loclabel] += 1

        # hora de createdAt (si existe)
        created = inc.get("createdAt") or inc.get("created_at") or inc.get("creadoEn")
        if created:
            try:
                dt = pendulum.parse(str(created))
                per_hour[str(dt.hour).zfill(2)] += 1
            except Exception:
                per_hour["unknown"] += 1
        else:
            per_hour["unknown"] += 1

    # construir resultados como estructuras serializables
    results = {
        "source_key": target_key,
        "total_incidents": total,
        "by_categoria": dict(by_categoria),
        "by_urgencia": dict(by_urgencia),
        "by_estado": dict(by_estado),
        "top_locations": ubicaciones.most_common(20),
        "incidents_per_hour": dict(per_hour)
    }

    print("run_athena_queries - análisis completado", {"total": total, "source": target_key})
    return results


@task
def store_final_report(final_data: Dict[str, Any], ds_nodash: Optional[str] = None) -> str:
    """
    Guarda el JSON final en S3 para el consumo de la API.
    - final_data: diccionario con resultados del análisis
    - Guarda dos archivos en la carpeta del día correspondiente:
      1) raw_data/year=YYYY/month=MM/day=DD/latest_report_{YYYYMMDD}.json  (versión con fecha)
      2) raw_data/year=YYYY/month=MM/day=DD/latest_report.json            (alias siempre actualizado dentro de la carpeta del día)
    Retorna la key del archivo con fecha (ej: 'reports/year=.../latest_report_YYYYMMDD.json').
    """
    if not S3_BUCKET:
        raise ValueError("Error de configuración: ANALYTICS_BUCKET_NAME no definido")

    if not ds_nodash:
        raise ValueError("ds_nodash no recibido por Airflow")

    s3 = boto3.client("s3")

    year = ds_nodash[:4]
    month = ds_nodash[4:6]
    day = ds_nodash[6:]

    folder = f"raw_data/year={year}/month={month}/day={day}"
    key_with_date = f"{folder}/latest_report_{ds_nodash}.json"
    key_latest = f"{folder}/latest_report.json"

    payload = {
        "generated_at": pendulum.now("UTC").to_iso8601_string(),
        "summary": final_data
    }
    payload_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    # Guardar la versión con fecha
    s3.put_object(Bucket=S3_BUCKET, Key=key_with_date, Body=payload_bytes, ContentType="application/json; charset=utf-8")
    # Guardar alias latest dentro de la carpeta del día
    s3.put_object(Bucket=S3_BUCKET, Key=key_latest, Body=payload_bytes, ContentType="application/json; charset=utf-8")

    print(f"store_final_report - guardados: s3://{S3_BUCKET}/{key_with_date}  y s3://{S3_BUCKET}/{key_latest}")
    return key_with_date

# --- Definición del DAG ---

@dag(
    dag_id="analisis_incidencias_diario",
    start_date=pendulum.datetime(2025, 11, 1, tz="UTC"),
    schedule="0 2 * * *",  # Ejecuta todos los días a las 2 AM (Cada Día)
    catchup=False,         # No ejecutar para fechas pasadas
    tags=["etl", "analisis"],
)
def analisis_utec_dag():

    # 1. Extraer, Transformar y Cargar a S3
    s3_data_path = extract_transform_to_s3()

    # 2. Ejecutar consultas/analisis sobre S3 (aquí en Python)
    final_results = run_athena_queries(s3_data_path)

    # 3. Guardar el reporte final en S3 (se inyecta ds_nodash automáticamente)
    store_final_report(final_results)

# Instancia el DAG
analisis_utec_dag()