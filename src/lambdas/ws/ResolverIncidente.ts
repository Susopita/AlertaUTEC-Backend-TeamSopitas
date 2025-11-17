import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
import { verifyConnection } from "../../utils/auth-check.js";
import { eventBridgeService } from "../../services/eventBridgeService.js";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: any) => {
    console.log('[ResolverIncidente] Lambda invocada');
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
            console.log('[ResolverIncidente] Usuario autenticado:', authData.userId);
        } catch (authError: any) {
            console.warn('[ResolverIncidente] Error autenticando conexión:', authError.message);
            await wsClient.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({ action: "error", message: authError.message })
            });
            return { statusCode: 401 }; // 401 No Autorizado
        }

        // ====================================================================
        // PASO 2: VERIFICAR EL ROL (AUTORIZACIÓN)
        // ====================================================================
        if (authData.roles !== "admin" && authData.roles !== "autoridad") {
            console.warn('[ResolverIncidente] Acceso denegado: Se requiere rol de autoridad/admin');
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
        const body = JSON.parse(event.body);
        const { incidenciaId } = body;

        // Validar campos requeridos
        if (!incidenciaId) {
            console.warn('[ResolverIncidente] Falta campo: incidenciaId');
            await wsClient.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({ action: "error", message: "Falta campo: incidenciaId" })
            });
            return { statusCode: 400 };
        }

        const tableName = process.env.INCIDENTS_TABLE;
        if (!tableName) {
            console.error('[ResolverIncidente] Falta configuración: INCIDENTS_TABLE');
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
            console.warn('[ResolverIncidente] Incidencia no encontrada');
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
                    ":autoridadId": authData.userId
                }
            })
        );

        // Emitir evento de incidente resuelto
        await eventBridgeService.publishIncidenteResuelto({
            incidenciaId,
            resolucion: "Incidente resuelto por autoridad",
            resueltoPor: authData.userId
        });

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