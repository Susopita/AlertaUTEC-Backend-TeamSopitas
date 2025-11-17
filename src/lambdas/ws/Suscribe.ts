// src/lambdas/subscribe.ts
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent } from "aws-lambda";

const db = new DynamoDBClient({});
const TABLE_NAME = process.env.DB_CONEXIONES;

export const handler = async (event: APIGatewayProxyEvent) => {
    console.log('[Suscribe] Lambda invocada');
    const connectionId = event.requestContext.connectionId!;
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
        await db.send(new PutItemCommand({
            TableName: TABLE_NAME,
            Item: newSubscriptionItem,
        }));
        console.log(`[Suscribe] Suscripción registrada: ${connectionId} -> ${viewToSubscribe}`);
        return { statusCode: 200, body: "Suscrito" };
    } catch (err) {
        console.error('[Suscribe] Falló la suscripción:', err);
        return { statusCode: 500, body: "Falló la suscripción" };
    }
};