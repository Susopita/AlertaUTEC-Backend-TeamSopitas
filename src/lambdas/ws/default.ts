import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";

export const handler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

    const connectionId = event.requestContext.connectionId;
    const domain = event.requestContext.domainName;
    const stage = event.requestContext.stage;

    // ----- ¡EL PASO MÁS IMPORTANTE PARA DEBUGGING! -----
    // Imprime todo el evento en CloudWatch.
    // Aquí verás el 'connectionId', el 'body', y la 'routeKey' que falló.
    console.error(
        "[Default Handler] Ruta no encontrada. Evento completo:",
        JSON.stringify(event, null, 2)
    );

    // Intenta parsear el 'action' que el cliente intentó llamar
    let attemptedAction = "desconocida";
    try {
        const body = JSON.parse(event.body || "{}");
        attemptedAction = body.action || attemptedAction;
    } catch (e) {
        // El body no era JSON
    }

    // ----- PASO OPCIONAL: Avisar al cliente -----
    // Envía un mensaje de error de vuelta al cliente para que 
    // el frontend sepa que la acción falló.
    if (connectionId && domain && stage) {
        const wsClient = new ApiGatewayManagementApi({
            endpoint: `https://${domain}/${stage}`
        });

        try {
            await wsClient.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                    action: "error",
                    message: `Acción no reconocida: '${attemptedAction}'`
                })
            });
        } catch (e) {
            // El cliente ya podría estar desconectado. 
            // Solo lo registramos.
            console.error("[Default Handler] No se pudo enviar error al cliente:", e);
        }
    }

    // Devuelve un 200 a API Gateway. 
    // La ruta $default en sí funcionó, aunque la acción del usuario no.
    return { statusCode: 200, body: "Default handler executed." };
};