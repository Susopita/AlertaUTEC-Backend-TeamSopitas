import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuid } from "uuid";
import * as bcrypt from "bcryptjs";

const db = new DynamoDBClient({});
const eventbridge = new EventBridgeClient({});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ message: "Body vacío" }) };
        }

        const { codigo, nombre, correo, password } = JSON.parse(event.body);

        if (!codigo || !nombre || !correo || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Faltan campos obligatorios" })
            };
        }
        if (String(password).length < 8) {
            return { statusCode: 400, body: JSON.stringify({ message: "Password mínimo 8 caracteres" }) };
        }

        const tableName = process.env.DB_NAME;
        if (!tableName) {
            return { statusCode: 500, body: JSON.stringify({ message: "Falta configuración: DB_NAME" }) };
        }

        // Intentar prevenir duplicados por correo/codigo si existen GSIs
        try {
            if (correo) {
                const byCorreo = await db.send(new QueryCommand({
                    TableName: tableName,
                    IndexName: "correo-index",
                    KeyConditionExpression: "correo = :c",
                    ExpressionAttributeValues: { ":c": { S: String(correo) } },
                    Limit: 1
                }));
                if ((byCorreo.Items?.length ?? 0) > 0) {
                    return { statusCode: 409, body: JSON.stringify({ message: "Correo ya registrado" }) };
                }
            }
        } catch { /* si no existe el índice, continuar */ }

        try {
            if (codigo) {
                const byCodigo = await db.send(new QueryCommand({
                    TableName: tableName,
                    IndexName: "codigo-index",
                    KeyConditionExpression: "codigo = :k",
                    ExpressionAttributeValues: { ":k": { S: String(codigo) } },
                    Limit: 1
                }));
                if ((byCodigo.Items?.length ?? 0) > 0) {
                    return { statusCode: 409, body: JSON.stringify({ message: "Código ya registrado" }) };
                }
            }
        } catch { /* si no existe el índice, continuar */ }

        const userId = uuid();
        const passwordHash = await bcrypt.hash(String(password), 10);

        const item = {
            userId:   { S: userId },
            codigo:   { S: String(codigo) },
            nombre:   { S: String(nombre) },
            correo:   { S: String(correo) },
            rol:      { S: "estudiante" },  // por defecto
            area:     { S: "estudiante" },  // por defecto
            passwordHash: { S: passwordHash },
            creadoEn: { S: new Date().toISOString() }
        };

        await db.send(
            new PutItemCommand({
                TableName: tableName,
                Item: item
                // Opcional: evitar overwrite por misma PK
                // , ConditionExpression: "attribute_not_exists(userId)"
            })
        );

        // Enviar evento
        await eventbridge.send(
            new PutEventsCommand({
                Entries: [
                    {
                        Source: "alertautec.usuario",
                        DetailType: "UsuarioCreado",
                        Detail: JSON.stringify({ userId, codigo, nombre, correo }),
                        EventBusName: process.env.EVENT_BUS_NAME!
                    }
                ]
            })
        );

        return {
            statusCode: 201,
            body: JSON.stringify({ message: "Usuario creado", userId })
        };
    } catch (err: any) {
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno", error: err.message })
        };
    }
};
