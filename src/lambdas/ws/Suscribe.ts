// src/lambdas/subscribe.ts
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent } from "aws-lambda";
// 👇 1. Importa el cliente de API Gateway
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";

const db = new DynamoDBClient({});
const TABLE_NAME = process.env.DB_CONEXIONES;

export const handler = async (event: APIGatewayProxyEvent) => {
    console.log('[Suscribe] Lambda invocada');

    const connectionId = event.requestContext.connectionId!;
    // 👇 2. Necesitamos el domain y stage para responder
    const domain = event.requestContext.domainName!;
    const stage = event.requestContext.stage!;

    const body = JSON.parse(event.body || "{}");
    const viewToSubscribe = body.view; // ej: "view#incident:123"

    if (!viewToSubscribe || viewToSubscribe === "metadata") {
        console.warn('[Suscribe] viewId inválido');
        return { statusCode: 400, body: "viewId inválido" };
    }

    // Esta fila es solo un mapeo de suscripción
    const newSubscriptionItem = {
        connectionId: { S: connectionId },
        viewId: { S: viewToSubscribe },
    };

    try {
        // Guarda la suscripción
        await db.send(new PutItemCommand({
            TableName: TABLE_NAME,
            Item: newSubscriptionItem,
        }));
        console.log(`[Suscribe] Suscripción registrada: ${connectionId} -> ${viewToSubscribe}`);

        // 👇 3. Inicializa el cliente para enviar la respuesta
        const wsClient = new ApiGatewayManagementApi({
            endpoint: `https://${domain}/${stage}`
        });

        // 👇 4. Envía la respuesta de éxito que el test está esperando
        await wsClient.postToConnection({
            ConnectionId: connectionId,
            Data: JSON.stringify({
                action: "subscribe-success",
                view: viewToSubscribe
            })
        });

        return { statusCode: 200, body: "Suscrito y notificado" };

    } catch (err) {
        console.error('[Suscribe] Falló la suscripción:', err);
        // (En un caso real, también deberías enviar un error aquí)
        return { statusCode: 500, body: "Falló la suscripción" };
    }
};