import { SQSEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  DeleteCommand,
  ScanCommand
} from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

/**
 * Worker independiente que:
 * - recorre cada mensaje SQS (body debe contener subscriptionKey, eventType y payload)
 * - consulta la tabla WSConnections por GSI-subscriptionKey
 * - envía via ApiGatewayManagementApi a cada connectionId
 *
 * Variables de entorno:
 * - WS_TABLE
 * - WS_API_ENDPOINT (p.ej. https://{api-id}.execute-api.{region}.amazonaws.com/{stage})
 */

const REGION = process.env.AWS_REGION || "us-east-1";
const WS_TABLE = process.env.WS_TABLE!; // tabla de conexiones/suscripciones
const WS_API_ENDPOINT = process.env.WS_API_ENDPOINT!; // https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
const GSI_NAME_VIEWID = process.env.WS_GSI_VIEWID || "GSI-viewId"; // opcional
const GSI_NAME_SUBKEY = process.env.WS_GSI_SUBKEY || "GSI-subscriptionKey"; // opcional

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const apigw = new ApiGatewayManagementApiClient({ endpoint: WS_API_ENDPOINT });

/**
 * Estructura esperada de cada mensaje SQS:
 * {
 *   "subscriptionKey": "role#admin" | "view#incident:123"  (preferido)
 *   "viewId": "view#incident:123"                        (compatibilidad con tus lambdas)
 *   "eventType": "IncidenteCreado" | "IncidenteEnAtencion" | ...,
 *   "payload": { ... }  // objeto con todos los campos del incidente
 * }
 */
export const handler = async (event: SQSEvent) => {
  console.log("notifyIncidents invoked. Records:", event.Records.length);
  for (const [idx, record] of event.Records.entries()) {
    console.log(`Processing record ${idx + 1}/${event.Records.length} messageId=${record.messageId}`);
    try {
      const body = JSON.parse(record.body || "{}");
      console.debug("Parsed SQS body:", body);

      const subscriptionKey: string | undefined = body.subscriptionKey || body.subKey;
      const viewId: string | undefined = body.viewId;
      const eventType: string = body.eventType || "notification";
      const payload = body.payload ?? body.incident ?? null;

      if (!subscriptionKey && !viewId) {
        console.warn("Mensaje sin subscriptionKey ni viewId - se omite", { messageId: record.messageId, body });
        continue;
      }

      // decidir qué atributo usar para query (compatibilidad)
      const lookupKey = subscriptionKey ? { name: "subscriptionKey", value: subscriptionKey } : { name: "viewId", value: viewId! };
      console.log("Lookup key seleccionada:", lookupKey);

      let queryResult;
      // Intentar usar GSI apropiado si existe (más eficiente que scan)
      try {
        const indexName = lookupKey.name === "subscriptionKey" ? GSI_NAME_SUBKEY : GSI_NAME_VIEWID;
        console.log(`Ejecutando Query en ${WS_TABLE} usando index ${indexName} para ${lookupKey.name}=${lookupKey.value}`);
        queryResult = await ddb.send(new QueryCommand({
          TableName: WS_TABLE,
          IndexName: indexName,
          KeyConditionExpression: `${lookupKey.name} = :k`,
          ExpressionAttributeValues: { ":k": lookupKey.value },
          ProjectionExpression: "connectionId, viewId"
        }));
        console.log("Query result count:", (queryResult.Items || []).length);
      } catch (qerr) {
        // Si el Query falla (p. ej. GSI no existe), hacemos un SCAN con filtro (menos eficiente)
        console.warn("Query GSI falló o GSI no existe, usando Scan como fallback", { error: (qerr as any)?.message ?? String(qerr), indexTried: lookupKey.name });
        const scanResp = await ddb.send(new ScanCommand({
          TableName: WS_TABLE,
          FilterExpression: `${lookupKey.name} = :k`,
          ExpressionAttributeValues: { ":k": lookupKey.value },
          ProjectionExpression: "connectionId, viewId"
        }));
        queryResult = scanResp;
        console.log("Scan result count:", (scanResp.Items || []).length);
      }

      const connections = queryResult.Items || [];
      console.info(`Conexiones a notificar: ${connections.length} for key=${lookupKey.value}`);

      if (!connections.length) {
        console.info("notifyIncidents: no hay conexiones para key", lookupKey.value);
        continue;
      }

      // Preparar el mensaje que llegará al front
      const message = JSON.stringify({
        type: eventType,
        data: payload
      });
      const encoded = new TextEncoder().encode(message);
      console.debug("Mensaje a enviar (truncado):", message?.slice?.(0, 500));

      // Enviar a cada connectionId
      for (const [iConn, conn] of connections.entries()) {
        const connId = (conn as any).connectionId;
        const connView = (conn as any).viewId;
        if (!connId) {
          console.warn("Fila de conexión sin connectionId, saltando", conn);
          continue;
        }

        console.log(`Enviando mensaje a connection ${iConn + 1}/${connections.length} connectionId=${connId} viewId=${connView}`);
        try {
          await apigw.send(new PostToConnectionCommand({
            ConnectionId: connId,
            Data: encoded
          }));
          console.info("Mensaje enviado correctamente a connectionId", connId);
        } catch (err: any) {
          const status = err?.$metadata?.httpStatusCode;
          console.warn(`postToConnection failed for ${connId} status=${status} error=${err?.message}`);
          // Si la conexión está muerta (410) o acceso denegado (403), borrar las filas asociadas a esa connectionId
          if (status === 410 || status === 403) {
            console.info("Detectada conexión inválida, limpiando filas asociadas", { connectionId: connId, status });
            try {
              // buscar todas las filas de esa connectionId (la tabla usa PK connectionId, SK viewId)
              const connRows = await ddb.send(new QueryCommand({
                TableName: WS_TABLE,
                KeyConditionExpression: "connectionId = :c",
                ExpressionAttributeValues: { ":c": connId },
                ProjectionExpression: "connectionId, viewId"
              }));
              const items = connRows.Items || [];
              console.log("Filas encontradas para cleanup:", items.length);
              for (const it of items) {
                const view = (it as any).viewId;
                try {
                  await ddb.send(new DeleteCommand({
                    TableName: WS_TABLE,
                    Key: { connectionId: connId, viewId: view }
                  }));
                  console.info("Deleted stale connection row", { connectionId: connId, viewId: view });
                } catch (delErr) {
                  console.error("Failed to delete stale connection row", { connectionId: connId, viewId: view, error: (delErr instanceof Error ? delErr.message : delErr) });
                }
              }
            } catch (delQueryErr) {
              console.error("Failed to query/delete stale connection rows for", connId, delQueryErr);
            }
          } else {
            // para errores transitarios (429, 500, etc.) dejamos que SQS reintente el mensaje si así está configurado
            console.warn("Error al postear a connectionId (no se eliminará), permitirá reintento si aplica:", { connectionId: connId, status, message: err?.message });
          }
        }
      }
    } catch (e) {
      console.error("notifyIncidents worker record error:", e, "record:", { messageId: record.messageId, body: record.body?.slice?.(0, 1000) });
      // no throw -> permitir reintentos automáticos de SQS (si quieres, re-throw para que SQS reintente)
    }
  }
  console.log("notifyIncidents processing finished.");
};
