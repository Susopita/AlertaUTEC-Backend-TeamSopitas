// src/lambdas/disconnect.ts
import { DynamoDBClient, QueryCommand, BatchWriteItemCommand, WriteRequest } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent } from "aws-lambda";

const db = new DynamoDBClient({});
const TABLE_NAME = process.env.DB_CONEXIONES!;

export const handler = async (event: APIGatewayProxyEvent) => {
    const connectionId = event.requestContext.connectionId!;

    try {
        // 1. Encontrar todas las filas de esta conexión
        const queryResult = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "connectionId = :cid",
            ExpressionAttributeValues: { ":cid": { S: connectionId } }
        }));

        if (!queryResult.Items || queryResult.Items.length === 0) {
            console.log(`Nada que limpiar para la conexión: ${connectionId}`);
            return { statusCode: 200, body: "Nada que limpiar" };
        }

        // 2. Crear una solicitud de borrado en lote
        const deleteRequests: WriteRequest[] = queryResult.Items.map(item => ({
            DeleteRequest: {
                Key: {
                    connectionId: { S: connectionId },
                    viewId: { S: item.viewId?.S! } // Borra CADA fila
                }
            }
        }));

        // 3. Ejecutar el borrado en lote
        // (Nota: BatchWriteItemCommand tiene un límite de 25 items por request)
        await db.send(new BatchWriteItemCommand({
            RequestItems: {
                [TABLE_NAME]: deleteRequests
            }
        }));

        console.log(`Desconectado y limpiado exitosamente: ${connectionId}`);
        return { statusCode: 200, body: "Desconectado y limpiado" };
    } catch (err) {
        console.error("Error al desconectar:", err);
        console.error(`Error al desconectar ${connectionId}:`, err);
        return { statusCode: 200, body: "Error en limpieza" };
    }
};