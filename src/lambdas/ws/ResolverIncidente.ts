import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
// ❌ Se fue: import * as jwt from "jsonwebtoken";
import { verifyConnection } from "../../utils/auth-check.js"; // 👈✅ Agregamos esto

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: any) => {
    const connectionId = event.requestContext.connectionId;
    const domain = event.requestContext.domainName;
    const stage = event.requestContext.stage;

    const wsClient = new ApiGatewayManagementApi({
        endpoint: `https://${domain}/${stage}`
    });

    try {
        // ====================================================================
        // PASO 1: VERIFICAR LA CONEXIÓN (NUEVO BLOQUE)
        // ====================================================================
        let authData;
        try {
            // Verificamos la conexión usando nuestro módulo compartido
            authData = await verifyConnection(connectionId);
        } catch (authError: any) {
            await wsClient.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({ action: "error", message: authError.message })
            });
            return { statusCode: 401 }; // 401 No Autorizado
        }

        // ====================================================================
        // PASO 2: VERIFICAR EL ROL (AUTORIZACIÓN)
        // ====================================================================
        // Tu código buscaba "admin". Si 'autoridad' es el rol, cámbialo aquí.
        // authData.roles viene del 'metadata' de DynamoDB.
        if (authData.roles !== "admin" && authData.roles !== "autoridad") {
            await wsClient.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({ action: "error", message: "Acceso denegado: Se requiere rol de autoridad/admin" })
            });
            return { statusCode: 403 }; // 403 Prohibido
        }

        // ====================================================================
        // PASO 3: PROCESAR LA LÓGICA (Tu código original, modificado)
        // ====================================================================

        // Parsear el body del mensaje WebSocket
        // ❌ Ya no necesitamos el token
        const body = JSON.parse(event.body);
        const { incidenciaId } = body;

        // Validar campos requeridos
        if (!incidenciaId) {
            await wsClient.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({ action: "error", message: "Falta campo: incidenciaId" })
            });
            return { statusCode: 400 };
        }

        // ❌ Se borró toda la verificación manual de JWT (líneas 30-60)

        const tableName = process.env.INCIDENTS_TABLE;
        if (!tableName) {
            // ... (error de configuración)
            return { statusCode: 500 };
        }

        // Verificar que la incidencia existe
        const getResult = await dynamo.send(
            new GetCommand({
                TableName: tableName,
                Key: { incidenciaId }
            })
        );

        if (!getResult.Item) {
            // ... (error de incidencia no encontrada)
            return { statusCode: 404 };
        }

        // Actualizar estado a "resuelto"
        await dynamo.send(
            new UpdateCommand({
                TableName: tableName,
                Key: { incidenciaId },
                UpdateExpression: "SET estado = :estado, actualizadoEn = :fecha, resueltoPor = :autoridadId",
                ExpressionAttributeValues: {
                    ":estado": "resuelto",
                    ":fecha": new Date().toISOString(),
                    ":autoridadId": authData.userId // 👈 Usamos el ID verificado
                }
            })
        );

        // Responder al cliente
        await wsClient.postToConnection({
            ConnectionId: connectionId,
            Data: JSON.stringify({
                action: "cerrarIncidenteResponse",
                message: "Incidente cerrado correctamente",
                incidenciaId,
                estado: "resuelto"
            })
        });

        return { statusCode: 200 };

    } catch (err: any) {
        // ... (Tu bloque catch general)
        console.error("Error:", err);
        return { statusCode: 500 };
    }
};