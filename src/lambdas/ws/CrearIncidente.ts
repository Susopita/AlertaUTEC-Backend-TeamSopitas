// src/handlers/crearIncidente.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand
} from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi"; // 👈 AÑADIDO
import { verifyConnection } from "../../utils/auth-check.js"; // 👈 AÑADIDO
import { eventBridgeService } from "../../services/eventBridgeService.js";

const REGION = process.env.AWS_REGION || "us-east-1";
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE!;

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

/** Normaliza urgencia a 'alto'|'medio'|'bajo' o devuelve null si inválida */
function normalizeUrgencia(v: any): "alto" | "medio" | "bajo" | null {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (["alto", "high", "critico", "crítico"].includes(s)) return "alto";
  if (["medio", "medium"].includes(s)) return "medio";
  if (["bajo", "low"].includes(s)) return "bajo";
  return null;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {

  // ----- 1. Configuración de WebSocket -----
  console.log("[crearIncidente] Iniciando ejecución...");
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
    // ----- 2. Autenticación (¡LA PARTE CORREGIDA!) -----
    console.log(`[crearIncidente] Verificando conexión: ${connectionId}`);
    let authData;
    try {
      // Usamos la función compartida
      authData = await verifyConnection(connectionId);
    } catch (authError: any) {
      console.warn(`[crearIncidente] Fallo de autenticación: ${authError.message}`);
      return await sendWsError(authError.message, 401);
    }

    console.log(`[crearIncidente] Autorización exitosa para: ${authData.userId}, Rol: ${authData.roles}`);

    // ----- 3. Lógica de Negocio (Tu código original) -----

    // Verificación de Rol (como en tu código original)
    if ((authData.roles ?? "") !== "estudiante") {
      console.warn(`[crearIncidente] Fallo de autorización: rol '${authData.roles}' no es 'estudiante'.`);
      return await sendWsError("No autorizado: rol debe ser estudiante", 403);
    }

    if (!event.body) {
      console.warn("[crearIncidente] Fallo de validación: Body vacío.");
      return await sendWsError("Body vacío", 400);
    }
    const body = JSON.parse(event.body);
    console.log("[crearIncidente] Body parseado:", JSON.stringify(body));

    // validaciones básicas
    if (!body.descripcion || !body.categoria) {
      console.warn("[crearIncidente] Fallo de validación: Faltan descripcion o categoria.");
      return await sendWsError("Faltan campos obligatorios: descripcion o categoria", 400);
    }

    const urg = normalizeUrgencia(body.urgencia || body.prioridad || body.prioridadNivel);
    if (!urg) {
      return { statusCode: 400, body: JSON.stringify({ message: "Campo 'urgencia' inválido. Debe ser: alto, medio o bajo" }) };
    }

    let IndexPrioridad: number;
    IndexPrioridad = Date.now();
    console.log(`[crearIncidente] No se proveyó IndexPrioridad. Usando timestamp por defecto: ${IndexPrioridad}`);

    const now = new Date().toISOString();
    const incidenciaId = uuidv4();

    const item = {
      incidenciaId,
      estado: "pendiente",
      urgencia: urg,
      IndexPrioridad,
      descripcion: body.descripcion,
      categoria: body.categoria,
      ubicacion: body.ubicacion || null,
      reportadoPor: authData.userId, // 👈 Usamos el ID verificado
      asignadoA: body.asignadoA || null,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    console.log("[crearIncidente] Creando item en DynamoDB:", JSON.stringify(item));
    await ddb.send(new PutCommand({ TableName: INCIDENTS_TABLE, Item: item }));
    console.log("[crearIncidente] Item guardado en DynamoDB.");

    // Emitir evento a EventBridge usando el servicio
    await eventBridgeService.publishIncidenteCreado({
      incidenciaId,
      titulo: body.categoria || "Sin título",
      descripcion: body.descripcion,
      urgencia: urg,
      tipo: body.categoria,
      ubicacion: body.ubicacion,
      area: body.area,
      creadoPor: authData.userId
    });

    // ----- 4. Respuesta de Éxito (WebSocket) -----
    console.log(`[crearIncidente] Ejecución exitosa. IncidenteID: ${incidenciaId}`);

    // En lugar de retornar el body, lo enviamos al cliente
    await wsClient.postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        action: "crearIncidenteSuccess", // Una acción para que el frontend sepa
        mensaje: "Incidente creado",
        incidenciaId,
        urgencia: urg,
        IndexPrioridad
      })
    });

    // Retornamos 200 solo para AWS
    return { statusCode: 200, body: JSON.stringify({ mensaje: "Incidente creado", incidenciaId, urgencia: urg, IndexPrioridad }) };

  } catch (err: any) {
    console.error("[crearIncidente] Error fatal en el handler:", err);
    // Envía un error genérico al cliente si la conexión sigue viva
    return await sendWsError("Error interno del servidor", 500);
  }
};