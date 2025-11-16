// Test para la función register
import { handler } from './dist/lambdas/register.js';

// Mock de variables de entorno
process.env.DB_NAME = 'DBUsuarios';
process.env.EVENT_BUS_NAME = 'default';

// Función helper para crear eventos de prueba
function createTestEvent(body) {
    return {
        body: JSON.stringify(body),
        headers: {},
        httpMethod: 'POST',
        isBase64Encoded: false,
        path: '/register',
        pathParameters: null,
        queryStringParameters: null,
        requestContext: {
            accountId: '123456789',
            apiId: 'test-api',
            domainName: 'test.execute-api.us-east-1.amazonaws.com',
            requestId: 'test-request-id',
            requestTime: new Date().toISOString(),
            routeKey: 'POST /register',
        },
        resource: '/register',
        stageVariables: null,
    };
}

// Tests
async function runTests() {
    console.log('🧪 Iniciando tests para la función register...\n');

    // Test 1: Body vacío
    console.log('📝 Test 1: Body vacío');
    try {
        const result = await handler({ body: null });
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   Respuesta: ${result.body}`);
        console.log(`   ✅ Test 1 ${result.statusCode === 400 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}\n`);
    }

    // Test 2: Campos faltantes
    console.log('📝 Test 2: Campos obligatorios faltantes');
    try {
        const event = createTestEvent({ codigo: '12345' });
        const result = await handler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   Respuesta: ${result.body}`);
        console.log(`   ✅ Test 2 ${result.statusCode === 400 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}\n`);
    }

    // Test 3: Password muy corto
    console.log('📝 Test 3: Password menor a 8 caracteres');
    try {
        const event = createTestEvent({
            codigo: '20210001',
            nombre: 'Juan Pérez',
            correo: 'juan@utec.edu.pe',
            password: '123'
        });
        const result = await handler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   Respuesta: ${result.body}`);
        console.log(`   ✅ Test 3 ${result.statusCode === 400 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}\n`);
    }

    // Test 4: Datos válidos (esto intentará conectar con DynamoDB real)
    console.log('📝 Test 4: Registro con datos válidos');
    console.log('   ⚠️  Este test requiere conexión a AWS DynamoDB real');
    try {
        const event = createTestEvent({
            codigo: `TEST${Date.now()}`,
            nombre: 'Usuario Test',
            correo: `test${Date.now()}@utec.edu.pe`,
            password: 'password123'
        });
        const result = await handler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   Respuesta: ${result.body}`);
        if (result.statusCode === 201) {
            console.log(`   ✅ Test 4 PASÓ - Usuario creado exitosamente\n`);
        } else if (result.statusCode === 500) {
            console.log(`   ⚠️  Test 4 - Error de AWS (esperado sin credenciales configuradas)\n`);
        } else {
            console.log(`   ❌ Test 4 FALLÓ con código inesperado\n`);
        }
    } catch (error) {
        console.log(`   ⚠️  Error esperado (sin credenciales AWS): ${error.message}\n`);
    }

    console.log('✨ Tests completados');
}

// Ejecutar tests
runTests().catch(console.error);
