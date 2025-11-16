// src/lambdas/subscribe.ts
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent } from "aws-lambda";

const db = new DynamoDBClient({});
const TABLE_NAME = process.env.DB_CONEXIONES;

export const handler = async (event: APIGatewayProxyEvent) => {
    const connectionId = event.requestContext.connectionId!;
    const body = JSON.parse(event.body || "{}");
    const viewToSubscribe = body.view; // ej: "view#incident:123"

    if (!viewToSubscribe || viewToSubscribe === "metadata") {
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
        return { statusCode: 200, body: "Suscrito" };
    } catch (err) {
        return { statusCode: 500, body: "Falló la suscripción" };
    }
};