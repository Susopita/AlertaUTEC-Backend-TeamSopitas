import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuid } from "uuid";
import * as bcrypt from "bcryptjs";
import { eventBridgeService } from "../../services/eventBridgeService.js";

const db = new DynamoDBClient({});

const jsonHeaders = {
  "Content-Type": "application/json"
};

const AREAS_PERMITIDAS = ["Seguridad", "Posta", "BE", "Limpieza", "TI"] as const;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    console.log('[CrearAutoridad] Lambda invocada');
    if (!event.body) {
      console.warn('[CrearAutoridad] Body vacío');
      return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ message: "Body vacío" }) };
    }

    const { codigo, nombre, correo, password, area } = JSON.parse(event.body);
    console.log(`[CrearAutoridad] Datos recibidos: codigo=${codigo}, nombre=${nombre}, correo=${correo}, area=${area}`);

    if (!codigo || !nombre || !correo || !password || !area) {
      console.warn('[CrearAutoridad] Faltan campos obligatorios');
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ message: "Faltan campos obligatorios" })
      };
    }

    if (String(password).length < 8) {
      console.warn('[CrearAutoridad] Password menor a 8 caracteres');
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ message: "Password mínimo 8 caracteres" })
      };
    }

    // Normalizar y validar área
    const areaStr = String(area);
    const areaCanon = AREAS_PERMITIDAS.find(a => a.toLowerCase() === areaStr.toLowerCase());
    if (!areaCanon) {
      console.warn('[CrearAutoridad] Área inválida:', area);
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ message: `Área inválida. Permitidas: ${AREAS_PERMITIDAS.join(", ")}` })
      };
    }

    const tableName = process.env.DB_NAME;
    if (!tableName) {
      console.error('[CrearAutoridad] Falta configuración: DB_NAME');
      return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ message: "Falta configuración: DB_NAME" }) };
    }

    // Prevenir duplicados por correo
    const byCorreo = await db.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "correo-index",
        KeyConditionExpression: "correo = :c",
        ExpressionAttributeValues: { ":c": { S: String(correo) } },
        Limit: 1
      })
    );
    if ((byCorreo.Items?.length ?? 0) > 0) {
      console.warn('[CrearAutoridad] Correo ya registrado');
      return { statusCode: 409, headers: jsonHeaders, body: JSON.stringify({ message: "Correo ya registrado" }) };
    }

    // Prevenir duplicados por código
    const byCodigo = await db.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "codigo-index",
        KeyConditionExpression: "codigo = :k",
        ExpressionAttributeValues: { ":k": { S: String(codigo) } },
        Limit: 1
      })
    );
    if ((byCodigo.Items?.length ?? 0) > 0) {
      console.warn('[CrearAutoridad] Código ya registrado');
      return { statusCode: 409, headers: jsonHeaders, body: JSON.stringify({ message: "Código ya registrado" }) };
    }

    // Generar usuario Autoridad
    const userId = uuid();
    const passwordHash = await bcrypt.hash(String(password), 10);
    console.log(`[CrearAutoridad] Usuario autoridad generado: userId=${userId}`);

    const newUserItem = {
      userId: { S: userId },
      codigo: { S: String(codigo) },
      nombre: { S: String(nombre) },
      correo: { S: String(correo) },
      rol: { S: "autoridad" },
      area: { S: areaCanon },
      passwordHash: { S: passwordHash },
      creadoEn: { S: new Date().toISOString() }
    };

    await db.send(
      new PutItemCommand({
        TableName: tableName,
        Item: newUserItem
      })
    );
    console.log('[CrearAutoridad] Usuario autoridad guardado en DynamoDB');

    // Emitir evento a EventBridge
    await eventBridgeService.publishUsuarioCreado({
      userId,
      codigo: String(codigo),
      nombre: String(nombre),
      correo: String(correo),
      rol: "autoridad",
      area: areaCanon
    });
    console.log('[CrearAutoridad] Evento UsuarioCreado (autoridad) emitido a EventBridge');

    return {
      statusCode: 201,
      headers: jsonHeaders,
      body: JSON.stringify({ message: "Usuario autoridad creado", userId })
    };
  } catch (err: any) {
    console.error('[CrearAutoridad] Error interno:', err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ message: "Error interno", error: err.message })
    };
  }
};
