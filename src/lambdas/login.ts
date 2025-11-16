import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { v4 as uuid } from "uuid";

const db = new DynamoDBClient({});
const eventbridge = new EventBridgeClient({});

export const handler = async (event: any) => {
    try {
        const body = JSON.parse(event.body);

        const { codigo, nombre, correo } = body;

        if (!codigo || !nombre || !correo) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Faltan campos obligatorios" })
            };
        }

        const userId = uuid();

        const userItem = {
            userId:      { S: userId },
            codigo:      { S: codigo },
            nombre:      { S: nombre },
            correo:      { S: correo },
            rol:         { S: "estudiante" },
            area:        { S: "estudiante" },
            creadoEn:    { S: new Date().toISOString() }
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
