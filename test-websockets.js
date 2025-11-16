// Tests para las funciones WebSocket
import { handler as listarIncidenciasHandler } from './dist/lambdas/ws/ListarIncidencias.js';
import { handler as cerrarIncidenteHandler } from './dist/lambdas/ws/CerrarIncidente.js';
import { handler as priorizarHorizontalmenteHandler } from './dist/lambdas/ws/PriorizarHorizontalmente.js';
import { handler as priorizarVerticalmenteHandler } from './dist/lambdas/ws/PriorizarVerticalmente.js';
import jwt from 'jsonwebtoken';

// Mock de variables de entorno
process.env.INCIDENTS_TABLE = 'IncidenciasTable';
process.env.JWT_SECRET = 'test-secret-key-12345';

// Generar tokens de prueba
const jwtSecret = process.env.JWT_SECRET;

const tokenEstudiante = jwt.sign({
    sub: 'user-123',
    correo: 'estudiante@utec.edu.pe',
    codigo: '20210001',
    nombre: 'Juan Estudiante',
    rol: 'estudiante',
    area: 'estudiante'
}, jwtSecret, { expiresIn: '1h', issuer: 'alertautec' });

const tokenAdmin = jwt.sign({
    sub: 'admin-123',
    correo: 'admin@utec.edu.pe',
    codigo: '00000001',
    nombre: 'Admin Usuario',
    rol: 'admin',
    area: 'admin'
}, jwtSecret, { expiresIn: '1h', issuer: 'alertautec' });

const tokenAutoridad = jwt.sign({
    sub: 'auth-123',
    correo: 'autoridad@utec.edu.pe',
    codigo: '00000002',
    nombre: 'Autoridad Usuario',
    rol: 'autoridad',
    area: 'seguridad'
}, jwtSecret, { expiresIn: '1h', issuer: 'alertautec' });

// Función helper para crear eventos WebSocket
function createWSEvent(body, queryParams = {}) {
    return {
        body: JSON.stringify(body),
        requestContext: {
            connectionId: 'test-connection-id',
            domainName: 'test.execute-api.us-east-1.amazonaws.com',
            stage: 'dev',
            routeKey: 'testRoute',
            requestId: 'test-request-id',
            apiId: 'test-api'
        },
        queryStringParameters: queryParams,
        isBase64Encoded: false
    };
}

// Tests
async function runTests() {
    console.log('🌐 Iniciando tests para funciones WebSocket...\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 TESTS LISTAR INCIDENCIAS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 1: Sin token
    console.log('📝 Test 1: Listar incidencias sin token');
    try {
        const event = createWSEvent({}, {});
        const result = await listarIncidenciasHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ${result.statusCode === 401 ? '✅' : '❌'} Test 1 ${result.statusCode === 401 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ⚠️  Error esperado: ${error.message}\n`);
    }

    // Test 2: Con token válido (requiere AWS)
    console.log('📝 Test 2: Listar incidencias con token válido de estudiante');
    console.log('   ⚠️  Este test requiere conexión a AWS DynamoDB real');
    try {
        const event = createWSEvent({}, { token: tokenEstudiante });
        const result = await listarIncidenciasHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ${result.statusCode === 200 || result.statusCode === 500 ? '⚠️' : '❌'} Test 2 - Error esperado sin AWS configurado\n`);
    } catch (error) {
        console.log(`   ⚠️  Error esperado (sin credenciales AWS): ${error.message}\n`);
    }

    // Test 3: Con token de autoridad (requiere AWS)
    console.log('📝 Test 3: Listar incidencias con token de autoridad');
    console.log('   ⚠️  Este test requiere conexión a AWS DynamoDB real');
    try {
        const event = createWSEvent({}, { token: tokenAutoridad });
        const result = await listarIncidenciasHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ⚠️  Test 3 - Error esperado sin AWS configurado\n`);
    } catch (error) {
        console.log(`   ⚠️  Error esperado: ${error.message}\n`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔒 TESTS CERRAR INCIDENTE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 4: Campos faltantes
    console.log('📝 Test 4: Cerrar incidente sin campos requeridos');
    try {
        const event = createWSEvent({ incidenciaId: 'inc-123' });
        const result = await cerrarIncidenteHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ${result.statusCode === 400 ? '✅' : '❌'} Test 4 ${result.statusCode === 400 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ⚠️  Error: ${error.message}\n`);
    }

    // Test 5: Token inválido
    console.log('📝 Test 5: Cerrar incidente con token inválido');
    try {
        const event = createWSEvent({
            incidenciaId: 'inc-123',
            token: 'token-invalido'
        });
        const result = await cerrarIncidenteHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ${result.statusCode === 401 ? '✅' : '❌'} Test 5 ${result.statusCode === 401 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ⚠️  Error: ${error.message}\n`);
    }

    // Test 6: Usuario no admin
    console.log('📝 Test 6: Cerrar incidente con usuario no admin');
    try {
        const event = createWSEvent({
            incidenciaId: 'inc-123',
            token: tokenEstudiante
        });
        const result = await cerrarIncidenteHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ${result.statusCode === 403 ? '✅' : '❌'} Test 6 ${result.statusCode === 403 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ⚠️  Error: ${error.message}\n`);
    }

    // Test 7: Usuario admin (requiere AWS)
    console.log('📝 Test 7: Cerrar incidente con usuario admin');
    console.log('   ⚠️  Este test requiere conexión a AWS DynamoDB real');
    try {
        const event = createWSEvent({
            incidenciaId: 'inc-123',
            token: tokenAdmin
        });
        const result = await cerrarIncidenteHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ⚠️  Test 7 - Error esperado sin AWS configurado\n`);
    } catch (error) {
        console.log(`   ⚠️  Error esperado: ${error.message}\n`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⬆️  TESTS PRIORIZAR HORIZONTALMENTE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 8: Campos faltantes
    console.log('📝 Test 8: Priorizar sin campos requeridos');
    try {
        const event = createWSEvent({ incidenciaId: 'inc-123' });
        const result = await priorizarHorizontalmenteHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ${result.statusCode === 400 ? '✅' : '❌'} Test 8 ${result.statusCode === 400 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ⚠️  Error: ${error.message}\n`);
    }

    // Test 9: Urgencia inválida
    console.log('📝 Test 9: Priorizar con urgencia inválida');
    try {
        const event = createWSEvent({
            incidenciaId: 'inc-123',
            urgencia: 'urgentisimo',
            token: tokenAdmin
        });
        const result = await priorizarHorizontalmenteHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ${result.statusCode === 400 ? '✅' : '❌'} Test 9 ${result.statusCode === 400 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ⚠️  Error: ${error.message}\n`);
    }

    // Test 10: Usuario no admin
    console.log('📝 Test 10: Priorizar con usuario no admin');
    try {
        const event = createWSEvent({
            incidenciaId: 'inc-123',
            urgencia: 'alto',
            token: tokenEstudiante
        });
        const result = await priorizarHorizontalmenteHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ${result.statusCode === 403 ? '✅' : '❌'} Test 10 ${result.statusCode === 403 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ⚠️  Error: ${error.message}\n`);
    }

    // Test 11: Usuario admin con urgencia válida (requiere AWS)
    console.log('📝 Test 11: Priorizar con admin y urgencia válida');
    console.log('   ⚠️  Este test requiere conexión a AWS DynamoDB real');
    try {
        const event = createWSEvent({
            incidenciaId: 'inc-123',
            urgencia: 'alto',
            token: tokenAdmin
        });
        const result = await priorizarHorizontalmenteHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ⚠️  Test 11 - Error esperado sin AWS configurado\n`);
    } catch (error) {
        console.log(`   ⚠️  Error esperado: ${error.message}\n`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('↕️  TESTS PRIORIZAR VERTICALMENTE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 12: Campos faltantes
    console.log('📝 Test 12: Priorizar verticalmente sin campos');
    try {
        const event = createWSEvent({ incidenciaId: 'inc-123' });
        const result = await priorizarVerticalmenteHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ${result.statusCode === 400 ? '✅' : '❌'} Test 12 ${result.statusCode === 400 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ⚠️  Error: ${error.message}\n`);
    }

    // Test 13: nuevoIndex inválido (negativo)
    console.log('📝 Test 13: Priorizar con índice negativo');
    try {
        const event = createWSEvent({
            incidenciaId: 'inc-123',
            nuevoIndex: -1,
            token: tokenAdmin
        });
        const result = await priorizarVerticalmenteHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ${result.statusCode === 400 ? '✅' : '❌'} Test 13 ${result.statusCode === 400 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ⚠️  Error: ${error.message}\n`);
    }

    // Test 14: Usuario no admin
    console.log('📝 Test 14: Priorizar verticalmente sin ser admin');
    try {
        const event = createWSEvent({
            incidenciaId: 'inc-123',
            nuevoIndex: 0,
            token: tokenEstudiante
        });
        const result = await priorizarVerticalmenteHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ${result.statusCode === 403 ? '✅' : '❌'} Test 14 ${result.statusCode === 403 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ⚠️  Error: ${error.message}\n`);
    }

    // Test 15: Usuario admin con índice válido (requiere AWS)
    console.log('📝 Test 15: Priorizar verticalmente con admin válido');
    console.log('   ⚠️  Este test requiere conexión a AWS DynamoDB real');
    try {
        const event = createWSEvent({
            incidenciaId: 'inc-123',
            nuevoIndex: 0,
            token: tokenAdmin
        });
        const result = await priorizarVerticalmenteHandler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   ⚠️  Test 15 - Error esperado sin AWS configurado\n`);
    } catch (error) {
        console.log(`   ⚠️  Error esperado: ${error.message}\n`);
    }

    console.log('✨ Tests de WebSocket completados');
}

// Ejecutar tests
runTests().catch(console.error);
