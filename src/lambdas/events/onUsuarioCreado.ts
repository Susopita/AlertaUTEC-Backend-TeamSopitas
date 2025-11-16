// src/lambdas/events/onUsuarioCreado.ts
import { EventBridgeEvent } from "aws-lambda";
import { UsuarioCreadoEvent } from "../../events/schemas.js";

/**
 * Lambda consumidora que se ejecuta cuando se crea un usuario
 * Puede enviar emails de bienvenida, crear perfiles adicionales, etc.
 */
export const handler = async (event: EventBridgeEvent<string, UsuarioCreadoEvent>) => {
    try {
        console.log('[onUsuarioCreado] Lambda invocada');
        console.log('[onUsuarioCreado] Evento recibido:', JSON.stringify(event.detail));

        const { userId, nombre, correo, rol, area } = event.detail;

        // ...existing code...
        console.log(`[onUsuarioCreado] Usuario creado: ${nombre} (${correo}) - Rol: ${rol}, Área: ${area}`);

        // ...existing code...
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Evento procesado correctamente' })
        };
    } catch (error) {
        console.error('[onUsuarioCreado] Error:', error);
        throw error; // EventBridge reintentará si falla
    }
};
