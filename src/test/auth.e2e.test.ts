import axios from 'axios';
import { HTTP_API_URL } from './test-config';

// Datos de prueba únicos para este test
const testEmail = `test.user.${Date.now()}@example.com`;
const testPassword = 'Password123!';
const testCodigo = `CODE${Date.now()}`;

// Variable para guardar el token entre pruebas
let authToken: string | null = null;

describe('Flujo de Autenticación E2E (HTTP)', () => {

    // Prueba 1: Registro
    test('debería registrar un nuevo usuario exitosamente', async () => {
        try {
            const response = await axios.post(`${HTTP_API_URL}/register`, {
                correo: testEmail,
                password: testPassword,
                codigo: testCodigo,
                nombre: 'Test User'
            });

            // Esperamos un 201 Created
            expect(response.status).toBe(201);
            expect(response.data.message).toBe('Usuario creado');
            expect(response.data.userId).toBeDefined();

        } catch (error: any) {
            // Si falla, imprime el error de la API
            console.error('Error en /register:', error.response?.data);
            throw error;
        }
    });

    // Prueba 2: Login
    test('debería loguear al usuario recién creado y devolver un JWT', async () => {
        try {
            const response = await axios.post(`${HTTP_API_URL}/login`, {
                correo: testEmail,
                password: testPassword
            });

            // Esperamos un 200 OK
            expect(response.status).toBe(200);
            expect(response.data.message).toBe('Login exitoso');
            expect(response.data.token).toBeDefined();

            // Guardamos el token para la siguiente prueba
            authToken = response.data.token;
            console.log('Token JWT obtenido:', authToken?.substring(0, 15) + '...');

        } catch (error: any) {
            console.error('Error en /login:', error.response?.data);
            throw error;
        }
    });

    // Prueba 3: Verificar el token (solo para asegurarnos)
    test('el token obtenido no debe ser nulo', () => {
        expect(authToken).not.toBeNull();
        expect(typeof authToken).toBe('string');
    });

});