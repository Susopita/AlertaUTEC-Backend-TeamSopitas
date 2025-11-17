/**
 * E2E lógico de workflows (sin AWS real):
 * Simula EventBridge Rules → SQS Queues → Lambdas → WebSocket.
 * Verifica mapeos del diagrama completo usando las funciones reales de publicación
 * y las lambdas de procesamiento, con un harness que emula EventBridge y SQS.
 */
import { randomUUID } from 'node:crypto';

// Captura de eventos enviados por EventBridgeService
const putEventsMock = jest.fn();

// Mocks de AWS SDK (EventBridge + DynamoDB + ApiGatewayManagementApi)
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: class { async send(cmd:any){ putEventsMock(cmd); } },
  PutEventsCommand: class { constructor(public input:any){ this.input = input; } }
}));

const ddbSendMock = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: ddbSendMock }) },
  QueryCommand: class { constructor(public input:any){ this.input = input; } }
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));

const wsSendMock = jest.fn();
jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: class { constructor(_:any){} send = wsSendMock; },
  PostToConnectionCommand: class { constructor(public input:any){ this.input = input; } }
}));

// Reglas (copiadas de serverless.yml) para determinar a qué cola va cada detail-type
const RULES = {
  creacionIncidente: ['IncidenteCreado'],
  actualizacionIncidente: ['IncidenteActualizado', 'PriorizarIncidente'],
  incidenteEliminado: ['IncidenteEliminado'],
  incidenteEnAtencion: ['IncidenteEnAtencion'],
  incidenteResuelto: ['IncidenteResuelto', 'CerrarIncidente'],
  clasificacionRequerida: ['IncidenteCreado', 'IncidenteActualizado']
};

// Queues simuladas
const queueIncidentes: any[] = []; // SQS records estilo EventBridge→SQS
const queueOrquestacion: any[] = [];

// Harness que aplica reglas al publicar eventos
function routePublishedEvents() {
  const calls = putEventsMock.mock.calls;
  for (const [cmd] of calls) {
    const entry = cmd.input.Entries[0];
    const detailType = entry.DetailType;
    // Siempre que un evento matchee cualquiera de las reglas de QueueIncidentes, se envía.
    const goesToIncidentes = Object.entries(RULES).some(([rule, types]) => {
      if (rule === 'clasificacionRequerida') return false; // no esta en QueueIncidentes
      return types.includes(detailType);
    });
    if (goesToIncidentes) {
      queueIncidentes.push({ 'detail-type': detailType, detail: JSON.parse(entry.Detail) });
    }
    if (RULES.clasificacionRequerida.includes(detailType)) {
      queueOrquestacion.push({ 'detail-type': detailType, detail: JSON.parse(entry.Detail) });
    }
  }
}

describe('E2E workflows (simulado)', () => {
  let eventBridgeService: any;

  beforeAll(async () => {
    process.env.EVENT_BUS_NAME = 'test-bus';
    process.env.DB_CONEXIONES = 'DBConexiones';
    process.env.WEBSOCKET_ENDPOINT = 'https://ws.example/dev';
    // Conexiones en la vista "incidentes"
    ddbSendMock.mockResolvedValue({ Items: [ { connectionId: 'c1', viewId: 'incidentes' }, { connectionId: 'c2', viewId: 'incidentes' } ] });
    ({ eventBridgeService } = await import('../../services/eventBridgeService.js'));
  });

  beforeEach(() => {
    putEventsMock.mockReset();
    wsSendMock.mockReset();
    queueIncidentes.length = 0;
    queueOrquestacion.length = 0;
  });

  async function publishAllIncidentLifecycle() {
    await eventBridgeService.publishIncidenteCreado({ incidenciaId: 'inc-1', titulo: 'T', descripcion: 'D', urgencia: 'alta', tipo: 'tipo', creadoPor: 'u1' });
    await eventBridgeService.publishIncidenteActualizado({ incidenciaId: 'inc-1', campos: ['descripcion'], actualizadoPor: 'u2' });
    await eventBridgeService.publishPriorizarIncidente({ incidenciaId: 'inc-1', tipoPriorizacion: 'horizontal', nuevaPrioridad: 5, priorizadoPor: 'u3' });
    await eventBridgeService.publishIncidenteEnAtencion({ incidenciaId: 'inc-1', atendidoPor: 'admin1' });
    await eventBridgeService.publishIncidenteResuelto({ incidenciaId: 'inc-1', resolucion: 'ok', resueltoPor: 'admin2' });
    await eventBridgeService.publishCerrarIncidente({ incidenciaId: 'inc-1', cerradoPor: 'admin2' });
    await eventBridgeService.publishIncidenteEliminado({ incidenciaId: 'inc-1', eliminadoPor: 'admin3' });
  }

  async function processQueueIncidentes() {
    const { handler } = await import('../../lambdas/queues/procesarQueueIncidentes.js');
    // Convertir mensajes a evento SQS
    const sqsEvent = {
      Records: queueIncidentes.map((msg, idx) => ({
        messageId: String(idx+1), body: JSON.stringify(msg), receiptHandle: randomUUID(), attributes: {} as any,
        messageAttributes: {} as any, md5OfBody: '', eventSource: 'aws:sqs', eventSourceARN: '', awsRegion: 'us-east-1'
      }))
    } as any;
    await handler(sqsEvent);
  }

  test('Cadena completa: publish → rules → queues → WS', async () => {
    await publishAllIncidentLifecycle();
    routePublishedEvents();

    // Verificaciones de enrutamiento a colas
    const tiposIncidentes = queueIncidentes.map(m => m['detail-type']);
    expect(tiposIncidentes).toEqual(expect.arrayContaining([
      'IncidenteCreado','IncidenteActualizado','PriorizarIncidente','IncidenteEnAtencion','IncidenteResuelto','CerrarIncidente','IncidenteEliminado'
    ]));
    // Clasificación requerida recibe Creado y Actualizado
    const tiposOrquestacion = queueOrquestacion.map(m => m['detail-type']);
    expect(tiposOrquestacion).toEqual(expect.arrayContaining(['IncidenteCreado','IncidenteActualizado']));

    // Procesar cola de incidentes y notificar conexiones
    await processQueueIncidentes();
    // 6 eventos mapeados (CerrarIncidente no tiene acción WS) → 6 * 2 = 12 envíos
    expect(wsSendMock).toHaveBeenCalledTimes(12);

    // Verificar mapeo acción WS por primer envío de cada tipo
    const acciones: Record<string,string> = {};
    for (const call of wsSendMock.mock.calls) {
      const raw = call[0].input.Data;
      const msg = JSON.parse(Buffer.from(raw).toString('utf8'));
      // Guardar primera aparición
      acciones[msg.data?.incidenciaId + msg.action] = msg.action;
    }
    expect(Object.values(acciones)).toEqual(expect.arrayContaining([
      'incidenteCreado','incidenteActualizado','incidentePriorizado','incidenteEnAtencion','incidenteResuelto','incidenteEliminado'
    ]));
  });
});
