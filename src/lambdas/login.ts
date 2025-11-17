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
        console.log('[Login] Lambda invocada');
        if (!event.body) {
            console.warn('[Login] Body vacío');
            return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ message: "Body vacío" }) };
        }

        const { correo, password } = JSON.parse(event.body);
        console.log(`[Login] Intento de login para: ${correo}`);

        if (!correo || !password) {
            console.warn('[Login] Faltan correo o password');
            return {
                statusCode: 400,
                headers: jsonHeaders,
                body: JSON.stringify({ message: "Faltan correo o password" })
            };
        }

        const tableName = process.env.DB_NAME;
        if (!tableName) {
            console.error('[Login] Falta configuración: DB_NAME');
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
            console.warn('[Login] Credenciales inválidas (correo no encontrado)');
            return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ message: "Credenciales inválidas" }) };
        }

        const user = result.Items[0];
        if (!user) {
            console.warn('[Login] Credenciales inválidas (usuario no encontrado)');
            return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ message: "Credenciales inválidas" }) };
        }

        const passwordHash = user.passwordHash?.S;
        if (!passwordHash) {
            console.error('[Login] Usuario sin contraseña');
            return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ message: "Usuario sin contraseña" }) };
        }

        // Verificar contraseña
        const valid = await bcrypt.compare(password, passwordHash);
        if (!valid) {
            console.warn('[Login] Contraseña incorrecta');
            return {
                statusCode: 401,
                headers: jsonHeaders,
                body: JSON.stringify({ message: "Credenciales inválidas" })
            };
        }

        // JWT
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            console.error('[Login] Falta configuración: JWT_SECRET');
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
        console.log('[Login] Login exitoso para:', correo);

        return {
            statusCode: 200,
            headers: jsonHeaders,
            body: JSON.stringify({
                message: "Login exitoso",
                token
            })
        };
    } catch (err: any) {
        console.error('[Login] Error interno:', err);
        return {
            statusCode: 500,
            headers: jsonHeaders,
            body: JSON.stringify({ message: "Error interno", error: err.message })
        };
    }
};
