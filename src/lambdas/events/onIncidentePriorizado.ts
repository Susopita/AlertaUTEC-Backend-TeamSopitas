// src/lambdas/events/onIncidentePriorizado.ts
import { EventBridgeEvent } from "aws-lambda";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { IncidentePriorizadoEvent } from "../../events/schemas.js";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * Lambda consumidora que notifica cuando se prioriza un incidente
 */
export const handler = async (event: EventBridgeEvent<string, IncidentePriorizadoEvent>) => {
    try {
        console.log('[onIncidentePriorizado] Lambda invocada');
        console.log('[onIncidentePriorizado] Evento recibido:', JSON.stringify(event.detail));

        const { incidenciaId, tipoPriorizacion, nuevaPrioridad, priorizadoPor } = event.detail;
        const DB_CONEXIONES = process.env.DB_CONEXIONES!;
        const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

        if (!WEBSOCKET_ENDPOINT) {
            console.warn('[onIncidentePriorizado] WEBSOCKET_ENDPOINT no configurado');
            return { statusCode: 200, body: 'Sin endpoint WebSocket' };
        }

        // Obtener conexiones activas
        const result = await ddb.send(
            new QueryCommand({
                TableName: DB_CONEXIONES,
                IndexName: 'view-index',
                KeyConditionExpression: 'viewId = :v',
                ExpressionAttributeValues: {
                    ':v': 'incidentes'
                }
            })
        );

        const conexiones = result.Items || [];
        const apiGateway = new ApiGatewayManagementApiClient({
            endpoint: WEBSOCKET_ENDPOINT
        });

        const mensaje = {
            action: 'incidentePriorizado',
            data: {
                incidenciaId,
                tipoPriorizacion,
                nuevaPrioridad,
                priorizadoPor,
                timestamp: event.detail.timestamp
            }
        };

        // Notificar a todas las conexiones
        const promesas = conexiones.map(async (conn) => {
            try {
                await apiGateway.send(
                    new PostToConnectionCommand({
                        ConnectionId: conn.connectionId,
                        Data: Buffer.from(JSON.stringify(mensaje))
                    })
                );
                console.log(`[onIncidentePriorizado] Notificado a conexión: ${conn.connectionId}`);
            } catch (error: any) {
                if (error.statusCode === 410) {
                    console.log(`[onIncidentePriorizado] Conexión obsoleta: ${conn.connectionId}`);
                } else {
                    console.error(`[onIncidentePriorizado] Error notificando a ${conn.connectionId}:`, error);
                }
            }
        });

        await Promise.allSettled(promesas);

        console.log(`[onIncidentePriorizado] Priorización notificada: ${incidenciaId} (${tipoPriorizacion}) -> ${nuevaPrioridad}`);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Evento procesado' })
        };
    } catch (error) {
        console.error('[onIncidentePriorizado] Error:', error);
        throw error;
    }
};
