// src/lambdas/events/onIncidenteCreado.ts
import { EventBridgeEvent } from "aws-lambda";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { IncidenteCreadoEvent } from "../../events/schemas.js";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * Lambda consumidora que notifica via WebSocket cuando se crea un incidente
 * Envía notificaciones a todas las conexiones activas
 */
export const handler = async (event: EventBridgeEvent<string, IncidenteCreadoEvent>) => {
    try {
        console.log('[onIncidenteCreado] Lambda invocada');
        console.log('[onIncidenteCreado] Evento recibido:', JSON.stringify(event.detail));

        const incidente = event.detail;
        const DB_CONEXIONES = process.env.DB_CONEXIONES!;
        const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

        if (!WEBSOCKET_ENDPOINT) {
            console.warn('[onIncidenteCreado] WEBSOCKET_ENDPOINT no configurado, saltando notificación WebSocket');
            return { statusCode: 200, body: 'Sin endpoint WebSocket' };
        }

        // Obtener todas las conexiones activas
        const result = await ddb.send(
            new QueryCommand({
                TableName: DB_CONEXIONES,
                IndexName: 'view-index',
                KeyConditionExpression: 'viewId = :v',
                ExpressionAttributeValues: {
                    ':v': 'incidentes' // Vista de incidentes
                }
            })
        );

        const conexiones = result.Items || [];
        console.log(`[onIncidenteCreado] Notificando a ${conexiones.length} conexiones activas`);

        // Cliente WebSocket API Gateway
        const apiGateway = new ApiGatewayManagementApiClient({
            endpoint: WEBSOCKET_ENDPOINT
        });

        // Mensaje a enviar
        const mensaje = {
            action: 'incidenteCreado',
            data: incidente
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
                console.log(`[onIncidenteCreado] Notificación enviada a conexión: ${conn.connectionId}`);
            } catch (error: any) {
                if (error.statusCode === 410) {
                    console.log(`[onIncidenteCreado] Conexión obsoleta: ${conn.connectionId}`);
                    // TODO: Eliminar conexión de la tabla
                } else {
                    console.error(`[onIncidenteCreado] Error notificando a ${conn.connectionId}:`, error);
                }
            }
        });

        await Promise.allSettled(promesas);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Notificaciones enviadas' })
        };
    } catch (error) {
        console.error('[onIncidenteCreado] Error:', error);
        throw error;
    }
};
