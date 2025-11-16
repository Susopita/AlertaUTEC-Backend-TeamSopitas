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
  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body || "{}");
      const subscriptionKey: string | undefined = body.subscriptionKey || body.subKey;
      const viewId: string | undefined = body.viewId;
      const eventType: string = body.eventType || "notification";
      const payload = body.payload ?? body.incident ?? null;

      if (!subscriptionKey && !viewId) {
        console.warn("notifyIncidents: mensaje sin subscriptionKey ni viewId, se omite", body);
        continue;
      }

      // decidir qué atributo usar para query (compatibilidad)
      const lookupKey = subscriptionKey ? { name: "subscriptionKey", value: subscriptionKey } : { name: "viewId", value: viewId! };
      let queryResult;

      // Intentar usar GSI apropiado si existe (más eficiente que scan)
      try {
        const indexName = lookupKey.name === "subscriptionKey" ? GSI_NAME_SUBKEY : GSI_NAME_VIEWID;
        queryResult = await ddb.send(new QueryCommand({
          TableName: WS_TABLE,
          IndexName: indexName,
          KeyConditionExpression: `${lookupKey.name} = :k`,
          ExpressionAttributeValues: { ":k": lookupKey.value },
          ProjectionExpression: "connectionId, viewId"
        }));
      } catch (qerr) {
        // Si el Query falla (p. ej. GSI no existe), hacemos un SCAN con filtro (menos eficiente)
        console.warn("Query GSI falló o GSI no existe, usando Scan como fallback", qerr);
        const scanResp = await ddb.send(new ScanCommand({
          TableName: WS_TABLE,
          FilterExpression: `${lookupKey.name} = :k`,
          ExpressionAttributeValues: { ":k": lookupKey.value },
          ProjectionExpression: "connectionId, viewId"
        }));
        queryResult = scanResp;
      }

      const connections = queryResult.Items || [];

      if (!connections.length) {
        console.info("notifyIncidents: no hay conexiones para key", lookupKey.value);
        continue;
      }

      // Preparar el mensaje que llegará al front: incluir metadata importante del incidente
      // Se espera que 'payload' ya contenga los campos del incidente:
      // { incidenciaId, urgencia, IndexPrioridad, estado, descripcion, categoria, ubicacion, asignadoA, createdAt, updatedAt, ... }
      const message = JSON.stringify({
        type: eventType,
        data: payload
      });
      const encoded = new TextEncoder().encode(message);

      // Enviar a cada connectionId
      for (const conn of connections) {
        const connId = (conn as any).connectionId;
        if (!connId) continue;

        try {
          await apigw.send(new PostToConnectionCommand({
            ConnectionId: connId,
            Data: encoded
          }));
        } catch (err: any) {
          const status = err?.$metadata?.httpStatusCode;
          console.warn(`postToConnection failed for ${connId} status=${status} error=${err?.message}`);
          // Si la conexión está muerta (410) o acceso denegado (403), borrar las filas asociadas a esa connectionId
          if (status === 410 || status === 403) {
            try {
              // buscar todas las filas de esa connectionId (la tabla usa PK connectionId, SK viewId)
              const connRows = await ddb.send(new QueryCommand({
                TableName: WS_TABLE,
                KeyConditionExpression: "connectionId = :c",
                ExpressionAttributeValues: { ":c": connId },
                ProjectionExpression: "connectionId, viewId"
              }));
              const items = connRows.Items || [];
              for (const it of items) {
                const view = (it as any).viewId;
                try {
                  await ddb.send(new DeleteCommand({
                    TableName: WS_TABLE,
                    Key: { connectionId: connId, viewId: view }
                  }));
                  console.info("Deleted stale connection row", connId, view);
                } catch (delErr) {
                  console.error("Failed to delete stale connection row", connId, view, delErr);
                }
              }
            } catch (delQueryErr) {
              console.error("Failed to query/delete stale connection rows for", connId, delQueryErr);
            }
          }
        }
      }
    } catch (e) {
      console.error("notifyIncidents worker record error:", e, "record:", record);
      // no throw -> permitir reintentos automáticos de SQS (si quieres, re-throw para que SQS reintente)
    }
  }
};
