import {DynamoDBClient} from "@aws-sdk/client-dynamodb";

import {DynamoDBDocumentClient,ScanCommand} from "@aws-sdk/lib-dynamodb";

import {ApiGatewayManagementApi} from "@aws-sdk/client-apigatewaymanagementapi";

import * as jwt from "jsonwebtoken";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: any) => {
  try {
    // Datos del WebSocket
    const connectionId = event.requestContext.connectionId;
    const domain = event.requestContext.domainName;
    const stage = event.requestContext.stage;

    // Cliente para enviar mensajes al WebSocket
    const wsClient = new ApiGatewayManagementApi({
      endpoint: `https://${domain}/${stage}`
    });

    const tableName = process.env.INCIDENTS_TABLE;
    if (!tableName) {
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Falta configuración: INCIDENTS_TABLE" })
      });
      return { statusCode: 500 };
    }

    // Obtener token del query string o headers
    const token = event.queryStringParameters?.token;
    if (!token) {
      await wsClient.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "error", message: "Token no proporcionado" })
      });
      return { statusCode: 401 };
    }

    // Decodificar JWT
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

    const { rol, area } = decoded;

    // Scan paginado (trae todo, más de 1MB si aplica)
    const incidencias: any[] = [];
    let ExclusiveStartKey: Record<string, any> | undefined = undefined;

    do {
      const page = await dynamo.send(
        new ScanCommand({
          TableName: tableName,
          ExclusiveStartKey
        })
      );
      if (page.Items) incidencias.push(...page.Items);
      ExclusiveStartKey = page.LastEvaluatedKey as any;
    } while (ExclusiveStartKey);

    // Filtrar según rol
    let incidenciasFiltradas = incidencias;
    if (rol === "autoridad" && area) {
      incidenciasFiltradas = incidencias.filter(inc => inc.AsignadoA === area);
    }
    // Si es estudiante o admin, mostrar todas (no filtrar)

    // Enviar respuesta SOLO al cliente que la pidió
    await wsClient.postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        action: "listarIncidenciasResponse",
        incidencias: incidenciasFiltradas
      })
    });

    return { statusCode: 200 };

  } catch (err: any) {
    console.error("Error:", err);

    // Intentar enviar error al cliente
    try {
      const wsClient = new ApiGatewayManagementApi({
        endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`
      });

      await wsClient.postToConnection({
        ConnectionId: event.requestContext.connectionId,
        Data: JSON.stringify({
          action: "error",
          message: "Error al listar incidencias"
        })
      });

    } catch (e) {
      console.error("No se pudo enviar error al cliente:", e);
    }

    return { statusCode: 500 };
  }
};
