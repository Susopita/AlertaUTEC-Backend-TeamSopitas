// src/lambdas/events/onUsuarioCreado.ts
import { EventBridgeEvent } from "aws-lambda";
import { UsuarioCreadoEvent } from "../../events/schemas.js";

/**
 * Lambda consumidora que se ejecuta cuando se crea un usuario
 * Puede enviar emails de bienvenida, crear perfiles adicionales, etc.
 */
export const handler = async (event: EventBridgeEvent<string, UsuarioCreadoEvent>) => {
    try {
        console.log('Evento UsuarioCreado recibido:', JSON.stringify(event, null, 2));

        const { userId, nombre, correo, rol, area } = event.detail;

        // TODO: Aquí puedes agregar lógica adicional:
        // - Enviar email de bienvenida con SES
        // - Crear perfil en otra tabla
        // - Notificar a administradores
        // - Registrar en sistema de analytics

        console.log(`Usuario creado: ${nombre} (${correo}) - Rol: ${rol}, Área: ${area}`);

        // Ejemplo: Si fuera a enviar email
        // await sesClient.send(new SendEmailCommand({
        //     Source: process.env.FROM_EMAIL!,
        //     Destination: { ToAddresses: [correo] },
        //     Message: {
        //         Subject: { Data: 'Bienvenido a AlertaUTEC' },
        //         Body: {
        //             Text: { Data: `Hola ${nombre}, tu cuenta ha sido creada exitosamente.` }
        //         }
        //     }
        // }));

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Evento procesado correctamente' })
        };
    } catch (error) {
        console.error('Error procesando evento UsuarioCreado:', error);
        throw error; // EventBridge reintentará si falla
    }
};
