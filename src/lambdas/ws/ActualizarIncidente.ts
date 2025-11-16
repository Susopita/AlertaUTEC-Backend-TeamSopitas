// src/handlers/actualizarIncidente.ts
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

/**
 * Extrae usuario de requestContext.authorizer (preferido) o decodifica el JWT del header (solo fallback para dev).
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

  // Fallback: decodificar token sin verificar (solo para desarrollo)
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

/**
 * Nota importante:
 * - Este endpoint es para que el REPORTADO (estudiante) actualice campos de su propio incidente (descripcion, categoria, ubicacion, etc).
 * - NO permite cambiar 'urgencia' ni 'IndexPrioridad'. Para eso use los handlers de priorización (horizontal/vertical) que son para admins.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log("actualizarIncidente - inicio", { path: event.path, method: event.httpMethod, requestId: (event as any).requestContext?.requestId });

  try {
    if (!INCIDENTS_TABLE) {
      console.error("Falta configuración: INCIDENTS_TABLE");
      return { statusCode: 500, body: JSON.stringify({ message: "Error interno: configuración" }) };
    }

    const user = getUserFromEvent(event);
    console.log("actualizarIncidente - usuario extraído", { userId: user.userId, role: user.role });

    if (!user.userId) {
      console.warn("actualizarIncidente - token faltante o inválido");
      return { statusCode: 401, body: JSON.stringify({ message: "No autorizado: token faltante o inválido" }) };
    }

    if (!event.body) {
      console.warn("actualizarIncidente - body vacío");
      return { statusCode: 400, body: JSON.stringify({ message: "Body vacío" }) };
    }

    const body = JSON.parse(event.body);
    console.log("actualizarIncidente - body recibido (parcial)", {
      incidenciaId: body.incidenciaId || body.incidentId || body.id,
      keysInUpdates: body.updates ? Object.keys(body.updates) : null
    });

    const incidenciaId = body.incidenciaId || body.incidentId || body.id;
    const updates = body.updates;
    if (!incidenciaId || !updates || typeof updates !== "object") {
      console.warn("actualizarIncidente - missing incidenciaId or invalid updates");
      return { statusCode: 400, body: JSON.stringify({ message: "Faltan incidenciaId o updates válidos" }) };
    }

    // Obtener incidente actual
    console.log("actualizarIncidente - obteniendo incidente", { incidenciaId });
    const getResp = await ddb.send(new GetCommand({ TableName: INCIDENTS_TABLE, Key: { incidenciaId } }));
    console.log("actualizarIncidente - getResp", { found: !!getResp.Item });

    if (!getResp.Item) {
      console.warn("actualizarIncidente - incidente no encontrado", { incidenciaId });
      return { statusCode: 404, body: JSON.stringify({ message: "Incidente no encontrado" }) };
    }

    const item = getResp.Item as any;

    // Solo el reportadoPor puede editar con este endpoint (estudiante)
    if (String(item.reportadoPor) !== String(user.userId)) {
      console.warn("actualizarIncidente - usuario no propietario", { incidenciaId, owner: item.reportadoPor, actor: user.userId });
      return { statusCode: 403, body: JSON.stringify({ message: "No autorizado: no es propietario del incidente" }) };
    }

    // Campos que no están permitidos para editar aquí (urgencia/IndexPrioridad deben manejarse con priorizar)
    const forbidden = new Set([
      "estado",
      "asignadoA",
      "version",
      "createdAt",
      "updatedAt",
      "incidenciaId",
      "incidentId",
      "id",
      "reportadoPor",
      "urgencia",
      "IndexPrioridad"
    ]);

    const allowedUpdates: Record<string, any> = {};
    for (const k of Object.keys(updates)) {
      if (!forbidden.has(k)) allowedUpdates[k] = updates[k];
    }

    console.log("actualizarIncidente - allowedUpdates", { count: Object.keys(allowedUpdates).length, fields: Object.keys(allowedUpdates) });

    if (Object.keys(allowedUpdates).length === 0) {
      console.warn("actualizarIncidente - no hay campos actualizables");
      return { statusCode: 400, body: JSON.stringify({ message: "No hay campos actualizables en 'updates' o se intentó cambiar campos no permitidos" }) };
    }

    // Construir UpdateExpression dinámicamente (DocumentClient style)
    const ExpressionAttributeNames: Record<string, string> = {};
    const ExpressionAttributeValues: Record<string, any> = {};
    const setParts: string[] = [];

    let idx = 0;
    for (const key of Object.keys(allowedUpdates)) {
      idx++;
      const nameKey = `#f${idx}`;
      const valKey = `:v${idx}`;
      ExpressionAttributeNames[nameKey] = key;
      ExpressionAttributeValues[valKey] = allowedUpdates[key];
      setParts.push(`${nameKey} = ${valKey}`);
    }

    // agregar updatedAt y version++
    idx++;
    ExpressionAttributeNames["#updatedAt"] = "updatedAt";
    ExpressionAttributeValues[":updatedAt"] = new Date().toISOString();
    setParts.push(`#updatedAt = :updatedAt`);

    ExpressionAttributeNames["#version"] = "version";
    ExpressionAttributeValues[":inc"] = 1;
    ExpressionAttributeValues[":zero"] = 0;

    const UpdateExpression = "SET " + setParts.join(", ") + ", #version = if_not_exists(#version, :zero) + :inc";

    // Condición: sigue siendo el propietario
    const params: any = {
      TableName: INCIDENTS_TABLE,
      Key: { incidenciaId },
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ConditionExpression: "reportadoPor = :rid",
      ReturnValues: "ALL_NEW"
    };
    params.ExpressionAttributeValues[":rid"] = user.userId;

    console.log("actualizarIncidente - update params (sanitized)", {
      TableName: params.TableName,
      Key: params.Key,
      UpdateExpression: params.UpdateExpression,
      ExpressionAttributeNames: Object.keys(ExpressionAttributeNames),
      ExpressionAttributeValuesKeys: Object.keys(ExpressionAttributeValues),
      ConditionExpression: params.ConditionExpression
    });

    let updateResp: any;
    try {
      // workaround para tipos: el DocumentClient puede requerir cast a any
      updateResp = await ddb.send(new UpdateCommand(params as any) as any);
      console.log("actualizarIncidente - update successful");
    } catch (e: any) {
      console.error("actualizarIncidente - update failed", { name: e?.name, message: e?.message });
      if (e?.name === "ConditionalCheckFailedException") {
        return { statusCode: 409, body: JSON.stringify({ message: "Conflicto: no se pudo actualizar (condición fallida)" }) };
      }
      throw e;
    }

    const newItem = (updateResp as any)?.Attributes;
    console.log("actualizarIncidente - newItem", { incidenciaId, updatedAt: newItem?.updatedAt });

    // Publicar evento (opcional)
    if (EVENT_BUS_NAME) {
      try {
        console.log("actualizarIncidente - publicando evento EventBridge", { detailType: "IncidenteActualizado", incidenciaId });
        await eb.send(new PutEventsCommand({
          Entries: [
            {
              EventBusName: EVENT_BUS_NAME,
              Source: "alertautec.incidents",
              DetailType: "IncidenteActualizado",
              Detail: JSON.stringify({ incidenciaId, updates: allowedUpdates, actor: user.userId, newItem })
            }
          ]
        }));
        console.log("actualizarIncidente - evento publicado");
      } catch (evErr) {
        console.warn("actualizarIncidente - no se pudo publicar evento en EventBridge", evErr);
      }
    }

    console.log("actualizarIncidente - fin correcto", { incidenciaId, actor: user.userId });
    return { statusCode: 200, body: JSON.stringify({ mensaje: "Incidente actualizado", item: newItem }) };
  } catch (err: any) {
    console.error("actualizarIncidente error:", { message: err?.message, stack: err?.stack });
    return { statusCode: 500, body: JSON.stringify({ message: "Error interno", error: err?.message }) };
  }
};
