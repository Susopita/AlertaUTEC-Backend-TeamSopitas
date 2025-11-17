import { SQSEvent } from "aws-lambda";
import { BatchWriteItemCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

/**
 * Worker (Notificador) que:
 * - Lee un mensaje de SQS.
 * - El body del mensaje DEBE contener "viewId", "eventType" y "payload".
 * - Consulta el GSI "view-index" de la tabla de conexiones.
 * - Envía una notificación a todas las conexiones suscritas.
 *
 * Variables de entorno:
 * - DB_CONEXIONES (Nombre de la tabla de conexiones)
 * - WEBSOCKET_ENDPOINT (El endpoint de la API, ej: https://{api-id}.execute-api.../{stage})
 */

// --- Configuración Simplificada ---
// AWS_REGION es inyectado automáticamente por Lambda
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
 * Estructura esperada de cada mensaje SQS:
 * {
 * "viewId": "view#incident:123",
 * "eventType": "IncidenteCreado",
 * "payload": { ... }
 * }
 */
export const handler = async (event: SQSEvent) => {
  console.log(`[Notificador] Lambda invocada. ${event.Records.length} records.`);

  for (const [idx, record] of event.Records.entries()) {
    console.log(`[Notificador] Procesando record ${idx + 1}/${event.Records.length} (ID: ${record.messageId})`);

    try {
      const body = JSON.parse(record.body || "{}");
      console.debug("Parsed SQS body:", body);

      // --- Lógica de Búsqueda Simplificada ---
      const viewId: string | undefined = body.viewId;
      const eventType: string = body.eventType || "notification"; // 'action' podría ser mejor
      const payload = body.payload ?? body.incident ?? null;

      if (!viewId) {
        console.warn(`[Notificador] Mensaje sin 'viewId'. Se omite. (ID: ${record.messageId})`);
        continue;
      }
      // ----------------------------------------

      console.log(`[Notificador] Buscando conexiones para viewId: ${viewId}`);

      // Consulta el GSI para encontrar todas las conexiones suscritas
      const queryResult = await ddb.send(new QueryCommand({
        TableName: WS_TABLE,
        IndexName: GSI_NAME, // <-- Nombre hardcodeado y correcto
        KeyConditionExpression: `viewId = :v`,
        ExpressionAttributeValues: { ":v": viewId },
        ProjectionExpression: "connectionId" // Solo necesitamos el ID de conexión
      }));

      const connections = queryResult.Items || [];
      if (connections.length === 0) {
        console.log(`[Notificador] No hay conexiones activas para ${viewId}.`);
        continue;
      }

      console.log(`[Notificador] ${connections.length} conexiones encontradas. Iniciando fan-out...`);

      // Prepara el mensaje que llegará al front
      // (Usamos 'action' para ser consistentes con tus otras respuestas)
      const message = JSON.stringify({
        action: eventType, // ej: "IncidenteCreado"
        payload: payload
      });
      const encoded = new TextEncoder().encode(message);

      // Enviar a cada connectionId en paralelo
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

          // --- Lógica de Autolimpieza (Backup de $disconnect) ---
          if (status === 410 || status === 403) {
            console.log(`[Notificador] Conexión muerta detectada: ${connId}. Limpiando...`);
            await cleanUpStaleConnection(connId);
          }
          // ----------------------------------------------------
        }
      });

      await Promise.all(postPromises);

    } catch (e: any) {
      console.error(`[Notificador] Error fatal procesando record (ID: ${record.messageId}):`, e);
      // Dejamos que SQS reintente el mensaje si es un error de parseo o similar
      throw e;
    }
  }
  console.log('[Notificador] Procesamiento finalizado.');
};

/**
 * Función de autolimpieza: Borra todos los registros (metadata y vistas)
 * asociados a un connectionId que se ha detectado como muerto.
 */
async function cleanUpStaleConnection(connectionId: string) {
  try {
    // 1. Encontrar todas las filas de esta conexión (PK = connectionId)
    const queryResult = await ddb.send(new QueryCommand({
      TableName: WS_TABLE,
      KeyConditionExpression: "connectionId = :cid",
      ExpressionAttributeValues: { ":cid": connectionId },
      ProjectionExpression: "connectionId, viewId" // Solo necesitamos las claves
    }));

    const items = queryResult.Items || [];
    if (items.length === 0) return;

    console.log(`[Notificador-Cleanup] ${items.length} filas encontradas para ${connectionId}.`);

    // 2. Crear una solicitud de borrado en lote (Batch)
    const deleteRequests = items.map(item => ({
      DeleteRequest: {
        Key: {
          connectionId: item.connectionId,
          viewId: item.viewId
        }
      }
    }));

    // 3. Ejecutar el borrado en lote
    await ddb.send(new BatchWriteItemCommand({
      RequestItems: {
        [WS_TABLE]: deleteRequests.slice(0, 25) // Limita a 25 por request
      }
    }));

    console.log(`[Notificador-Cleanup] Conexión muerta ${connectionId} eliminada.`);

  } catch (delErr) {
    console.error(`[Notificador-Cleanup] Error al limpiar ${connectionId}:`, delErr);
  }
}