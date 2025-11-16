import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuid } from "uuid";

const db = new DynamoDBClient({});
const eventbridge = new EventBridgeClient({});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ message: "Body vacío" }) };
        }

        const { codigo, nombre, correo } = JSON.parse(event.body);

        if (!codigo || !nombre || !correo) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Faltan campos obligatorios" })
            };
        }

        const userId = uuid();

        const item = {
            userId:   { S: userId },
            codigo:   { S: codigo },
            nombre:   { S: nombre },
            correo:   { S: correo },
            rol:      { S: "estudiante" },  // por defecto
            area:     { S: "estudiante" },  // por defecto
            creadoEn: { S: new Date().toISOString() }
        };

        await db.send(
            new PutItemCommand({
                TableName: process.env.DB_NAME!,
                Item: item
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
