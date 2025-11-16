import { SQSEvent } from "aws-lambda";
import {
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  DeleteCommand
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
const WS_TABLE = process.env.WS_TABLE!;
const WS_API_ENDPOINT = process.env.WS_API_ENDPOINT!; // must be full endpoint

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const apigw = new ApiGatewayManagementApiClient({ endpoint: WS_API_ENDPOINT });

export const handler = async (event: SQSEvent) => {
  console.log('[NotificarIncidente] Lambda invocada');
  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      const subscriptionKey = body.subscriptionKey; // e.g. "building#LabA" or "role#autoridad"
      const eventType = body.eventType;
      const payload = body.payload;

      if (!subscriptionKey) {
        console.warn('[NotificarIncidente] subscriptionKey faltante', body);
        continue;
      }

      // Query WSConnections by GSI-subscriptionKey
      const q = await ddb.send(new QueryCommand({
        TableName: WS_TABLE,
        IndexName: "GSI-subscriptionKey",
        KeyConditionExpression: "subscriptionKey = :k",
        ExpressionAttributeValues: { ":k": subscriptionKey },
        ProjectionExpression: "connectionId"
      }));

      const connections = q.Items || [];
      console.log(`[NotificarIncidente] Notificando a ${connections.length} conexiones para ${subscriptionKey}`);

      for (const conn of connections) {
        const connId = (conn as any).connectionId;
        try {
          await apigw.send(new PostToConnectionCommand({
            ConnectionId: connId,
            Data: new TextEncoder().encode(JSON.stringify({ type: eventType, data: payload }))
          }));
          console.log(`[NotificarIncidente] Notificado: ${connId}`);
        } catch (err: any) {
          const status = err?.$metadata?.httpStatusCode;
          console.warn(`[NotificarIncidente] Falló notificación para ${connId} status=${status}`, err?.message);
          // if 410 Gone, delete connection record to prune stale conns
          if (status === 410 || status === 403) {
            try {
              await ddb.send(new DeleteCommand({ TableName: WS_TABLE, Key: { connectionId: connId } }));
              console.log(`[NotificarIncidente] Conexión obsoleta eliminada: ${connId}`);
            } catch (delErr) {
              console.error('[NotificarIncidente] Error eliminando conexión obsoleta', connId, delErr);
            }
          }
        }
      }
    } catch (e) {
      console.error('[NotificarIncidente] Error procesando record:', e);
      // SQS lambda event will retry / send to DLQ if configured
    }
  }
};
