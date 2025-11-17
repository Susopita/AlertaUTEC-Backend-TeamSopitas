// src/tests/helpers/auth-helper.ts
import axios from 'axios';
import { HTTP_API_URL } from '../test-config'; // Importamos la URL

/**
 * Realiza una llamada de login y devuelve el JWT.
 * Lanza un error si el login falla.
 * @param email Email del usuario
 * @param password Password del usuario
 * @returns El token JWT como un string
 */
export async function getAuthToken(email: string, password: string): Promise<string> {

    console.log(`[AuthHelper] Solicitando token para: ${email}`);

    try {
        const response = await axios.post(`${HTTP_API_URL}/login`, {
            correo: email,
            password: password
        });

        // Verifica que el token exista en la respuesta
        if (response.data && response.data.token) {
            console.log("[AuthHelper] Token JWT obtenido exitosamente.");
            return response.data.token;
        } else {
            // Esto no debería pasar si la API funciona
            throw new Error('Login exitoso pero no se encontró el token en la respuesta.');
        }

    } catch (error: any) {
        // Imprime el error específico de la API para depuración
        console.error('Error al obtener el token de autenticación:', error.response?.data);
        throw new Error(`Fallo en el login para ${email}: ${error.message}`);
    }
}