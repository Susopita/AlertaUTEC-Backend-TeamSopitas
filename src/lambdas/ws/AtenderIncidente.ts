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

/** Extrae usuario */
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
      // ignore
    }
  }

  return {};
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log("=== atenderIncidente Invocado ===");
  console.log("Headers:", event.headers);
  console.log("Body recibido:", event.body);

  try {
    if (!INCIDENTS_TABLE) {
      console.error("Falta configuración: INCIDENTS_TABLE");
      return { statusCode: 500, body: JSON.stringify({ message: "Error interno: configuración" }) };
    }

    const user = getUserFromEvent(event);
    console.log("Usuario autenticado:", user);

    if (!user.userId) {
      console.warn("Token inválido o faltante");
      return { statusCode: 401, body: JSON.stringify({ message: "No autorizado: token faltante o inválido" }) };
    }

    const role = (user.role || "").toString().toLowerCase();
    console.log("Rol detectado:", role);
    if (!["admin", "autoridad"].includes(role)) {
      console.warn("Intento de atender por rol no autorizado:", role);
      return { statusCode: 403, body: JSON.stringify({ message: "No autorizado: rol insuficiente" }) };
    }

    if (!event.body) {
      console.warn("Body vacío");
      return { statusCode: 400, body: JSON.stringify({ message: "Body vacío" }) };
    }

    const body = JSON.parse(event.body);
    console.log("Body parseado:", body);

    const incidenciaId = body.incidenciaId || body.incidentId || body.id;
    if (!incidenciaId) {
      console.warn("incidenciaId faltante en body");
      return { statusCode: 400, body: JSON.stringify({ message: "Falta incidenciaId" }) };
    }

    const assignedOverride = body.asignadoA ?? body.asignadoPor ?? null;
    const assignedTo = assignedOverride || user.userId;
    console.log("AsignadoA:", assignedTo);

    // Obtener incidente
    console.log("Consultando incidente:", incidenciaId);
    const getResp = await ddb.send(new GetCommand({ TableName: INCIDENTS_TABLE, Key: { incidenciaId } }));

    console.log("Resultado GetCommand:", getResp);

    if (!getResp.Item) {
      console.warn("Incidente no encontrado:", incidenciaId);
      return { statusCode: 404, body: JSON.stringify({ message: "Incidente no encontrado" }) };
    }

    // Construir update
    const now = new Date().toISOString();
    const ExpressionAttributeNames = {
      "#estado": "estado",
      "#asignadoA": "asignadoA",
      "#updatedAt": "updatedAt",
      "#version": "version"
    };
    const ExpressionAttributeValues = {
      ":estado": "en_atencion",
      ":assigned": assignedTo,
      ":updatedAt": now,
      ":inc": 1,
      ":zero": 0,
      ":pendiente": "pendiente"
    };

    const UpdateExpression =
      "SET #estado = :estado, #asignadoA = :assigned, #updatedAt = :updatedAt, #version = if_not_exists(#version, :zero) + :inc";

    const params: any = {
      TableName: INCIDENTS_TABLE,
      Key: { incidenciaId },
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ConditionExpression: "#estado = :pendiente",
      ReturnValues: "ALL_NEW"
    };

    console.log("UpdateCommand params:", params);

    let updateResp: any;
    try {
      updateResp = await ddb.send(new UpdateCommand(params as any));
      console.log("UpdateCommand resultado:", updateResp);
    } catch (e: any) {
      console.error("Error en UpdateCommand:", e);

      if (e?.name === "ConditionalCheckFailedException") {
        console.warn("No se pudo actualizar: condición fallida (no estaba pendiente)");
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

    // Publicar evento
    if (EVENT_BUS_NAME) {
      console.log("Enviando evento IncidenteEnAtencion a EventBridge");
      try {
        await eb.send(
          new PutEventsCommand({
            Entries: [
              {
                EventBusName: EVENT_BUS_NAME,
                Source: "alertautec.incidents",
                DetailType: "IncidenteEnAtencion",
                Detail: JSON.stringify({ incidenciaId, actor: user.userId, assignedTo, item: newItem })
              }
            ]
          })
        );
        console.log("Evento publicado correctamente");
      } catch (evErr) {
        console.warn("No se pudo publicar evento en EventBridge:", evErr);
      }
    }

    console.log("=== Fin OK atenderIncidente ===");

    return { statusCode: 200, body: JSON.stringify({ mensaje: "Incidente en atención", item: newItem }) };
  } catch (err: any) {
    console.error("atenderIncidente error fatal:", err);
    return { statusCode: 500, body: JSON.stringify({ message: "Error interno", error: err?.message }) };
  }
};
