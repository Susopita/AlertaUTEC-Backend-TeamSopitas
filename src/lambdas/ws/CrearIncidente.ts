// src/handlers/crearIncidente.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import * as jwt from "jsonwebtoken";

const REGION = process.env.AWS_REGION || "us-east-1";
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE!;
const PRIORITY_COUNTERS_TABLE = process.env.PRIORITY_COUNTERS_TABLE!; // requerido si no envían IndexPrioridad
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "";
const JWT_SECRET = process.env.JWT_SECRET || "";

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const eb = new EventBridgeClient({ region: REGION });

type User = { userId?: string; role?: string };

/** Extrae usuario: preferir requestContext.authorizer; fallback decodificar (solo dev) */
function getUser(event: APIGatewayProxyEvent): User | null {
  const auth = (event as any)?.requestContext?.authorizer;
  const claims = auth?.jwt?.claims || auth?.claims;
  if (claims) {
    return {
      userId: claims.sub || claims["username"],
      role: (claims["cognito:groups"] || claims["role"] || claims["custom:role"] || "")
        .toString()
        .toLowerCase()
    };
  }
  const header = event.headers?.Authorization || event.headers?.authorization;
  if (header && header.startsWith("Bearer ") && JWT_SECRET) {
    try {
      const token = header.split(" ")[1];
      const payload = jwt.verify(token, JWT_SECRET) as any;
      return { userId: payload.sub || payload.userId, role: (payload.role || "").toLowerCase() };
    } catch {
      return null;
    }
  }
  return null;
}

/** Normaliza urgencia a 'alto'|'medio'|'bajo' o devuelve null si inválida */
function normalizeUrgencia(v: any): "alto" | "medio" | "bajo" | null {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (["alto", "high", "critico", "crítico"].includes(s)) return "alto";
  if (["medio", "medium"].includes(s)) return "medio";
  if (["bajo", "low"].includes(s)) return "bajo";
  return null;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const user = getUser(event);
    if (!user?.userId) {
      return { statusCode: 401, body: JSON.stringify({ message: "No autorizado: token faltante o inválido" }) };
    }
    if ((user.role ?? "") !== "estudiante") {
      return { statusCode: 403, body: JSON.stringify({ message: "No autorizado: rol debe ser estudiante" }) };
    }

    if (!event.body) {
      return { statusCode: 400, body: JSON.stringify({ message: "Body vacío" }) };
    }
    const body = JSON.parse(event.body);

    // validaciones básicas
    if (!body.descripcion || !body.categoria) {
      return { statusCode: 400, body: JSON.stringify({ message: "Faltan campos obligatorios: descripcion o categoria" }) };
    }

    // obtener/normalizar urgencia (compatibilidad con campos previos)
    const urg = normalizeUrgencia(body.urgencia || body.prioridad || body.prioridadNivel);
    if (!urg) {
      return { statusCode: 400, body: JSON.stringify({ message: "Campo 'urgencia' inválido. Debe ser: alto, medio o bajo" }) };
    }

    // si envían IndexPrioridad lo validamos; si no, generamos uno atómico desde PRIORITY_COUNTERS_TABLE
    let IndexPrioridad: number | null = null;
    if (body.IndexPrioridad !== undefined && body.IndexPrioridad !== null) {
      const v = Number(body.IndexPrioridad);
      if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
        return { statusCode: 400, body: JSON.stringify({ message: "IndexPrioridad debe ser entero >= 0" }) };
      }
      IndexPrioridad = v;
      // nota: usar IndexPrioridad manual puede producir colisiones; se espera usar funciones de priorización para reordenar
    } else {
      // generamos índice atómico por urgencia usando PRIORITY_COUNTERS_TABLE
      if (!PRIORITY_COUNTERS_TABLE) {
        return { statusCode: 500, body: JSON.stringify({ message: "Error interno: falta configuración PRIORITY_COUNTERS_TABLE" }) };
      }

      const counterKey = { urgencia: urg };
      const updateCounterParams = {
        TableName: PRIORITY_COUNTERS_TABLE,
        Key: counterKey,
        UpdateExpression: "SET #last = if_not_exists(#last, :zero) + :inc",
        ExpressionAttributeNames: { "#last": "last" },
        ExpressionAttributeValues: { ":inc": 1, ":zero": 0 },
        ReturnValues: "UPDATED_NEW"
      };

      // UpdateCommand typing for doc client — usar any para evitar TS estricto
      // safe/workable
        const counterResp: any = await ddb.send(new UpdateCommand(updateCounterParams as any));
        const IndexPrioridad = counterResp?.Attributes?.last;
      if (IndexPrioridad == null) {
        return { statusCode: 500, body: JSON.stringify({ message: "Error generando IndexPrioridad" }) };
      }
    }

    const now = new Date().toISOString();
    const incidenciaId = uuidv4();

    const item = {
      incidenciaId,
      estado: "pendiente",               // 'pendiente' | 'en_atencion' | 'resuelto'
      urgencia: urg,                     // 'alto'|'medio'|'bajo'
      IndexPrioridad,                    // entero
      descripcion: body.descripcion,
      categoria: body.categoria,
      ubicacion: body.ubicacion || null,
      reportadoPor: user.userId,
      asignadoA: body.asignadoA || null,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    await ddb.send(new PutCommand({ TableName: INCIDENTS_TABLE, Item: item }));

    // publicar evento (opcional)
    if (EVENT_BUS_NAME) {
      try {
        await eb.send(new PutEventsCommand({
          Entries: [
            {
              EventBusName: EVENT_BUS_NAME,
              Source: "alertautec.incidents",
              DetailType: "IncidenteCreado",
              Detail: JSON.stringify({ incidente: item })
            }
          ]
        }));
      } catch (evErr) {
        console.warn("Advertencia: no se pudo publicar evento en EventBridge", evErr);
      }
    }

    return {
      statusCode: 201,
      body: JSON.stringify({ mensaje: "Incidente creado", incidenciaId, urgencia: urg, IndexPrioridad })
    };
  } catch (err: any) {
    console.error("crearIncidente error:", err);
    return { statusCode: 500, body: JSON.stringify({ message: "Error interno", error: err?.message }) };
  }
};
