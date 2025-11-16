import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
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
    const { incidenciaId, nuevoIndex, token } = body;

    // Validar campos requeridos
    if (!incidenciaId || nuevoIndex === undefined || !token) {
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Faltan campos: incidenciaId, nuevoIndex, token" })
      });
      return { statusCode: 400 };
    }

    // Validar que nuevoIndex sea un número positivo
    if (typeof nuevoIndex !== "number" || nuevoIndex < 0) {
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "nuevoIndex debe ser un número positivo" })
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
        Data: JSON.stringify({ action: "error", message: "Solo administradores pueden cambiar prioridad vertical" })
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

    // Obtener la incidencia actual para conocer su urgencia
    const scanResult = await dynamo.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "incidenciaId = :id",
        ExpressionAttributeValues: { ":id": incidenciaId }
      })
    );

    if (!scanResult.Items || scanResult.Items.length === 0) {
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Incidencia no encontrada" })
      });
      return { statusCode: 404 };
    }

    const incidencia = scanResult.Items[0];
    if (!incidencia) {
            return { statusCode: 401, body: JSON.stringify({ message: "incidencia inválida" }) };
        }

    const urgencia = incidencia.urgencia;
    const indexActual = incidencia.IndexPrioridad || 0;

    // Obtener todas las incidencias de la misma urgencia
    const incidenciasMismaUrgencia = await dynamo.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "urgencia = :urg",
        ExpressionAttributeValues: { ":urg": urgencia }
      })
    );

    const incidencias = (incidenciasMismaUrgencia.Items || [])
      .sort((a, b) => (a.IndexPrioridad || 0) - (b.IndexPrioridad || 0));

    // Reorganizar índices
    // 1. Remover la incidencia actual de su posición
    const filtered = incidencias.filter(inc => inc.incidenciaId !== incidenciaId);

    
    // 2. Insertar en la nueva posición
    const finalIndex = Math.min(nuevoIndex, filtered.length);
    filtered.splice(finalIndex, 0, incidencia);

    // 3. Actualizar todos los índices
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      if (!item) continue;
      
      await dynamo.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { incidenciaId: item.incidenciaId },
          UpdateExpression: "SET IndexPrioridad = :idx, actualizadoEn = :fecha",
          ExpressionAttributeValues: {
            ":idx": i,
            ":fecha": new Date().toISOString()
          }
        })
      );
    }

    // Responder al cliente
    await wsClient.postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        action: "priorizarVerticalmenteResponse",
        message: "Prioridad vertical actualizada correctamente",
        incidenciaId,
        nuevoIndex: finalIndex,
        urgencia
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
          message: "Error al cambiar prioridad vertical"
        })
      });
    } catch (e) {
      console.error("No se pudo enviar error al cliente:", e);
    }

    return { statusCode: 500 };
  }
};
