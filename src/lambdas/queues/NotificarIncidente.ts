import { SQSEvent } from "aws-lambda";
import { BatchWriteItemCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

// --- Configuración Simplificada ---
const REGION = process.env.AWS_REGION || "us-east-1";
const WS_TABLE = process.env.DB_CONEXIONES!;
// Corregido para coincidir con tu serverless.yml
const WS_API_ENDPOINT = process.env.WS_API_ENDPOINT!;
// Nombre real de tu GSI en serverless.yml
const GSI_NAME = "view-index";

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const apigw = new ApiGatewayManagementApiClient({ endpoint: WS_API_ENDPOINT });

/**
 * Estructura del 'record.body' (lo que SQS recibe de EventBridge):
 * {
 * "version": "0",
 * "id": "...",
 * "detail-type": "IncidenteCreado", // <-- El eventType
 * "source": "alertautec.incidents",
 * "detail": { // <-- El payload
 * "incidente": { ... },
 * "viewId": "view#main_list" // <-- El publicador DEBE añadir esto
 * }
 * }
 */
export const handler = async (event: SQSEvent) => {
  console.log(`[Notificador] Lambda invocada. ${event.Records.length} records.`);

  for (const [idx, record] of event.Records.entries()) {
    console.log(`[Notificador] Procesando record ${idx + 1}/${event.Records.length} (ID: ${record.messageId})`);

    try {
      // 1. Parsear el sobre de EventBridge desde el body de SQS
      const ebEvent = JSON.parse(record.body || "{}");
      console.debug("Parsed SQS body (EventBridge Envelope):", ebEvent);

      // --- Lógica de Búsqueda CORREGIDA ---

      // 2. Extraer los datos del *interior* del sobre
      // NOTA: Tu 'crearIncidente' stringifica el 'detail'. ¡No debería!
      // Este código asume que 'detail' es un OBJETO.
      // Si 'crearIncidente' sigue enviando un string, necesitas un JSON.parse() extra.
      const detail = ebEvent.detail || {};
      const eventType: string = ebEvent['detail-type'] || "notification";
      const viewId: string | undefined = detail.viewId; // Asumimos que el publicador lo añade
      const payload = detail.incidente ?? detail; // El payload es el 'detail'

      if (!viewId) {
        console.warn(`[Notificador] Mensaje sin 'viewId' en el 'detail'. Se omite. (ID: ${record.messageId})`);
        continue;
      }
      // ----------------------------------------

      console.log(`[Notificador] Buscando conexiones para viewId: ${viewId}`);

      // 3. Consultar el GSI (Tu lógica de Query está perfecta)
      const queryResult = await ddb.send(new QueryCommand({
        TableName: WS_TABLE,
        IndexName: GSI_NAME,
        KeyConditionExpression: `viewId = :v`,
        ExpressionAttributeValues: { ":v": viewId },
        ProjectionExpression: "connectionId"
      }));

      const connections = queryResult.Items || [];
      if (connections.length === 0) {
        console.log(`[Notificador] No hay conexiones activas para ${viewId}.`);
        continue;
      }

      console.log(`[Notificador] ${connections.length} conexiones encontradas. Iniciando fan-out...`);

      // 4. Preparar el mensaje para el frontend
      const message = JSON.stringify({
        action: eventType, // ej: "IncidenteCreado"
        payload: payload  // El objeto 'detail' completo
      });
      const encoded = new TextEncoder().encode(message);

      // 5. Enviar a todos (Tu lógica de Fan-Out y Autolimpieza está perfecta)
      const postPromises = connections.map(async (conn) => {
        const connId = conn.connectionId;
        if (!connId) return;

        try {
          await apigw.send(new PostToConnectionCommand({
            ConnectionId: connId,
            Data: encoded
          }));
          console.log(`[Notificador] Notificado: ${connId}`);
        } catch (err: any) {
          const status = err?.$metadata?.httpStatusCode;
          console.warn(`[Notificador] Falló notificación para ${connId} (Status: ${status})`, err.message);

          if (status === 410 || status === 403) {
            console.log(`[Notificador] Conexión muerta detectada: ${connId}. Limpiando...`);
            await cleanUpStaleConnection(connId); // Tu función de limpieza
          }
        }
      });

      await Promise.all(postPromises);

    } catch (e: any) {
      console.error(`[Notificador] Error fatal procesando record (ID: ${record.messageId}):`, e);
      throw e;
    }
  }
  console.log('[Notificador] Procesamiento finalizado.');
};

/**
 * Función de autolimpieza (Tu código, sin cambios)
 */
async function cleanUpStaleConnection(connectionId: string) {
  try {
    const queryResult = await ddb.send(new QueryCommand({
      TableName: WS_TABLE,
      KeyConditionExpression: "connectionId = :cid",
      ExpressionAttributeValues: { ":cid": connectionId },
      ProjectionExpression: "connectionId, viewId"
    }));

    const items = queryResult.Items || [];
    if (items.length === 0) return;

    console.log(`[Notificador-Cleanup] ${items.length} filas encontradas para ${connectionId}.`);

    const deleteRequests = items.map(item => ({
      DeleteRequest: {
        Key: {
          connectionId: item.connectionId,
          viewId: item.viewId
        }
      }
    }));

    await ddb.send(new BatchWriteItemCommand({
      RequestItems: {
        [WS_TABLE]: deleteRequests.slice(0, 25)
      }
    }));

    console.log(`[Notificador-Cleanup] Conexión muerta ${connectionId} eliminada.`);

  } catch (delErr) {
    console.error(`[Notificador-Cleanup] Error al limpiar ${connectionId}:`, delErr);
  }
}