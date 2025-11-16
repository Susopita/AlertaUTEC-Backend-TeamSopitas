// src/handlers/atenderIncidente.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import * as jwt from "jsonwebtoken";

const REGION = process.env.AWS_REGION || "us-east-1";
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE!;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "";
const JWT_SECRET = process.env.JWT_SECRET || "";

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const eb = new EventBridgeClient({ region: REGION });

type JwtUser = { userId?: string; role?: string; email?: string };

/** Extrae usuario: preferir requestContext.authorizer; fallback decodificar token (solo dev) */
function getUserFromEvent(event: any): JwtUser {
  const ctx = event?.requestContext ?? {};
  const auth = ctx.authorizer;
  const jwtClaims = auth?.jwt?.claims || auth?.claims;
  if (jwtClaims) {
    return {
      userId: jwtClaims.sub || jwtClaims["username"],
      role: (jwtClaims["cognito:groups"] || jwtClaims["role"] || jwtClaims["custom:role"] || "")
        .toString()
        .toLowerCase(),
      email: jwtClaims.email
    };
  }

  // Fallback (solo desarrollo): decodificar token sin verificar firma
  const authHeader = event?.headers?.Authorization || event?.headers?.authorization;
  if (authHeader && authHeader.startsWith("Bearer ") && JWT_SECRET) {
    try {
      const token = authHeader.split(" ")[1];
      const payload = jwt.verify(token, JWT_SECRET) as any;
      return {
        userId: payload.sub || payload.userId || payload.uid,
        role: (payload.role || payload["custom:role"] || "").toString().toLowerCase(),
        email: payload.email
      };
    } catch {
      // invalid token
    }
  }

  return {};
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('[AtenderIncidente] Lambda invocada');
    if (!INCIDENTS_TABLE) {
      console.error('[AtenderIncidente] Falta configuración: INCIDENTS_TABLE');
      return { statusCode: 500, body: JSON.stringify({ message: "Error interno: configuración" }) };
    }

    const user = getUserFromEvent(event);
    if (!user.userId) {
      console.warn('[AtenderIncidente] No autorizado: token faltante o inválido');
      return { statusCode: 401, body: JSON.stringify({ message: "No autorizado: token faltante o inválido" }) };
    }

    // Solo admins/autoridad pueden atender incidentes
    const role = (user.role || "").toString().toLowerCase();
    if (!["admin", "autoridad"].includes(role)) {
      console.warn('[AtenderIncidente] No autorizado: rol insuficiente');
      return { statusCode: 403, body: JSON.stringify({ message: "No autorizado: rol insuficiente" }) };
    }

    if (!event.body) {
      console.warn('[AtenderIncidente] Body vacío');
      return { statusCode: 400, body: JSON.stringify({ message: "Body vacío" }) };
    }

    const body = JSON.parse(event.body);
    const incidenciaId = body.incidenciaId || body.incidentId || body.id;
    if (!incidenciaId) {
      console.warn('[AtenderIncidente] Falta incidenciaId');
      return { statusCode: 400, body: JSON.stringify({ message: "Falta incidenciaId" }) };
    }

    // Opcional: assigned override, por defecto el actor que atiende
    const assignedOverride = body.asignadoA ?? body.asignadoPor ?? null;
    const assignedTo = assignedOverride || user.userId;

    // Verificar que el incidente exista
    const getResp = await ddb.send(new GetCommand({ TableName: INCIDENTS_TABLE, Key: { incidenciaId } }));
    if (!getResp.Item) {
      console.warn('[AtenderIncidente] Incidente no encontrado');
      return { statusCode: 404, body: JSON.stringify({ message: "Incidente no encontrado" }) };
    }

    // Construir update: estado='en_atencion', asignadoA, updatedAt, version++
    const now = new Date().toISOString();
    const ExpressionAttributeNames: Record<string, string> = {
      "#estado": "estado",
      "#asignadoA": "asignadoA",
      "#updatedAt": "updatedAt",
      "#version": "version"
    };
    const ExpressionAttributeValues: Record<string, any> = {
      ":estado": "en_atencion",
      ":assigned": assignedTo,
      ":updatedAt": now,
      ":inc": 1,
      ":zero": 0,
      ":pendiente": "pendiente"
    };

    const UpdateExpression =
      "SET #estado = :estado, #asignadoA = :assigned, #updatedAt = :updatedAt, #version = if_not_exists(#version, :zero) + :inc";

    // Condición: solo pasar a 'en_atencion' si actualmente está 'pendiente'
    const params: any = {
      TableName: INCIDENTS_TABLE,
      Key: { incidenciaId },
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ConditionExpression: "#estado = :pendiente",
      ReturnValues: "ALL_NEW"
    };

    let updateResp: any;
    try {
      updateResp = await ddb.send(new UpdateCommand(params as any));
    } catch (e: any) {
      if (e?.name === "ConditionalCheckFailedException") {
        return {
          statusCode: 409,
          body: JSON.stringify({
            message: "Conflicto: el incidente no está en estado 'pendiente' o condición no se cumple"
          })
        };
      }
      throw e;
    }

    const newItem = updateResp.Attributes;

    // Publicar evento IncidenteEnAtencion
    if (EVENT_BUS_NAME) {
      try {
        await eb.send(new PutEventsCommand({
          Entries: [
            {
              EventBusName: EVENT_BUS_NAME,
              Source: "alertautec.incidents",
              DetailType: "IncidenteEnAtencion",
              Detail: JSON.stringify({ incidenciaId, actor: user.userId, assignedTo, item: newItem })
            }
          ]
        }));
      } catch (evErr) {
        console.warn("Advertencia: no se pudo publicar evento en EventBridge", evErr);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ mensaje: "Incidente en atención", item: newItem }) };
  } catch (err: any) {
    console.error("atenderIncidente error:", err);
    return { statusCode: 500, body: JSON.stringify({ message: "Error interno", error: err?.message }) };
  }
};
