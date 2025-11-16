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

/**
 * Extrae usuario de requestContext.authorizer (preferido) o decodifica el JWT del header (solo fallback para dev).
 * En producción use un Authorizer (Cognito / JWT authorizer) para claims verificadas.
 */
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
    if (!INCIDENTS_TABLE) {
      console.error("Falta configuración: INCIDENTS_TABLE");
      return { statusCode: 500, body: JSON.stringify({ message: "Error interno: configuración" }) };
    }

    const user = getUserFromEvent(event);
    if (!user.userId) {
      return { statusCode: 401, body: JSON.stringify({ message: "No autorizado: token faltante o inválido" }) };
    }

    if (!event.body) {
      return { statusCode: 400, body: JSON.stringify({ message: "Body vacío" }) };
    }

    const body = JSON.parse(event.body);
    const incidenciaId = body.incidenciaId || body.incidentId || body.id;
    if (!incidenciaId) {
      return { statusCode: 400, body: JSON.stringify({ message: "Falta incidenciaId" }) };
    }

    // Obtener incidente
    const getResp = await ddb.send(new GetCommand({ TableName: INCIDENTS_TABLE, Key: { incidenciaId } }));
    if (!getResp.Item) {
      return { statusCode: 404, body: JSON.stringify({ message: "Incidente no encontrado" }) };
    }

    const reportadoPor = (getResp.Item as any).reportadoPor;

    // Permisos:
    // - admin / autoridad pueden eliminar cualquiera
    // - estudiante solo puede eliminar si es propietario
    const role = (user.role || "").toString().toLowerCase();
    if (role === "estudiante") {
      if (String(reportadoPor) !== String(user.userId)) {
        return { statusCode: 403, body: JSON.stringify({ message: "No autorizado: no es propietario del incidente" }) };
      }
    } else if (!["admin", "autoridad"].includes(role)) {
      return { statusCode: 403, body: JSON.stringify({ message: "No autorizado" }) };
    }

    // Borrar con condición (si estudiante: garantizamos que sigue siendo propietario)
    const deleteParams: any = { TableName: INCIDENTS_TABLE, Key: { incidenciaId } };

    if (role === "estudiante") {
      deleteParams.ConditionExpression = "reportadoPor = :rid";
      deleteParams.ExpressionAttributeValues = { ":rid": user.userId };
    }

    try {
      await ddb.send(new DeleteCommand(deleteParams));
    } catch (e: any) {
      if (e?.name === "ConditionalCheckFailedException") {
        return { statusCode: 409, body: JSON.stringify({ message: "Conflicto: no se pudo eliminar (condición fallida)" }) };
      }
      throw e;
    }

    // Nota: no renumeramos IndexPrioridad aquí. Dejar huecos es aceptable y más eficiente.
    // Si necesitas compactar la cola, implementa un proceso de reindexado por urgencia (off-line).

    // Publicar evento en EventBridge (opcional)
    if (EVENT_BUS_NAME) {
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
      } catch (evErr) {
        console.warn("Advertencia: no se pudo publicar evento en EventBridge", evErr);
        // no fallamos la operación por un fallo en el event bus
      }
    }

    return { statusCode: 200, body: JSON.stringify({ mensaje: "Incidente eliminado", incidenciaId }) };
  } catch (err: any) {
    console.error("borrarIncidente error:", err);
    return { statusCode: 500, body: JSON.stringify({ message: "Error interno", error: err?.message }) };
  }
};
