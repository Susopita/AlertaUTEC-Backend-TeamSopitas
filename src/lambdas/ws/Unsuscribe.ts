// src/lambdas/unsubscribe.ts
import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
// 👇 1. Importa el cliente de API Gateway
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";

const db = new DynamoDBClient({});
const TABLE_NAME = process.env.DB_CONEXIONES;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('[Unsubscribe] Lambda invocada');

    const connectionId = event.requestContext.connectionId!;
    // 👇 2. Necesitamos el domain y stage para responder
    const domain = event.requestContext.domainName!;
    const stage = event.requestContext.stage!;

    // Inicializa el cliente para enviar la respuesta
    const wsClient = new ApiGatewayManagementApi({
        endpoint: `https://${domain}/${stage}`
    });

    const body = JSON.parse(event.body || "{}");
    const viewToUnsubscribe = body.view; // ej: "view#incident:123"

    if (!viewToUnsubscribe || viewToUnsubscribe === "metadata") {
        console.warn('[Unsubscribe] viewId inválido');
        // (Opcional) Enviar error de vuelta
        await wsClient.postToConnection({
            ConnectionId: connectionId,
            Data: JSON.stringify({ action: "error", message: "viewId inválido" })
        });
        return { statusCode: 400, body: "viewId inválido" };
    }

    try {
        // Borra solo la fila de suscripción específica
        await db.send(new DeleteItemCommand({
            TableName: TABLE_NAME,
            Key: {
                connectionId: { S: connectionId },
                viewId: { S: viewToUnsubscribe }
            }
        }));

        console.log(`[Unsubscribe] Suscripción eliminada: ${connectionId} -> ${viewToUnsubscribe}`);

        // 👇 3. Envía la respuesta de éxito que el test espera
        await wsClient.postToConnection({
            ConnectionId: connectionId,
            Data: JSON.stringify({
                action: "unsubscribe-success",
                view: viewToUnsubscribe
            })
        });

        return { statusCode: 200, body: "Suscripción eliminada" };

    } catch (err) {
        console.error('[Unsubscribe] Falló la desuscripción:', err);

        // 👇 4. Envía un mensaje de error de vuelta al cliente
        try {
            await wsClient.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                    action: "error",
                    message: "Falló la desuscripción"
                })
            });
        } catch (e) {
            // Ignora si falla el envío de error (cliente ya desconectado)
        }

        return { statusCode: 500, body: "Falló la desuscripción" };
    }
};