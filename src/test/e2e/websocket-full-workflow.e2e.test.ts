/**
 * E2E real: prueba el flujo completo usando WebSocket real y backend local (serverless-offline)
 * Requiere: npm run offline en otra terminal
 */
import WebSocket from 'ws';
import axios from 'axios';

const WS_URL = 'ws://localhost:4001'; // serverless-offline websocket port
const HTTP_URL = 'http://localhost:4000'; // serverless-offline http port

function wait(ms: number) { return new Promise(res => setTimeout(res, ms)); }

describe('E2E WebSocket workflow real', () => {
  let ws: WebSocket;
  let messages: any[] = [];

  beforeAll((done) => {
    ws = new WebSocket(WS_URL);
    ws.on('open', () => {
      // Suscribirse a la vista de incidentes (ajusta según tu protocolo)
      ws.send(JSON.stringify({ action: 'suscribe', viewId: 'incidentes' }));
      done();
    });
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {
        messages.push(data.toString());
      }
    });
  });

  afterAll((done) => {
    ws.send(JSON.stringify({ action: 'unsuscribe', viewId: 'incidentes' }));
    ws.close();
    done();
  });

  beforeEach(() => { messages = []; });

  it('Recibe notificación al crear incidente', async () => {
    // Simula crear incidente vía HTTP (ajusta endpoint y payload según tu API)
    await axios.post(`${HTTP_URL}/crearIncidente`, {
      titulo: 'Test', descripcion: 'desc', urgencia: 'alta', tipo: 'tipo', creadoPor: 'test-user'
    });
    // Espera a que llegue el mensaje por WebSocket
    await wait(1000);
    expect(messages.some(m => m.action === 'incidenteCreado')).toBe(true);
  });

  it('Recibe notificación al actualizar incidente', async () => {
    // Simula actualizar incidente (ajusta endpoint y payload)
    await axios.post(`${HTTP_URL}/actualizarIncidente`, {
      incidenciaId: 'inc-1', campos: ['descripcion'], actualizadoPor: 'test-user'
    });
    await wait(1000);
    expect(messages.some(m => m.action === 'incidenteActualizado')).toBe(true);
  });

  // Puedes agregar más tests para priorizar, eliminar, etc.
});
