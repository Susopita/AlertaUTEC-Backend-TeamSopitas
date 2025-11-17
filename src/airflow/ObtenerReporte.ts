// src/handlers/obtenerReporte.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  ListObjectsV2CommandOutput
} from "@aws-sdk/client-s3";
import stream from "stream";
import { promisify } from "util";

const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.ANALYTICS_BUCKET_NAME || "";
if (!BUCKET) {
  console.warn("WARNING: ANALYTICS_BUCKET_NAME no está configurado en las env vars");
}

const s3 = new S3Client({ region: REGION });
//const pipeline = promisify(stream.pipeline);

async function streamToString(readable: any): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Construye la key del raw file (antes de Athena) */
function keyForRawDate(ds_nodash: string) {
  const year = ds_nodash.slice(0, 4);
  const month = ds_nodash.slice(4, 6);
  const day = ds_nodash.slice(6, 8);
  return `raw_data/year=${year}/month=${month}/day=${day}/incidents_${ds_nodash}.json`;
}

/** Construye las keys de summary (después de Athena) dentro de la carpeta del día */
function keyForSummaryDate(ds_nodash: string) {
  const year = ds_nodash.slice(0, 4);
  const month = ds_nodash.slice(4, 6);
  const day = ds_nodash.slice(6, 8);
  const folder = `raw_data/year=${year}/month=${month}/day=${day}`;
  return {
    dated: `${folder}/latest_report_${ds_nodash}.json`,
    alias: `${folder}/latest_report.json`
  };
}

/** Extrae YYYYMMDD desde un key que contenga 'incidents_YYYYMMDD.json', o null */
function extractDateFromKey(key: string | undefined): string | null {
  if (!key) return null;
  const m = key.match(/incidents_(\d{8})\.json/);
  return m?.[1] ?? null;
}

/**
 * Lista objetos con paginación y devuelve el key del archivo incidents_YYYYMMDD.json
 * con la fecha más reciente encontrada.
 */
async function findLatestIncidentsKey(prefix = "raw_data/"): Promise<string | null> {
  let continuationToken: string | undefined = undefined;
  let newestDate: string | null = null;
  let newestKey: string | null = null;

  do {
    const resp: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000
      })
    );

    const items = resp.Contents || [];
    for (const item of items) {
      const key = item.Key;
      const dateStr = extractDateFromKey(key);
      if (!dateStr) continue;
      // YYYYMMDD lexicográficamente comparable
      if (!newestDate || dateStr > newestDate) {
        newestDate = dateStr;
        newestKey = key || null;
      }
    }

    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return newestKey;
}

/**
 * Lambda handler: devuelve el JSON pedido.
 *
 * Query params:
 *  - date=YYYYMMDD (opcional)
 *  - file=raw|summary (opcional, default=summary)
 *
 * Comportamiento:
 *  - Si file=summary: intenta devolver summary (latest_report_{date}.json),
 *    si no existe intenta alias latest_report.json en la carpeta del día,
 *    si tampoco existe devuelve 404 (pero intenta fallback al raw si quieres cambiar ese comportamiento).
 *  - Si file=raw: devuelve incidents_YYYYMMDD.json (raw dump).
 *  - Si no hay date, se infiere la última fecha válida buscando el último incidents_*.json.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log("obtenerReporte - inicio", { path: event.path, query: event.queryStringParameters });

  try {
    if (!BUCKET) {
      console.error("Configuración faltante: ANALYTICS_BUCKET_NAME");
      return { statusCode: 500, body: JSON.stringify({ message: "Error interno: configuración S3" }) };
    }

    const dateParam = event.queryStringParameters?.date;
    const fileParam = (event.queryStringParameters?.file || "summary").toLowerCase(); // 'raw' | 'summary'
    let dateToUse = dateParam;
    let keyToGet: string | null = null;

    // si no se pasa fecha, buscamos la última fecha disponible por nombre de raw file
    if (!dateToUse) {
      console.log("obtenerReporte - date no proporcionada, buscando último incidents_YYYYMMDD.json");
      const latestIncKey = await findLatestIncidentsKey("raw_data/");
      if (!latestIncKey) {
        console.warn("obtenerReporte - no se encontró ningún incidents_YYYYMMDD.json en el bucket");
        return { statusCode: 404, body: JSON.stringify({ message: "No hay reportes disponibles" }) };
      }
      const inferred = extractDateFromKey(latestIncKey);
      if (!inferred) {
        console.warn("obtenerReporte - no se pudo inferir fecha desde key:", latestIncKey);
        return { statusCode: 404, body: JSON.stringify({ message: "No hay reportes disponibles" }) };
      }
      dateToUse = inferred;
      console.log("obtenerReporte - fecha inferida:", dateToUse);
    }

    // validar formato de fecha
    if (!/^\d{8}$/.test(dateToUse)) {
      return { statusCode: 400, body: JSON.stringify({ message: "Parámetro 'date' inválido. Formato esperado: YYYYMMDD" }) };
    }

    if (fileParam === "raw") {
      keyToGet = keyForRawDate(dateToUse);
      console.log("obtenerReporte - solicitando raw:", { dateToUse, keyToGet });
      try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: keyToGet }));
      } catch (headErr: any) {
        console.warn("HeadObject falló para raw key; no encontrado", { keyToGet, err: headErr?.name || headErr?.message });
        return { statusCode: 404, body: JSON.stringify({ message: "Raw report no encontrado para la fecha solicitada" }) };
      }
    } else {
      // summary
      const { dated: keyDated, alias: keyAlias } = keyForSummaryDate(dateToUse);
      console.log("obtenerReporte - solicitando summary (primero dated luego alias)", { dateToUse, keyDated, keyAlias });

      // intentar fecha con nombre dated
      try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: keyDated }));
        keyToGet = keyDated;
        console.log("obtenerReporte - summary dated encontrado", { keyToGet });
      } catch {
        // intentar alias en la carpeta del día
        try {
          await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: keyAlias }));
          keyToGet = keyAlias;
          console.log("obtenerReporte - summary alias encontrado", { keyToGet });
        } catch {
          // no se encontró summary; opcional: fallback al raw (aquí decidimos devolver 404)
          console.warn("obtenerReporte - no se encontró summary para la fecha solicitada");
          return { statusCode: 404, body: JSON.stringify({ message: "Reporte reducido (summary) no encontrado para la fecha solicitada" }) };
        }
      }
    }

    // Obtener objeto desde S3
    console.log("obtenerReporte - getObject", { Bucket: BUCKET, Key: keyToGet });
    const getResp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: keyToGet! }));
    if (!getResp.Body) {
      console.error("obtenerReporte - objeto sin Body", { Key: keyToGet });
      return { statusCode: 500, body: JSON.stringify({ message: "Error interno leyendo el reporte" }) };
    }

    const bodyString = await streamToString(getResp.Body as any);

    // Intentar parsear JSON; si falla, devolver como texto crudo
    try {
      const parsed = JSON.parse(bodyString);
      console.log("obtenerReporte - exitoso, tamaño (bytes)", Buffer.byteLength(bodyString, "utf8"));
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyToGet, data: parsed })
      };
    } catch (parseErr) {
      console.warn("obtenerReporte - parse JSON falló, devolviendo texto crudo", { err: (parseErr as any).message });
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/plain" },
        body: bodyString
      };
    }
  } catch (err: any) {
    console.error("obtenerReporte - error fatal:", { message: err?.message, stack: err?.stack });
    return { statusCode: 500, body: JSON.stringify({ message: "Error interno", error: err?.message }) };
  }
};
