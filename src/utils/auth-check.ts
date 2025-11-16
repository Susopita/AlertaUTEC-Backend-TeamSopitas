import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.DB_CONEXIONES!;

export async function verifyConnection(connectionId: string) {

    // 1. Obtener la fila 'metadata' de la conexión
    const result = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: {
            "connectionId": connectionId,
            "viewId": "metadata"
        }
    }));

    const connection = result.Item;

    // 2. Comprobar la autorización y la expiración
    const isAuthorized = connection?.isAuthorized ?? false;
    const expiration = connection?.expiration ?? 0;
    const nowInSeconds = Math.floor(Date.now() / 1000);

    if (!isAuthorized || nowInSeconds > expiration) {
        throw new Error("No autorizado o sesión expirada");
    }

    // 3. Devolver los datos del usuario (userId, roles, etc.)
    return {
        userId: connection?.userId,
        roles: connection?.roles
    };
}