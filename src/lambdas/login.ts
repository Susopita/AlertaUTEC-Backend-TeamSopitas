import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";

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

        const { correo, password } = JSON.parse(event.body);

        if (!correo || !password) {
            return {
                statusCode: 400,
                headers: jsonHeaders,
                body: JSON.stringify({ message: "Faltan correo o password" })
            };
        }

        const tableName = process.env.DB_NAME;
        if (!tableName) {
            return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ message: "Falta configuración: DB_NAME" }) };
        }

        // Buscar usuario por correo (GSI: correo-index)
        const result = await db.send(
            new QueryCommand({
                TableName: tableName,
                IndexName: "correo-index",
                KeyConditionExpression: "correo = :c",
                ExpressionAttributeValues: { ":c": { S: String(correo) } },
                Limit: 1
            })
        );

        if (!result.Items || result.Items.length === 0) {
            return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ message: "Credenciales inválidas" }) };
        }

        const user = result.Items[0];
        if (!user) {
            return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ message: "Credenciales inválidas" }) };
        }

        const passwordHash = user.passwordHash?.S;
        if (!passwordHash) {
            return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ message: "Usuario sin contraseña" }) };
        }

        // Verificar contraseña
        const valid = await bcrypt.compare(password, passwordHash);
        if (!valid) {
            return {
                statusCode: 401,
                headers: jsonHeaders,
                body: JSON.stringify({ message: "Credenciales inválidas" })
            };
        }

        // JWT
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            return {
                statusCode: 500,
                headers: jsonHeaders,
                body: JSON.stringify({ message: "Falta configuración: JWT_SECRET" })
            };
        }

        const payload = {
            sub: user.userId?.S,
            correo: user.correo?.S,
            codigo: user.codigo?.S,
            nombre: user.nombre?.S,
            rol: user.rol?.S,
            area: user.area?.S
        };

        const expiresIn: string = process.env.JWT_EXPIRES_IN || "1h";

        const token = jwt.sign(payload, jwtSecret as jwt.Secret, {
            expiresIn,
            issuer: "alertautec"
        } as jwt.SignOptions);

        return {
            statusCode: 200,
            headers: jsonHeaders,
            body: JSON.stringify({
                message: "Login exitoso",
                token
            })
        };
    } catch (err: any) {
        return {
            statusCode: 500,
            headers: jsonHeaders,
            body: JSON.stringify({ message: "Error interno", error: err.message })
        };
    }
};
