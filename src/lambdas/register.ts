import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuid } from "uuid";
import * as bcrypt from "bcryptjs";
import { eventBridgeService } from "../services/eventBridgeService.js";

const db = new DynamoDBClient({});

const jsonHeaders = {
    "Content-Type": "application/json"
};

export const handler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    try {
        if (!event.body) {
            return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ message: "Body vacío" }) };
        }

        const { codigo, nombre, correo, password } = JSON.parse(event.body);

        if (!codigo || !nombre || !correo || !password) {
            return {
                statusCode: 400,
                headers: jsonHeaders,
                body: JSON.stringify({ message: "Faltan campos obligatorios" })
            };
        }

        if (String(password).length < 8) {
            return {
                statusCode: 400,
                headers: jsonHeaders,
                body: JSON.stringify({ message: "Password mínimo 8 caracteres" })
            };
        }

        const tableName = process.env.DB_NAME;
        if (!tableName) {
            return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ message: "Falta configuración: DB_NAME" }) };
        }

        // ↓↓↓ PREVENIR DUPLICADOS USANDO GSI ↓↓↓
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
            return { statusCode: 409, headers: jsonHeaders, body: JSON.stringify({ message: "Correo ya registrado" }) };
        }

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
            return { statusCode: 409, headers: jsonHeaders, body: JSON.stringify({ message: "Código ya registrado" }) };
        }

        // Generar usuario
        const userId = uuid();
        const passwordHash = await bcrypt.hash(String(password), 10);

        const newUserItem = {
            userId: { S: userId },
            codigo: { S: String(codigo) },
            nombre: { S: String(nombre) },
            correo: { S: String(correo) },
            rol: { S: "estudiante" },
            area: { S: "estudiante" },
            passwordHash: { S: passwordHash },
            creadoEn: { S: new Date().toISOString() }
        };

        await db.send(
            new PutItemCommand({
                TableName: tableName,
                Item: newUserItem
            })
        );

        // Emitir evento a EventBridge usando el servicio
        await eventBridgeService.publishUsuarioCreado({
            userId,
            codigo: String(codigo),
            nombre: String(nombre),
            correo: String(correo),
            rol: "estudiante",
            area: "estudiante"
        });

        return {
            statusCode: 201,
            headers: jsonHeaders,
            body: JSON.stringify({ message: "Usuario creado", userId })
        };
    } catch (err: any) {
        return {
            statusCode: 500,
            headers: jsonHeaders,
            body: JSON.stringify({ message: "Error interno", error: err.message })
        };
    }
};
