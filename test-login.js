// Test para la función login
import { handler } from './dist/lambdas/login.js';

// Mock de variables de entorno
process.env.DB_NAME = 'DBUsuarios';
process.env.JWT_SECRET = 'test-secret-key-12345';
process.env.JWT_EXPIRES_IN = '1h';

// Función helper para crear eventos de prueba
function createTestEvent(body) {
    return {
        body: JSON.stringify(body),
        headers: {},
        httpMethod: 'POST',
        isBase64Encoded: false,
        path: '/login',
        pathParameters: null,
        queryStringParameters: null,
        requestContext: {
            accountId: '123456789',
            apiId: 'test-api',
            domainName: 'test.execute-api.us-east-1.amazonaws.com',
            requestId: 'test-request-id',
            requestTime: new Date().toISOString(),
            routeKey: 'POST /login',
        },
        resource: '/login',
        stageVariables: null,
    };
}

// Tests
async function runTests() {
    console.log('🔐 Iniciando tests para la función login...\n');

    // Test 1: Body vacío
    console.log('📝 Test 1: Body vacío');
    try {
        const result = await handler({ body: null });
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   Respuesta: ${result.body}`);
        console.log(`   ${result.statusCode === 400 ? '✅' : '❌'} Test 1 ${result.statusCode === 400 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}\n`);
    }

    // Test 2: Campos faltantes (sin password)
    console.log('📝 Test 2: Campos obligatorios faltantes');
    try {
        const event = createTestEvent({ correo: 'test@utec.edu.pe' });
        const result = await handler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   Respuesta: ${result.body}`);
        console.log(`   ${result.statusCode === 400 ? '✅' : '❌'} Test 2 ${result.statusCode === 400 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}\n`);
    }

    // Test 3: Campos faltantes (sin correo)
    console.log('📝 Test 3: Campos obligatorios faltantes (sin correo)');
    try {
        const event = createTestEvent({ password: 'password123' });
        const result = await handler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   Respuesta: ${result.body}`);
        console.log(`   ${result.statusCode === 400 ? '✅' : '❌'} Test 3 ${result.statusCode === 400 ? 'PASÓ' : 'FALLÓ'}\n`);
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}\n`);
    }

    // Test 4: Login con datos válidos (requiere AWS)
    console.log('📝 Test 4: Login con credenciales válidas');
    console.log('   ⚠️  Este test requiere conexión a AWS DynamoDB real');
    try {
        const event = createTestEvent({
            correo: 'test@utec.edu.pe',
            password: 'password123'
        });
        const result = await handler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   Respuesta: ${result.body}`);
        if (result.statusCode === 200) {
            console.log(`   ✅ Test 4 PASÓ - Login exitoso\n`);
        } else if (result.statusCode === 401) {
            console.log(`   ⚠️  Test 4 - Usuario no encontrado (esperado sin datos en DB)\n`);
        } else if (result.statusCode === 500) {
            console.log(`   ⚠️  Test 4 - Error de AWS (esperado sin credenciales configuradas)\n`);
        }
    } catch (error) {
        console.log(`   ⚠️  Error esperado (sin credenciales AWS): ${error.message}\n`);
    }

    // Test 5: Credenciales inválidas
    console.log('📝 Test 5: Login con credenciales inválidas');
    try {
        const event = createTestEvent({
            correo: 'noexiste@utec.edu.pe',
            password: 'wrongpassword'
        });
        const result = await handler(event);
        console.log(`   Status: ${result.statusCode}`);
        console.log(`   Respuesta: ${result.body}`);
        if (result.statusCode === 401 || result.statusCode === 500) {
            console.log(`   ⚠️  Test 5 - Error esperado (sin DB configurado)\n`);
        }
    } catch (error) {
        console.log(`   ⚠️  Error esperado: ${error.message}\n`);
    }

    console.log('✨ Tests de login completados');
}

// Ejecutar tests
runTests().catch(console.error);
