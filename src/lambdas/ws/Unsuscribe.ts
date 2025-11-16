// src/lambdas/unsubscribe.ts
import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent } from "aws-lambda";

const db = new DynamoDBClient({});
const TABLE_NAME = process.env.DB_CONEXIONES;

export const handler = async (event: APIGatewayProxyEvent) => {
    console.log('[Unsuscribe] Lambda invocada');
    const connectionId = event.requestContext.connectionId!;
    const body = JSON.parse(event.body || "{}");
    const viewToUnsubscribe = body.view; // ej: "view#incident:123"

    if (!viewToUnsubscribe || viewToUnsubscribe === "metadata") {
        console.warn('[Unsuscribe] viewId inválido');
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
        console.log(`[Unsuscribe] Suscripción eliminada: ${connectionId} -> ${viewToUnsubscribe}`);
        return { statusCode: 200, body: "Suscripción eliminada" };
    } catch (err) {
        console.error('[Unsuscribe] Falló la desuscripción:', err);
        return { statusCode: 500, body: "Falló la desuscripción" };
    }
};