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
const BUCKET = process.env.ANALYTICS_BUCKET_NAME || process.env.S3_BUCKET || "";
if (!BUCKET) {
  console.warn("WARNING: ANALYTICS_BUCKET_NAME no está configurado en las env vars");
}

const s3 = new S3Client({ region: REGION });
const pipeline = promisify(stream.pipeline);

async function streamToString(readable: any): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Construye la key esperada si el usuario pasa date=YYYYMMDD */
function keyForDate(ds_nodash: string) {
  const year = ds_nodash.slice(0, 4);
  const month = ds_nodash.slice(4, 6);
  const day = ds_nodash.slice(6, 8);
  return `raw_data/year=${year}/month=${month}/day=${day}/incidents_${ds_nodash}.json`;
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
    const resp: ListObjectsV2CommandOutput = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000
    }));

    const items = resp.Contents || [];
    for (const item of items) {
      const key = item.Key;
      const dateStr = extractDateFromKey(key);
      if (!dateStr) continue;
      // dateStr is YYYYMMDD -> lexicographically comparable
      if (!newestDate || dateStr > newestDate) {
        newestDate = dateStr;
        newestKey = key || null;
      } else if (dateStr === newestDate) {
        // tie-breaker: prefer the one with later LastModified if available
        const candTime = item.LastModified ? new Date(item.LastModified).getTime() : 0;
        // find existing item LastModified by listing again not efficient; skip tie-break usually unnecessary
      }
    }

    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return newestKey;
}

/**
 * Lambda handler: devuelve el JSON del reporte.
 * Query params:
 *  - date=YYYYMMDD (opcional)
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log("obtenerReporte - inicio", { path: event.path, query: event.queryStringParameters });

  try {
    if (!BUCKET) {
      console.error("Configuración faltante: ANALYTICS_BUCKET_NAME");
      return { statusCode: 500, body: JSON.stringify({ message: "Error interno: configuración S3" }) };
    }

    const dateParam = event.queryStringParameters?.date;
    let keyToGet: string | null = null;

    if (dateParam) {
      if (!/^\d{8}$/.test(dateParam)) {
        return { statusCode: 400, body: JSON.stringify({ message: "Parámetro 'date' inválido. Formato esperado: YYYYMMDD" }) };
      }
      keyToGet = keyForDate(dateParam);
      console.log("obtenerReporte - intentando key por fecha", { dateParam, keyToGet });
      // verificar existencia con HeadObject para dar 404 si no existe
      try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: keyToGet }));
      } catch (headErr: any) {
        console.warn("HeadObject falló para key por fecha; no encontrado", { keyToGet, err: headErr?.name || headErr?.message });
        return { statusCode: 404, body: JSON.stringify({ message: "Reporte no encontrado para la fecha solicitada" }) };
      }
    } else {
      // Sin fecha: buscamos el último archivo incidents_YYYYMMDD.json por nombre (fecha en el filename)
      console.log("obtenerReporte - buscando último incidents_YYYYMMDD.json en S3 (paginar ListObjectsV2)");
      const latestKey = await findLatestIncidentsKey("raw_data/");
      if (!latestKey) {
        console.warn("obtenerReporte - no se encontró ningún archivo incidents_YYYYMMDD.json en el bucket");
        return { statusCode: 404, body: JSON.stringify({ message: "No hay reportes disponibles" }) };
      }
      keyToGet = latestKey;
      console.log("obtenerReporte - key más reciente encontrada por fecha en nombre:", { keyToGet });
    }

    // Obtener objeto
    console.log("obtenerReporte - getObject", { Bucket: BUCKET, Key: keyToGet });
    const getResp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: keyToGet! }));
    if (!getResp.Body) {
      console.error("obtenerReporte - objeto sin Body", { Key: keyToGet });
      return { statusCode: 500, body: JSON.stringify({ message: "Error interno leyendo el reporte" }) };
    }

    const bodyString = await streamToString(getResp.Body as any);
    // Intentar parsear JSON; si falla, devolver como texto
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
