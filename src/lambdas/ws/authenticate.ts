// src/lambdas/authenticate.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import * as jwt from "jsonwebtoken";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.DB_CONEXIONES!;
const JWT_SECRET = process.env.JWT_SECRET!;

export const handler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

    console.log('[Authenticate] Lambda invocada');
    const connectionId = event.requestContext.connectionId;
    if (!connectionId) {
        console.warn('[Authenticate] ID de conexión no encontrado');
        return { statusCode: 400, body: "ID de conexión no encontrado" };
    }

    const body = JSON.parse(event.body || "{}");
    const token = body.token; // El JWT que envió el cliente

    if (!token) {
        console.warn('[Authenticate] Falta el token en el body');
        return { statusCode: 400, body: "Falta el 'token' en el body" };
    }

    try {
        // 1. Validar el token (firma y expiración)
        const payload: any = jwt.verify(token, JWT_SECRET);

        // 2. Extraer los datos del token
        const userId = payload.sub; // Asumiendo que 'sub' es tu userId
        const roles = payload.rol; // O 'roles', como lo hayas guardado
        const expiration = payload.exp; // El timestamp de expiración del token

        if (!userId || !roles || !expiration) {
            console.warn('[Authenticate] Token inválido (faltan datos)');
            return { statusCode: 400, body: "Token inválido (faltan datos)" };
        }

        // 3. Actualizar la fila "metadata" de la conexión en DynamoDB
        await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
                "connectionId": connectionId,
                "viewId": "metadata"
            },
            // Le "sellamos" la identidad y el tiempo de expiración
            UpdateExpression: "SET isAuthorized = :auth, userId = :uid, roles = :r, expiration = :exp",
            ExpressionAttributeValues: {
                ":auth": true,
                ":uid": userId,
                ":r": roles,
                ":exp": expiration // Guardamos el timestamp de expiración
            }
        }));
        console.log(`[Authenticate] Usuario autenticado: ${userId}`);

        // 4. Avisar al cliente que la autenticación fue exitosa
        // (Esto es opcional, pero bueno para depurar)
        // const wsClient = new ApiGatewayManagementApi(...);
        // await wsClient.postToConnection({
        //     ConnectionId: connectionId,
        //     Data: JSON.stringify({ action: "auth-success" })
        // });

        return { statusCode: 200, body: "Autenticado exitosamente" };

    } catch (err) {
        // Si jwt.verify falla (token expirado, firma inválida), entra aquí
        console.warn('[Authenticate] Token inválido o expirado');
        return { statusCode: 401, body: "Token inválido o expirado" };
    }
};