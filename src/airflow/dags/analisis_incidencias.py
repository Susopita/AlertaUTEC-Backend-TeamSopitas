from __future__ import annotations

import pendulum
import json 
import boto3
import os

from airflow.decorators import dag, task

# ---- Variables de Entorno ----
DYNAMO_TABLE = os.environ.get("INCIDENTS_TABLE")
S3_BUCKET = os.environ.get("ANALYTICS_BUCKET_NAME")

# --- Tareas de Boto/Python (simuladas) ---

@task
def extract_transform_to_s3(ds_nodash, **kwargs):
    """
    Extrae todos los incidentes de DynamoDB y los guarda en S3.
    
    :param ds_nodash: Fecha de ejecución del DAG en formato YYYYMMDD (provisto por Airflow).
    :param kwargs: Contiene el contexto de Airflow.
    """

    if not DYNAMO_TABLE or not S3_BUCKET:
        raise ValueError("Error de configuración: Faltan las variables INCIDENTS_TABLE o ANALYTICS_BUCKET_NAME.")
    
    # 1. Inicializar Clientes de AWS
    dynamodb = boto3.resource('dynamodb')
    s3_client = boto3.client('s3')
    
    # --- Extracción (E) ---
    print(f"Iniciando escaneo de la tabla {DYNAMO_TABLE}...")
    
    # Airflow no es para tiempo real; escanearemos toda la tabla o una parte grande.
    table = dynamodb.Table(DYNAMO_TABLE)
    response = table.scan()
    incidents_data = response['Items']
    
    # Manejar paginación si tu tabla es muy grande (omisión por simplicidad)
    while 'LastEvaluatedKey' in response:
        response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
        incidents_data.extend(response['Items'])

    print(f"Total de incidentes extraídos: {len(incidents_data)}")

    # --- Transformación (T) ---
    # Serializar los datos a un string JSON. 
    # El default=str maneja fechas y decimales de DynamoDB.
    data_string = json.dumps(incidents_data, default=str)
    
    # --- Carga (L) ---
    # Creamos un path particionado por fecha (YYYY/MM/DD) en S3.
    # Esto es CRUCIAL para que Athena sea eficiente y barato.
    year = ds_nodash[:4]
    month = ds_nodash[4:6]
    day = ds_nodash[6:]
    
    s3_key = f"raw_data/year={year}/month={month}/day={day}/incidents_{ds_nodash}.json"
    
    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=s3_key,
        Body=data_string
    )
    
    print(f"Datos crudos cargados exitosamente en s3://{S3_BUCKET}/{s3_key}")
    
    # Retorna el path de la carpeta para que la siguiente tarea lo use
    return f"s3://{S3_BUCKET}/raw_data/year={year}/month={month}/day={day}/"

@task
def run_athena_queries(data_path: str):
    """Ejecuta Athena sobre los datos en S3."""
    # Aquí iría tu código Python/boto3 para:
    # 1. Definir o cargar tus queries de análisis.
    # 2. Ejecutar las consultas usando el cliente de Athena.
    print(f"Ejecutando Athena sobre {data_path}")
    return {"query1": "resultado_json1", "query2": "resultado_json2"}

@task
def store_final_report(final_data: dict):
    """Guarda el JSON final en S3 para el consumo de la API."""
    # Aquí iría tu código Python/boto3 para:
    # 1. Formatear 'final_data' como el JSON que tu API necesita.
    # 2. Guardar ese JSON en una ruta fija de S3 (ej. 'latest_report.json')
    #    para que tu API solo tenga que descargarlo.
    print("Reporte final en formato JSON guardado en S3.")
    
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
    
    # 2. Ejecutar consultas de Athena sobre S3
    final_results = run_athena_queries(s3_data_path)
    
    # 3. Guardar el reporte final en S3
    store_final_report(final_results)

# Instancia el DAG
analisis_utec_dag()