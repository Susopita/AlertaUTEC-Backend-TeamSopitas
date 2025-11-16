import {DynamoDBClient} from "@aws-sdk/client-dynamodb";

import {DynamoDBDocumentClient,ScanCommand} from "@aws-sdk/lib-dynamodb";

import {ApiGatewayManagementApi} from "@aws-sdk/client-apigatewaymanagementapi";

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

    // Enviar respuesta SOLO al cliente que la pidió
    await wsClient.postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        action: "listarIncidenciasResponse",
        incidencias
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
