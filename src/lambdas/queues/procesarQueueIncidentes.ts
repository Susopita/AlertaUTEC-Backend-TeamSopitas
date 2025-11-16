// src/lambdas/queues/procesarQueueIncidentes.ts
import { SQSEvent, SQSRecord } from "aws-lambda";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * Lambda que procesa eventos de la Queue Incidentes
 * Notifica a todas las conexiones WebSocket activas en la misma vista
 */
export const handler = async (event: SQSEvent) => {
    console.log(`[QueueIncidentes] Lambda invocada. Procesando ${event.Records.length} mensajes de la cola de incidentes`);

    const DB_CONEXIONES = process.env.DB_CONEXIONES!;
    const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

    if (!WEBSOCKET_ENDPOINT) {
        console.warn('[QueueIncidentes] WEBSOCKET_ENDPOINT no configurado');
        return;
    }

    const apiGateway = new ApiGatewayManagementApiClient({
        endpoint: WEBSOCKET_ENDPOINT
    });

    // Procesar cada mensaje del batch
    for (const record of event.Records) {
        try {
            await procesarMensaje(record, ddb, apiGateway, DB_CONEXIONES);
        } catch (error) {
            console.error('[QueueIncidentes] Error procesando mensaje:', error);
            // Si falla, SQS lo reintentará
            throw error;
        }
    }

    console.log('[QueueIncidentes] Batch procesado exitosamente');
};

async function procesarMensaje(
    record: SQSRecord,
    ddb: DynamoDBDocumentClient,
    apiGateway: ApiGatewayManagementApiClient,
    tableName: string
) {
    // El mensaje viene de EventBridge -> SQS
    const eventBridgeEvent = JSON.parse(record.body);
    const detailType = eventBridgeEvent['detail-type'];
    const detail = eventBridgeEvent.detail;

    console.log(`[QueueIncidentes] Procesando evento: ${detailType}`, detail);

    // Mapear el tipo de evento a la acción WebSocket
    const accionMap: Record<string, string> = {
        'IncidenteCreado': 'incidenteCreado',
        'IncidenteActualizado': 'incidenteActualizado',
        'IncidenteEliminado': 'incidenteEliminado',
        'IncidenteEnAtencion': 'incidenteEnAtencion',
        'IncidenteResuelto': 'incidenteResuelto',
        'PriorizarIncidente': 'incidentePriorizado'
    };

    const accion = accionMap[detailType];
    if (!accion) {
        console.warn(`[QueueIncidentes] Tipo de evento desconocido: ${detailType}`);
        return;
    }

    // Obtener todas las conexiones activas en la vista de incidentes
    const result = await ddb.send(
        new QueryCommand({
            TableName: tableName,
            IndexName: 'view-index',
            KeyConditionExpression: 'viewId = :v',
            ExpressionAttributeValues: {
                ':v': 'incidentes'
            }
        })
    );

    const conexiones = result.Items || [];
    console.log(`[QueueIncidentes] Notificando a ${conexiones.length} conexiones activas`);

    // Preparar mensaje para WebSocket
    const mensaje = {
        action: accion,
        data: detail,
        timestamp: detail.timestamp || new Date().toISOString()
    };

    // Enviar a cada conexión
    const promesas = conexiones.map(async (conn) => {
        try {
            await apiGateway.send(
                new PostToConnectionCommand({
                    ConnectionId: conn.connectionId,
                    Data: Buffer.from(JSON.stringify(mensaje))
                })
            );
            console.log(`[QueueIncidentes] Notificado: ${conn.connectionId}`);
        } catch (error: any) {
            if (error.statusCode === 410) {
                console.log(`[QueueIncidentes] Conexión obsoleta: ${conn.connectionId}`);
                // TODO: Eliminar conexión de la tabla
            } else {
                console.error(`[QueueIncidentes] Error notificando ${conn.connectionId}:`, error);
            }
        }
    });

    await Promise.allSettled(promesas);
    console.log(`[QueueIncidentes] Evento ${detailType} procesado y notificado`);
}
