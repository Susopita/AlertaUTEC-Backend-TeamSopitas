import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
import * as jwt from "jsonwebtoken";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: any) => {
	const connectionId = event.requestContext?.connectionId;
	const domain = event.requestContext?.domainName;
	const stage = event.requestContext?.stage;

	const wsClient = new ApiGatewayManagementApi({
		endpoint: `https://${domain}/${stage}`
	});

	try {
		const tableName = process.env.INCIDENTS_TABLE;
		if (!tableName) {
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Falta configuración: INCIDENTS_TABLE" })
			});
			return { statusCode: 500 };
		}

		if (!event.body) {
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
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Token no proporcionado" })
			});
			return { statusCode: 401 };
		}
		if (!id) {
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Id de incidente requerido" })
			});
			return { statusCode: 400 };
		}

		const jwtSecret = process.env.JWT_SECRET;
		if (!jwtSecret) {
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
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Token inválido" })
			});
			return { statusCode: 401 };
		}

		const rol = decoded?.rol;
		if (rol !== "autoridad") {
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
