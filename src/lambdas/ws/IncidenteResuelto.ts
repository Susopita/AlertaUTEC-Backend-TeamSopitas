import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
import * as jwt from "jsonwebtoken";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: any) => {
	console.log('[IncidenteResuelto] Lambda invocada');
	const connectionId = event.requestContext?.connectionId;
	const domain = event.requestContext?.domainName;
	const stage = event.requestContext?.stage;

	const wsClient = new ApiGatewayManagementApi({
		endpoint: `https://${domain}/${stage}`
	});

	try {
		const tableName = process.env.INCIDENTS_TABLE;
		if (!tableName) {
			console.error('[IncidenteResuelto] Falta configuración: INCIDENTS_TABLE');
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Falta configuración: INCIDENTS_TABLE" })
			});
			return { statusCode: 500 };
		}

		if (!event.body) {
			console.warn('[IncidenteResuelto] Body vacío');
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Body vacío" })
			});
			return { statusCode: 400 };
		}

		const body = JSON.parse(event.body);
		const { token } = body || {};
		const id = body?.id ?? body?.incidenteId ?? body?.IncidenteId;
		if (!token) {
			console.warn('[IncidenteResuelto] Token no proporcionado');
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Token no proporcionado" })
			});
			return { statusCode: 401 };
		}
		if (!id) {
			console.warn('[IncidenteResuelto] Id de incidente requerido');
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Id de incidente requerido" })
			});
			return { statusCode: 400 };
		}

		const jwtSecret = process.env.JWT_SECRET;
		if (!jwtSecret) {
			console.error('[IncidenteResuelto] Falta configuración: JWT_SECRET');
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Falta configuración: JWT_SECRET" })
			});
			return { statusCode: 500 };
		}

		let decoded: any;
		try {
			decoded = jwt.verify(token, jwtSecret);
		} catch {
			console.warn('[IncidenteResuelto] Token inválido');
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Token inválido" })
			});
			return { statusCode: 401 };
		}

		const rol = decoded?.rol;
		if (rol !== "autoridad") {
			console.warn('[IncidenteResuelto] No autorizado: rol insuficiente');
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "No autorizado: rol insuficiente" })
			});
			return { statusCode: 403 };
		}

		const pkAttr = process.env.INCIDENTS_TABLE_PK || "id";
		const now = new Date().toISOString();

		try {
			await dynamo.send(new UpdateCommand({
				TableName: tableName,
				Key: { [pkAttr]: id },
				UpdateExpression: "SET #estado = :resuelto, #fechaAct = :now",
				ExpressionAttributeNames: {
					"#estado": "estado",
					"#fechaAct": "fechaActualizacion",
					"#pk": pkAttr
				},
				ExpressionAttributeValues: {
					":resuelto": "resuelto",
					":now": now
				},
				ConditionExpression: "attribute_exists(#pk)"
			}));
		} catch (e: any) {
			if (e?.name === "ConditionalCheckFailedException") {
				await wsClient.postToConnection({
					ConnectionId: connectionId,
					Data: JSON.stringify({ action: "error", message: "Incidente no encontrado" })
				});
				return { statusCode: 404 };
			}
			throw e;
		}

		await wsClient.postToConnection({
			ConnectionId: connectionId,
			Data: JSON.stringify({
				action: "incidenteResueltoResponse",
				id,
				estado: "resuelto"
			})
		});

		return { statusCode: 200 };
	} catch (err: any) {
		try {
			const wsClientErr = new ApiGatewayManagementApi({
				endpoint: `https://${event?.requestContext?.domainName}/${event?.requestContext?.stage}`
			});
			await wsClientErr.postToConnection({
				ConnectionId: event?.requestContext?.connectionId,
				Data: JSON.stringify({ action: "error", message: "Error al resolver incidente" })
			});
		} catch {}
		return { statusCode: 500 };
	}
};
