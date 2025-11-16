// src/lambdas/connect.ts
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent } from "aws-lambda";

const db = new DynamoDBClient({});
const TABLE_NAME = process.env.DB_CONEXIONES;

export const handler = async (event: APIGatewayProxyEvent) => {
    console.log('[Connect] Lambda invocada');
    const connectionId = event.requestContext.connectionId!;

    // El "folder" principal para esta conexión
    const newItem = {
        connectionId: { S: connectionId },
        viewId: { S: "metadata" }, // El registro principal
        conectadoEn: { S: new Date().toISOString() },
        isAuthorized: { BOOL: false } // Aún no se ha autenticado
    };

    try {
        await db.send(new PutItemCommand({
            TableName: TABLE_NAME,
            Item: newItem,
        }));
        console.log(`[Connect] Conexión registrada: ${connectionId}`);
        return { statusCode: 200, body: "Conectado" };
    } catch (err) {
        console.error('[Connect] Falló la conexión:', err);
        return { statusCode: 500, body: "Falló la conexión" };
    }
};