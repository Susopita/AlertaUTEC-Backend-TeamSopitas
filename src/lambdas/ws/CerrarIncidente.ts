import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
import * as jwt from "jsonwebtoken";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: any) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const domain = event.requestContext.domainName;
    const stage = event.requestContext.stage;

    const wsClient = new ApiGatewayManagementApi({
      endpoint: `https://${domain}/${stage}`
    });

    // Parsear el body del mensaje WebSocket
    const body = JSON.parse(event.body);
    const { incidenciaId, token } = body;

    // Validar campos requeridos
    if (!incidenciaId || !token) {
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Faltan campos: incidenciaId, token" })
      });
      return { statusCode: 400 };
    }

    // Verificar JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Falta configuración: JWT_SECRET" })
      });
      return { statusCode: 500 };
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Token inválido" })
      });
      return { statusCode: 401 };
    }

    // Verificar que el usuario sea admin
    if (decoded.rol !== "admin") {
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Solo administradores pueden cerrar incidentes" })
      });
      return { statusCode: 403 };
    }

    const tableName = process.env.INCIDENTS_TABLE;
    if (!tableName) {
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Falta configuración: INCIDENTS_TABLE" })
      });
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
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Incidencia no encontrada" })
      });
      return { statusCode: 404 };
    }

    // Actualizar estado a "resuelto"
    await dynamo.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { incidenciaId },
        UpdateExpression: "SET estado = :estado, actualizadoEn = :fecha, resueltoPor = :admin",
        ExpressionAttributeValues: {
          ":estado": "resuelto",
          ":fecha": new Date().toISOString(),
          ":admin": decoded.sub
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
    console.error("Error:", err);

    try {
      const wsClient = new ApiGatewayManagementApi({
        endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`
      });

      await wsClient.postToConnection({
        ConnectionId: event.requestContext.connectionId,
        Data: JSON.stringify({
          action: "error",
          message: "Error al cerrar incidente"
        })
      });
    } catch (e) {
      console.error("No se pudo enviar error al cliente:", e);
    }

    return { statusCode: 500 };
  }
};
