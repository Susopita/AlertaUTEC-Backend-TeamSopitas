import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
import * as jwt from "jsonwebtoken";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: any) => {
  try {
    console.log('[PriorizarHorizontalmente] Lambda invocada');
    const connectionId = event.requestContext.connectionId;
    const domain = event.requestContext.domainName;
    const stage = event.requestContext.stage;

    const wsClient = new ApiGatewayManagementApi({
      endpoint: `https://${domain}/${stage}`
    });

    // Parsear el body del mensaje WebSocket
    const body = JSON.parse(event.body);
    const { incidenciaId, urgencia, token } = body;

    // Validar campos requeridos
    if (!incidenciaId || !urgencia || !token) {
      console.warn('[PriorizarHorizontalmente] Faltan campos: incidenciaId, urgencia, token');
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Faltan campos: incidenciaId, urgencia, token" })
      });
      return { statusCode: 400 };
    }

    // Validar valores de urgencia
    const urgenciasValidas = ["bajo", "medio", "alto"];
    if (!urgenciasValidas.includes(urgencia.toLowerCase())) {
      console.warn('[PriorizarHorizontalmente] Urgencia inválida:', urgencia);
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Urgencia debe ser: bajo, medio o alto" })
      });
      return { statusCode: 400 };
    }

    // Verificar JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('[PriorizarHorizontalmente] Falta configuración: JWT_SECRET');
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
      console.warn('[PriorizarHorizontalmente] Token inválido');
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Token inválido" })
      });
      return { statusCode: 401 };
    }

    // Verificar que el usuario sea admin
    if (decoded.rol !== "admin") {
      console.warn('[PriorizarHorizontalmente] Solo administradores pueden priorizar incidencias');
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Solo administradores pueden priorizar incidencias" })
      });
      return { statusCode: 403 };
    }

    // Actualizar urgencia en DynamoDB
    const tableName = process.env.INCIDENTS_TABLE;
    if (!tableName) {
      console.error('[PriorizarHorizontalmente] Falta configuración: INCIDENTS_TABLE');
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Falta configuración: INCIDENTS_TABLE" })
      });
      return { statusCode: 500 };
    }

    await dynamo.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { incidenciaId },
        UpdateExpression: "SET urgencia = :u, actualizadoEn = :fecha",
        ExpressionAttributeValues: {
          ":u": urgencia.toLowerCase(),
          ":fecha": new Date().toISOString()
        }
      })
    );

    // Responder al cliente
    await wsClient.postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        action: "priorizarHorizontalmenteResponse",
        message: "Urgencia actualizada correctamente",
        incidenciaId,
        urgencia: urgencia.toLowerCase()
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
          message: "Error al priorizar incidencia"
        })
      });
    } catch (e) {
      console.error("No se pudo enviar error al cliente:", e);
    }

    return { statusCode: 500 };
  }
};
