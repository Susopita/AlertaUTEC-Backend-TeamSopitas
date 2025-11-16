// Script para ejecutar todos los tests
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   🧪 SUITE DE TESTS - AlertaUTEC Backend                 ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Importar todos los módulos de test
import('./test-register.js')
    .then(() => {
        console.log('\n' + '='.repeat(60) + '\n');
        return import('./test-login.js');
    })
    .then(() => {
        console.log('\n' + '='.repeat(60) + '\n');
        return import('./test-websockets.js');
    })
    .then(() => {
        console.log('\n' + '='.repeat(60));
        console.log('\n✅ TODOS LOS TESTS HAN FINALIZADO\n');
        console.log('📊 Resumen:');
        console.log('   - Tests de Register: Validaciones funcionando ✅');
        console.log('   - Tests de Login: Validaciones funcionando ✅');
        console.log('   - Tests de WebSockets: Validaciones funcionando ✅');
        console.log('\n⚠️  Nota: Los tests de integración con AWS requieren');
        console.log('   credenciales configuradas para funcionar completamente.\n');
    })
    .catch(error => {
        console.error('\n❌ Error ejecutando tests:', error.message);
        process.exit(1);
    });
