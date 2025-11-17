import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
import * as jwt from "jsonwebtoken";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: any) => {
	try {
		console.log('[FiltrarIncidente] Lambda invocada');
		const connectionId = event.requestContext?.connectionId;
		const domain = event.requestContext?.domainName;
		const stage = event.requestContext?.stage;

		const wsClient = new ApiGatewayManagementApi({
			endpoint: `https://${domain}/${stage}`
		});

		const tableName = process.env.INCIDENTS_TABLE;
		if (!tableName) {
			console.error('[FiltrarIncidente] Falta configuración: INCIDENTS_TABLE');
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Falta configuración: INCIDENTS_TABLE" })
			});
			return { statusCode: 500 };
		}

		if (!event.body) {
			console.warn('[FiltrarIncidente] Body vacío');
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Body vacío" })
			});
			return { statusCode: 400 };
		}

		const body = JSON.parse(event.body);
		const { token, estado, ubicacion, prioridad, categoria } = body || {};

		if (!token) {
			console.warn('[FiltrarIncidente] Token no proporcionado');
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Token no proporcionado" })
			});
			return { statusCode: 401 };
		}

		const jwtSecret = process.env.JWT_SECRET;
		if (!jwtSecret) {
			console.error('[FiltrarIncidente] Falta configuración: JWT_SECRET');
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
			console.warn('[FiltrarIncidente] Token inválido');
			await wsClient.postToConnection({
				ConnectionId: connectionId,
				Data: JSON.stringify({ action: "error", message: "Token inválido" })
			});
			return { statusCode: 401 };
		}

		const rol = decoded?.rol;
		const areaUsuario = decoded?.area;

		// Traer incidencias (paginado)
		const incidencias: any[] = [];
		let ExclusiveStartKey: Record<string, any> | undefined = undefined;
		do {
			const page = await dynamo.send(
				new ScanCommand({
					TableName: tableName,
					ExclusiveStartKey
				})
			);
			if (page.Items) incidencias.push(...page.Items);
			ExclusiveStartKey = page.LastEvaluatedKey as any;
		} while (ExclusiveStartKey);

		// Filtros dinámicos
		const norm = (v: any) => (typeof v === "string" ? v.trim().toLowerCase() : v);

		const filtros = {
			estado: norm(estado),
			ubicacion: norm(ubicacion),
			prioridad: norm(prioridad), // Se mapea a campo "urgencia"
			categoria: norm(categoria)
		};

		let resultado = incidencias;

		// Restringir por rol autoridad
		if (rol === "autoridad" && areaUsuario) {
			resultado = resultado.filter((inc: any) => {
				const asignado = inc.AsignadoA || inc.asignadoA;
				return asignado === areaUsuario;
			});
		}

		// Aplicar filtros si vienen
		resultado = resultado.filter((inc: any) => {
			// estado
			if (filtros.estado) {
				const est = norm(inc.estado || inc.Estado);
				if (est !== filtros.estado) return false;
			}
			// ubicacion
			if (filtros.ubicacion) {
				const ubi = norm(inc.ubicacion || inc.Ubicacion);
				if (ubi !== filtros.ubicacion) return false;
			}
			// prioridad -> mapea a urgencia
			if (filtros.prioridad) {
				const urg = norm(inc.urgencia || inc.Urgencia);
				if (urg !== filtros.prioridad) return false;
			}
			// categoria
			if (filtros.categoria) {
				const cat = norm(inc.categoria || inc.Categoria);
				if (cat !== filtros.categoria) return false;
			}
			return true;
		});

		await wsClient.postToConnection({
			ConnectionId: connectionId,
			Data: JSON.stringify({
				action: "filtrarIncidenciasResponse",
				filtros: {
					estado: filtros.estado ?? null,
					ubicacion: filtros.ubicacion ?? null,
					prioridad: filtros.prioridad ?? null,
					categoria: filtros.categoria ?? null
				},
				total: resultado.length,
				incidencias: resultado
			})
		});

		return { statusCode: 200 };
	} catch (err: any) {
		try {
			const wsClient = new ApiGatewayManagementApi({
				endpoint: `https://${event?.requestContext?.domainName}/${event?.requestContext?.stage}`
			});
			await wsClient.postToConnection({
				ConnectionId: event?.requestContext?.connectionId,
				Data: JSON.stringify({ action: "error", message: "Error al filtrar incidencias" })
			});
		} catch {}
		return { statusCode: 500 };
	}
};

