/**
 * Tests de la lambda procesarQueueIncidentes: SQS(EventBridge) → WS
 */
import type { SQSEvent } from 'aws-lambda';

// Mocks primero
const sendMock = jest.fn();
const ddbSendMock = jest.fn();

jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: class {
    constructor(_: any) {}
    send = sendMock
  },
  PostToConnectionCommand: class { constructor(public input: any) { this.input = input; } }
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: ddbSendMock }) },
  QueryCommand: class { constructor(public input: any) { this.input = input; } }
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {}
}));

describe('Queue Incidentes → WebSocket', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, DB_CONEXIONES: 'DBConexiones', WEBSOCKET_ENDPOINT: 'https://ws.example/dev' };
    sendMock.mockReset();
    ddbSendMock.mockReset();
    // Respuesta por defecto: dos conexiones en la vista "incidentes"
    ddbSendMock.mockResolvedValue({ Items: [ { connectionId: 'c1', viewId: 'incidentes' }, { connectionId: 'c2', viewId: 'incidentes' } ] });
  });

  afterAll(() => { process.env = OLD_ENV; });

  async function run(detailType: string, detail: any) {
    const { handler } = await import('../../lambdas/queues/procesarQueueIncidentes.js');
    const sqsEvent: SQSEvent = {
      Records: [
        {
          messageId: '1', receiptHandle: '', body: JSON.stringify({ 'detail-type': detailType, detail }),
          attributes: {} as any, messageAttributes: {} as any, md5OfBody: '', eventSource: 'aws:sqs', eventSourceARN: '', awsRegion: 'us-east-1'
        }
      ]
    } as any;
    await handler(sqsEvent);
  }

  const table: Array<[string, string]> = [
    ['IncidenteCreado', 'incidenteCreado'],
    ['IncidenteActualizado', 'incidenteActualizado'],
    ['IncidenteEliminado', 'incidenteEliminado'],
    ['IncidenteEnAtencion', 'incidenteEnAtencion'],
    ['IncidenteResuelto', 'incidenteResuelto'],
    ['PriorizarIncidente', 'incidentePriorizado']
  ];

  it.each(table)('%s se mapea a acción WS %s y notifica conexiones', async (detailType, expectedAction) => {
    const payload = { incidenciaId: 'inc-1', foo: 1, timestamp: '2025-01-01T00:00:00.000Z' };
    await run(detailType, payload);

    expect(ddbSendMock).toHaveBeenCalled();
    // Dos conexiones notificadas
    expect(sendMock).toHaveBeenCalledTimes(2);
    const datas = sendMock.mock.calls.map((c: any[]) => JSON.parse(Buffer.from(c[0].input.Data).toString('utf8')));
    datas.forEach(d => {
      expect(d.action).toBe(expectedAction);
      expect(d.data).toEqual(payload);
      expect(d.timestamp).toBe(payload.timestamp);
    });
  });

  it('Evento desconocido no notifica', async () => {
    await run('TipoDesconocido', { foo: 'bar' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('Sin WEBSOCKET_ENDPOINT sale temprano sin errores', async () => {
    process.env.WEBSOCKET_ENDPOINT = '' as any;
    const { handler } = await import('../../lambdas/queues/procesarQueueIncidentes.js');
    await handler({ Records: [] } as any);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
