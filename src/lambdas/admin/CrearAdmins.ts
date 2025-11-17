import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuid } from "uuid";
import * as bcrypt from "bcryptjs";
import { eventBridgeService } from "../../services/eventBridgeService.js";

const db = new DynamoDBClient({});

const jsonHeaders = {
  "Content-Type": "application/json"
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    console.log('[CrearAdmins] Lambda invocada');
    if (!event.body) {
      console.warn('[CrearAdmins] Body vacío');
      return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ message: "Body vacío" }) };
    }

    const { codigo, nombre, correo, password } = JSON.parse(event.body);
    console.log(`[CrearAdmins] Datos recibidos: codigo=${codigo}, nombre=${nombre}, correo=${correo}`);

    if (!codigo || !nombre || !correo || !password) {
      console.warn('[CrearAdmins] Faltan campos obligatorios');
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ message: "Faltan campos obligatorios" })
      };
    }

    if (String(password).length < 8) {
      console.warn('[CrearAdmins] Password menor a 8 caracteres');
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ message: "Password mínimo 8 caracteres" })
      };
    }

    const tableName = process.env.DB_NAME;
    if (!tableName) {
      console.error('[CrearAdmins] Falta configuración: DB_NAME');
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
      console.warn('[CrearAdmins] Correo ya registrado');
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
      console.warn('[CrearAdmins] Código ya registrado');
      return { statusCode: 409, headers: jsonHeaders, body: JSON.stringify({ message: "Código ya registrado" }) };
    }

    // Generar usuario Admin
    const userId = uuid();
    const passwordHash = await bcrypt.hash(String(password), 10);
    console.log(`[CrearAdmins] Usuario admin generado: userId=${userId}`);

    const newUserItem = {
      userId: { S: userId },
      codigo: { S: String(codigo) },
      nombre: { S: String(nombre) },
      correo: { S: String(correo) },
      rol: { S: "admin" },
      area: { S: "admin" },
      passwordHash: { S: passwordHash },
      creadoEn: { S: new Date().toISOString() }
    };

    await db.send(
      new PutItemCommand({
        TableName: tableName,
        Item: newUserItem
      })
    );
    console.log('[CrearAdmins] Usuario admin guardado en DynamoDB');

    // Emitir evento a EventBridge
    await eventBridgeService.publishUsuarioCreado({
      userId,
      codigo: String(codigo),
      nombre: String(nombre),
      correo: String(correo),
      rol: "admin",
      area: "admin"
    });
    console.log('[CrearAdmins] Evento UsuarioCreado (admin) emitido a EventBridge');

    return {
      statusCode: 201,
      headers: jsonHeaders,
      body: JSON.stringify({ message: "Usuario admin creado", userId })
    };
  } catch (err: any) {
    console.error('[CrearAdmins] Error interno:', err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ message: "Error interno", error: err.message })
    };
  }
};
