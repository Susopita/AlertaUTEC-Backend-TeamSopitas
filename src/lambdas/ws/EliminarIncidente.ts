// src/handlers/borrarIncidente.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
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

function getUserFromEvent(event: any): JwtUser {
  console.log("Extrayendo usuario del evento...");

  const ctx = event?.requestContext ?? {};
  const auth = ctx.authorizer;
  const jwtClaims = auth?.jwt?.claims || auth?.claims;

  if (jwtClaims) {
    console.log("Claims encontrados en requestContext.authorizer");
    return {
      userId: jwtClaims.sub || jwtClaims["username"],
      role: (jwtClaims["cognito:groups"] || jwtClaims["role"] || jwtClaims["custom:role"] || "")
        .toString()
        .toLowerCase(),
      email: jwtClaims.email
    };
  }

  const authHeader = event?.headers?.Authorization || event?.headers?.authorization;
  if (authHeader) {
    console.log("Intentando decodificar token desde el header...");
  }

  if (authHeader && authHeader.startsWith("Bearer ") && JWT_SECRET) {
    try {
      const token = authHeader.split(" ")[1];
      const payload = jwt.verify(token, JWT_SECRET) as any;
      console.log("JWT decodificado exitosamente en fallback dev mode");
      return {
        userId: payload.sub || payload.userId || payload.uid,
        role: (payload.role || payload["custom:role"] || "").toString().toLowerCase(),
        email: payload.email
      };
    } catch {
      console.warn("Token inválido en fallback");
    }
  }

  console.warn("No se pudo obtener usuario (ni claims ni token decodificado)");
  return {};
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log("borrarIncidente invoked. Event summary:", {
    hasBody: !!event.body,
    path: event.path,
    method: event.httpMethod
  });

  try {
    if (!INCIDENTS_TABLE) {
      console.error("INCIDENTS_TABLE no está configurado");
      return { statusCode: 500, body: JSON.stringify({ message: "Error interno: configuración" }) };
    }

    const user = getUserFromEvent(event);
    console.log("Usuario identificado:", user);

    if (!user.userId) {
      console.warn("Solicitud rechazada: usuario sin userId");
      return { statusCode: 401, body: JSON.stringify({ message: "No autorizado: token faltante o inválido" }) };
    }

    if (!event.body) {
      console.warn("Body vacío recibido");
      return { statusCode: 400, body: JSON.stringify({ message: "Body vacío" }) };
    }

    const body = JSON.parse(event.body);
    const incidenciaId = body.incidenciaId || body.incidentId || body.id;

    console.log("Incidencia solicitada a eliminar:", incidenciaId);

    if (!incidenciaId) {
      console.warn("incidenciaId faltante");
      return { statusCode: 400, body: JSON.stringify({ message: "Falta incidenciaId" }) };
    }

    // Leer incidente
    console.log("Consultando incidente en DynamoDB...");
    const getResp = await ddb.send(new GetCommand({ TableName: INCIDENTS_TABLE, Key: { incidenciaId } }));

    if (!getResp.Item) {
      console.warn("Incidente no encontrado:", incidenciaId);
      return { statusCode: 404, body: JSON.stringify({ message: "Incidente no encontrado" }) };
    }

    console.log("Incidente encontrado:", getResp.Item);

    const reportadoPor = (getResp.Item as any).reportadoPor;
    const role = (user.role || "").toString().toLowerCase();

    console.log(`Validando permisos. Rol: "${role}", reportadoPor: "${reportadoPor}"`);

    if (role === "estudiante") {
      if (String(reportadoPor) !== String(user.userId)) {
        console.warn("Estudiante intentó eliminar incidente que no le pertenece");
        return { statusCode: 403, body: JSON.stringify({ message: "No autorizado: no es propietario del incidente" }) };
      }
    } else if (!["admin", "autoridad"].includes(role)) {
      console.warn("Rol no permitido para eliminar:", role);
      return { statusCode: 403, body: JSON.stringify({ message: "No autorizado" }) };
    }

    const deleteParams: any = { TableName: INCIDENTS_TABLE, Key: { incidenciaId } };

    if (role === "estudiante") {
      deleteParams.ConditionExpression = "reportadoPor = :rid";
      deleteParams.ExpressionAttributeValues = { ":rid": user.userId };
      console.log("Aplicando condición de propietario en DELETE");
    }

    console.log("Ejecutando DeleteCommand...");
    try {
      await ddb.send(new DeleteCommand(deleteParams));
      console.log("Incidente eliminado correctamente:", incidenciaId);
    } catch (e: any) {
      console.error("Error al eliminar en DynamoDB:", e);
      if (e?.name === "ConditionalCheckFailedException") {
        return {
          statusCode: 409,
          body: JSON.stringify({ message: "Conflicto: no se pudo eliminar (condición fallida)" })
        };
      }
      throw e;
    }

    // EventBridge
    if (EVENT_BUS_NAME) {
      console.log("Publicando evento en EventBridge...");
      try {
        await eb.send(new PutEventsCommand({
          Entries: [
            {
              EventBusName: EVENT_BUS_NAME,
              Source: "alertautec.incidents",
              DetailType: "IncidenteEliminado",
              Detail: JSON.stringify({ incidenciaId, actor: user.userId })
            }
          ]
        }));
        console.log("Evento publicado correctamente");
      } catch (evErr) {
        console.warn("No se pudo publicar evento en EventBridge:", evErr);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ mensaje: "Incidente eliminado", incidenciaId }) };
  } catch (err: any) {
    console.error("Error inesperado en borrarIncidente:", err);
    return { statusCode: 500, body: JSON.stringify({ message: "Error interno", error: err?.message }) };
  }
};
