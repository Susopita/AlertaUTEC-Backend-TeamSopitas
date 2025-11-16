// src/lambdas/events/onIncidenteResuelto.ts
import { EventBridgeEvent } from "aws-lambda";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { IncidenteResueltoEvent } from "../../events/schemas.js";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * Lambda consumidora que notifica cuando se resuelve un incidente
 */
export const handler = async (event: EventBridgeEvent<string, IncidenteResueltoEvent>) => {
    try {
        console.log('Evento IncidenteResuelto recibido:', JSON.stringify(event, null, 2));

        const { incidenciaId, resolucion, resueltoPor } = event.detail;
        const DB_CONEXIONES = process.env.DB_CONEXIONES!;
        const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

        if (!WEBSOCKET_ENDPOINT) {
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
            action: 'incidenteResuelto',
            data: {
                incidenciaId,
                resolucion,
                resueltoPor,
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
            } catch (error: any) {
                if (error.statusCode === 410) {
                    console.log(`Conexión obsoleta: ${conn.connectionId}`);
                }
            }
        });

        await Promise.allSettled(promesas);

        console.log(`Resolución notificada: ${incidenciaId} por ${resueltoPor}`);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Evento procesado' })
        };
    } catch (error) {
        console.error('Error procesando evento IncidenteResuelto:', error);
        throw error;
    }
};
