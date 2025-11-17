import { getAuthToken } from './helpers/auth-helper';
import { WsTestClient } from './helpers/ws-test-client';
import { WEBSOCKET_URL } from './test-config';

// --- Credenciales del Usuario de Prueba ---
const TEST_USER_EMAIL = 'tu-usuario-de-prueba@gmail.com';
const TEST_USER_PASSWORD = 'Password123!';
const VISTA_COMPARTIDA = "view#main_list"; // La vista que ambos escucharán

// --- Clientes ---
let clientA: WsTestClient; // El "Listener" (Escucha)
let clientB: WsTestClient; // El "Actor" (Crea el incidente)
let validJwt: string;

// -----------------------------------------------------------------
// 1. ANTES DE TODAS LAS PRUEBAS
// -----------------------------------------------------------------
beforeAll(async () => {
    // 1. Obtener el JWT (solo 1 vez)
    validJwt = await getAuthToken(TEST_USER_EMAIL, TEST_USER_PASSWORD);

    // 2. Crear los dos clientes
    clientA = new WsTestClient(WEBSOCKET_URL);
    clientB = new WsTestClient(WEBSOCKET_URL);

    // 3. Conectar ambos en paralelo
    console.log("Conectando clientes A y B...");
    await Promise.all([
        clientA.connect(),
        clientB.connect()
    ]);

    // 4. Autenticar ambos en paralelo
    console.log("Autenticando clientes A y B...");
    await Promise.all([
        clientA.authenticate(validJwt),
        clientB.authenticate(validJwt)
    ]);

    // 5. Suscribir ambos a la misma vista
    console.log(`Suscribiendo clientes A y B a ${VISTA_COMPARTIDA}...`);
    await Promise.all([
        clientA.subscribe(VISTA_COMPARTIDA),
        clientB.subscribe(VISTA_COMPARTIDA)
    ]);

    console.log("Setup completado. Ambos clientes listos.");
}, 30000); // 30 segundos de timeout para todo el setup

// -----------------------------------------------------------------
// 2. DESPUÉS DE TODAS LAS PRUEBAS
// -----------------------------------------------------------------
afterAll(() => {
    if (clientA) clientA.close();
    if (clientB) clientB.close();
    console.log("Pruebas finalizadas. Clientes desconectados.");
});

// -----------------------------------------------------------------
// 3. LA PRUEBA PRINCIPAL
// -----------------------------------------------------------------
describe('Flujo de Creación y Notificación de Incidentes', () => {

    test('Cliente B crea un incidente y Cliente A recibe la notificación', async () => {

        // Datos del nuevo incidente
        const incidenteDescripcion = `Incidente E2E - ${Date.now()}`;
        const incidenteCategoria = "Prueba E2E";

        // --------------------------------
        // 1. PREPARAR LOS LISTENERS (¡La parte clave!)
        // --------------------------------

        // Cliente A (Listener) espera la notificación PROPAGADA.
        // Esta viene de SQS, así que le damos un timeout largo.
        // Asumo que tu Lambda 'procesarQueueIncidentes' envía "IncidenteCreado"
        const promesaNotificacion = clientA.waitForMessage("IncidenteCreado", 15000);

        // Cliente B (Actor) espera la respuesta DIRECTA de la Lambda 'crearIncidente'.
        // Esto es rápido.
        const promesaRespuestaDirecta = clientB.waitForMessage("crearIncidenteSuccess", 5000);

        // --------------------------------
        // 2. EJECUTAR LA ACCIÓN
        // --------------------------------
        console.log("Cliente B enviando 'crearIncidente'...");
        clientB.send({
            action: "crearIncidente",
            descripcion: incidenteDescripcion,
            categoria: incidenteCategoria,
            urgencia: "bajo"
        });

        // --------------------------------
        // 3. ESPERAR Y VERIFICAR (Las 2 cosas que pediste)
        // --------------------------------
        console.log("Esperando respuesta directa y notificación propagada...");
        const [respuestaDirecta, notificacion] = await Promise.all([
            promesaRespuestaDirecta,
            promesaNotificacion
        ]);

        // Verificación 1: Cliente B (Actor) recibió éxito
        console.log("Verificando respuesta directa (Cliente B)...");
        expect(respuestaDirecta.action).toBe("crearIncidenteSuccess");
        expect(respuestaDirecta.mensaje).toBe("Incidente creado");
        expect(respuestaDirecta.incidenciaId).toBeDefined();

        // Verificación 2: Cliente A (Listener) recibió la propagación
        console.log("Verificando notificación propagada (Cliente A)...");
        expect(notificacion.action).toBe("IncidenteCreado");
        expect(notificacion.payload.descripcion).toBe(incidenteDescripcion);

        // ¡La prueba de oro!
        expect(notificacion.payload.incidenciaId).toBe(respuestaDirecta.incidenciaId);
        console.log("¡Éxito! Notificación propagada correctamente.");
    });
});