import WebSocket from 'ws';
import { getAuthToken } from './helpers/auth-helper.js'; // 👈 1. Importa el helper
import { WEBSOCKET_URL } from './test-config.js';       // 👈 2. Importa la URL

// --- Credenciales del Usuario de Prueba ---
// (Este usuario debe existir en tu base de datos de 'dev')
const TEST_USER_EMAIL = 'tu-usuario-de-prueba@gmail.com';
const TEST_USER_PASSWORD = 'Password123!';

// --- Variables Globales de la Prueba ---
let ws: WebSocket;
let validJwt: string; // Aquí guardaremos el token

// -----------------------------------------------------------------
// 💡 USA 'beforeAll' PARA LOGUEARTE UNA VEZ ANTES DE TODAS LAS PRUEBAS
// -----------------------------------------------------------------
beforeAll(async () => {
    // 3. Llama a tu helper encapsulado para obtener el token
    validJwt = await getAuthToken(TEST_USER_EMAIL, TEST_USER_PASSWORD);

    // Verificación rápida de que obtuvimos un token
    expect(validJwt).toBeDefined();
    expect(validJwt.length).toBeGreaterThan(50);

    // 4. Ahora, con el token, conecta al WebSocket
    ws = new WebSocket(WEBSOCKET_URL);
    await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
            console.log("Conexión WS de prueba abierta.");
            resolve();
        };
        ws.onerror = (err) => reject(err);
    });
});

afterAll(() => {
    if (ws) ws.close();
});

// -----------------------------------------------------------------
// TUS PRUEBAS DE WEBSOCKET
// -----------------------------------------------------------------
describe('Flujo de WebSocket (Autenticado)', () => {

    test('debería autenticar la conexión WebSocket usando el JWT', async () => {

        // Función para esperar la respuesta de 'auth-success'
        const waitForAuth = new Promise((resolve, reject) => {
            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data as string);
                if (msg.action === 'auth-success') {
                    resolve(msg);
                }
            };
            setTimeout(() => reject(new Error("Timeout en 'authenticate'")), 5000);
        });

        // 5. Usa el token que obtuvimos en 'beforeAll'
        ws.send(JSON.stringify({
            action: "authenticate",
            token: validJwt
        }));

        // Espera a que el servidor confirme la autenticación
        const response: any = await waitForAuth;
        expect(response.action).toBe("auth-success");
    });

    test('debería fallar al crear un incidente si no está autenticado', async () => {
        // (Aquí probarías sin llamar a 'authenticate' primero)
    });
});