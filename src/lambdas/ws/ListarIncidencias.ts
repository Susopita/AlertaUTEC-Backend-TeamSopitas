// src/lambdas/ws/ListarIncidencias.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { verifyConnection } from "../../utils/auth-check.js";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

  console.log('[ListarIncidencias] Lambda invocada');
  const connectionId = event.requestContext.connectionId!;
  const domain = event.requestContext.domainName!;
  const stage = event.requestContext.stage!;

  const wsClient = new ApiGatewayManagementApi({
    endpoint: `https://${domain}/${stage}`
  });

  const sendWsError = async (message: string, statusCode: number) => {
    await wsClient.postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify({ action: "error", message: message })
    });
    return { statusCode, body: JSON.stringify({ message }) };
  };

  try {
    // ----- 1. Autenticación -----
    console.log(`[ListarIncidencias] Verificando conexión: ${connectionId}`);
    let authData;
    try {
      authData = await verifyConnection(connectionId);
    } catch (authError: any) {
      console.warn(`[ListarIncidencias] Fallo de autenticación: ${authError.message}`);
      return await sendWsError(authError.message, 401);
    }

    // Asumimos que 'authData' devuelve { userId, roles, area }
    const { roles } = authData;
    console.log(`[ListarIncidencias] Rol: ${roles}`);

    // ----- 2. Paginación y Lógica de Rol -----
    const body = JSON.parse(event.body || "{}");
    const limit = body.limit || 20;
    const cursor = body.cursor; // El 'LastEvaluatedKey' de la página anterior

    let queryParams: any = {
      TableName: INCIDENTS_TABLE,
      Limit: limit,
      ExclusiveStartKey: cursor || undefined
    };

    // ----- AQUÍ ESTÁ LA NUEVA LÓGICA -----
    if (roles === "estudiante" || roles === "admin") {
      // ROL ESTUDIANTE O ADMIN: Ven el foro, ordenado por fecha
      console.log(`[ListarIncidencias] Consultando como ESTUDIANTE/ADMIN (foro cronológico)`);

      queryParams.IndexName = "tipo-fecha-index";
      queryParams.KeyConditionExpression = "tipo = :t";
      queryParams.ExpressionAttributeValues = { ":t": "incidente" };
      queryParams.ScanIndexForward = false; // Ordena por createdAt (descendente, lo más nuevo primero)

    } else {
      // ROL AUTORIDAD: Ve su cola de trabajo, ordenada por prioridad
      console.log(`[ListarIncidencias] Consultando como AUTORIDAD para el área: ${roles}`);

      queryParams.IndexName = "asignadoA-prioridad-index";
      queryParams.KeyConditionExpression = "asignadoA = :a";
      queryParams.ExpressionAttributeValues = { ":a": roles };
      queryParams.ScanIndexForward = true; // Ordena por IndexPrioridad (ascendente, 1 es más alto)
    }
    // ------------------------------------

    const page = await dynamo.send(new QueryCommand(queryParams));

    const incidencias = page.Items || [];
    const nextCursor = page.LastEvaluatedKey;

    console.log(`[ListarIncidencias] ${incidencias.length} incidentes encontrados.`);

    // ----- 3. Respuesta al Cliente -----
    await wsClient.postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        action: "listarIncidenciasResponse",
        incidencias: incidencias, // El filtrado ya se hizo en la Query de DynamoDB
        nextCursor: nextCursor || null
      })
    });

    return { statusCode: 200, body: JSON.stringify({ message: "Incidencias listadas", incidencias }) };

  } catch (err: any) {
    console.error("[ListarIncidencias] Error:", err);
    return await sendWsError("Error al listar incidencias", 500);
  }
};