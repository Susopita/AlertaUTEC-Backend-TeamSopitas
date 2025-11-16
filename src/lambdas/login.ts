import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { v4 as uuid } from "uuid";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";

const db = new DynamoDBClient({});
const eventbridge = new EventBridgeClient({});

export const handler = async (event: any) => {
    try {
        const body = JSON.parse(event.body);

        const { codigo, nombre, correo, password } = body;

        if (!codigo || !nombre || !correo || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Faltan campos obligatorios" })
            };
        }

        const userId = uuid();

        // Hash de la contraseña
        const passwordHash = await bcrypt.hash(password, 10);

        const userItem = {
            userId:      { S: userId },
            codigo:      { S: codigo },
            nombre:      { S: nombre },
            correo:      { S: correo },
            rol:         { S: "estudiante" },
            area:        { S: "estudiante" },
            creadoEn:    { S: new Date().toISOString() },
            passwordHash:{ S: passwordHash }
        };

        await db.send(new PutItemCommand({
            TableName: process.env.DB_NAME,
            Item: userItem
        }));

        // Enviar evento a EventBridge
        await eventbridge.send(new PutEventsCommand({
            Entries: [
                {
                    Source: "alertautec.usuario",
                    DetailType: "UsuarioCreado",
                    Detail: JSON.stringify({ userId, codigo, nombre, correo }),
                    EventBusName: process.env.EVENT_BUS_NAME
                }
            ]
        }));

        // JWT
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "Falta configuración: JWT_SECRET" })
            };
        }
        const payload = {
            sub: userId,
            correo,
            codigo,
            nombre,
            rol: "estudiante",
            area: "estudiante"
        };
        const expiresInEnv = process.env.JWT_EXPIRES_IN;
        const expiresIn: string | number = expiresInEnv && expiresInEnv.trim() !== "" ? expiresInEnv : "1h";
        
        const token = jwt.sign(payload, jwtSecret as jwt.Secret, {
            expiresIn: expiresIn as any,
            issuer: "alertautec"
        } as jwt.SignOptions);

        return {
            statusCode: 201,
            body: JSON.stringify({ message: "Usuario creado", userId, token })
        };

    } catch (err: any) {
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno", error: err.message })
        };
    }
};
