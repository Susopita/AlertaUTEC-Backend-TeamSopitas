import { SQSEvent } from "aws-lambda";

// Mocks de AWS SDK v3 (DynamoDB DocClient + ApiGatewayManagementApi)
const ddbSendMock = jest.fn();
const apigwSendMock = jest.fn();

class QueryCommandMock { constructor(public input:any) {} }
class DeleteCommandMock { constructor(public input:any) {} }
class ScanCommandMock { constructor(public input:any) {} }
class PostToConnectionCommandMock { constructor(public input:any) {} }

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: ddbSendMock }) },
  QueryCommand: QueryCommandMock,
  DeleteCommand: DeleteCommandMock,
  ScanCommand: ScanCommandMock
}));

jest.mock("@aws-sdk/client-apigatewaymanagementapi", () => ({
  ApiGatewayManagementApiClient: jest.fn().mockImplementation(() => ({ send: apigwSendMock })),
  PostToConnectionCommand: PostToConnectionCommandMock
}));

let notifyHandler: any;
beforeAll(async () => {
  ({ handler: notifyHandler } = await import("../../lambdas/ws/NotificarIncidente.js"));
});

beforeEach(() => {
  process.env.AWS_REGION = "us-east-1";
  process.env.WS_TABLE = "WSConnections";
  process.env.WS_API_ENDPOINT = "https://example.execute-api.us-east-1.amazonaws.com/dev";
  process.env.WS_GSI_VIEWID = "GSI-viewId";
  process.env.WS_GSI_SUBKEY = "GSI-subscriptionKey";
  ddbSendMock.mockReset();
  apigwSendMock.mockReset();
});

function makeSQSEvent(records: Array<{ body: any }>): SQSEvent {
  return {
    Records: records.map((r, idx) => ({
      messageId: String(idx + 1),
      receiptHandle: "rh",
      body: typeof r.body === "string" ? r.body : JSON.stringify(r.body),
      attributes: {} as any,
      messageAttributes: {} as any,
      md5OfBody: "",
      eventSource: "aws:sqs",
      eventSourceARN: "arn:aws:sqs:region:acct:queue",
      awsRegion: "us-east-1"
    }))
  } as SQSEvent;
}

describe("Lambda NotificarIncidente - SQS → WS", () => {
  test("notifica por subscriptionKey y limpia conexiones 410", async () => {
    // 1) Primera Query por GSI de subscriptionKey
    ddbSendMock.mockImplementationOnce((cmd: any) => {
      expect(cmd).toBeInstanceOf(QueryCommandMock);
      expect(cmd.input.IndexName).toBe("GSI-subscriptionKey");
      return Promise.resolve({ Items: [
        { connectionId: "c1", viewId: "view#x" },
        { connectionId: "c2", viewId: "view#x" }
      ]});
    });

    // 2) Post a c1 → retornar 410 para forzar limpieza
    apigwSendMock.mockImplementationOnce((cmd:any) => {
      expect(cmd).toBeInstanceOf(PostToConnectionCommandMock);
      expect(cmd.input.ConnectionId).toBe("c1");
      const err:any = new Error("Gone");
      (err as any).$metadata = { httpStatusCode: 410 };
      return Promise.reject(err);
    });

    // 3) Query por connectionId= c1 para cleanup
    ddbSendMock.mockImplementationOnce((cmd:any) => {
      expect(cmd).toBeInstanceOf(QueryCommandMock);
      expect(cmd.input.KeyConditionExpression).toContain("connectionId");
      return Promise.resolve({ Items: [
        { connectionId: "c1", viewId: "view#a" },
        { connectionId: "c1", viewId: "view#b" }
      ]});
    });

    // 4) Delete de ambas filas
    ddbSendMock.mockImplementationOnce((cmd:any) => {
      expect(cmd).toBeInstanceOf(DeleteCommandMock);
      expect(cmd.input.Key.connectionId).toBe("c1");
      expect(cmd.input.Key.viewId).toBe("view#a");
      return Promise.resolve({});
    });
    ddbSendMock.mockImplementationOnce((cmd:any) => {
      expect(cmd).toBeInstanceOf(DeleteCommandMock);
      expect(cmd.input.Key.viewId).toBe("view#b");
      return Promise.resolve({});
    });

    // 5) Post a c2 → OK
    apigwSendMock.mockImplementationOnce((cmd:any) => {
      expect(cmd).toBeInstanceOf(PostToConnectionCommandMock);
      expect(cmd.input.ConnectionId).toBe("c2");
      return Promise.resolve({});
    });

    const event = makeSQSEvent([{ body: { subscriptionKey: "view#incident:123", eventType: "IncidenteCreado", payload: { foo: 1 } } }]);

    await expect(notifyHandler(event)).resolves.toBeUndefined();

    // Dos envíos: c1 (410) y c2 (ok)
    expect(apigwSendMock).toHaveBeenCalledTimes(2);
  });

  test("notifica por viewId cuando no hay subscriptionKey", async () => {
    // Query por GSI de viewId
    ddbSendMock.mockImplementationOnce((cmd:any) => {
      expect(cmd).toBeInstanceOf(QueryCommandMock);
      expect(cmd.input.IndexName).toBe("GSI-viewId");
      return Promise.resolve({ Items: [ { connectionId: "c9", viewId: "view#inc:9" } ]});
    });

    // Post OK
    apigwSendMock.mockImplementationOnce((cmd:any) => {
      expect(cmd.input.ConnectionId).toBe("c9");
      return Promise.resolve({});
    });

    const event = makeSQSEvent([{ body: { viewId: "view#inc:9", eventType: "IncidenteActualizado", payload: { bar: 2 } } }]);
    await expect(notifyHandler(event)).resolves.toBeUndefined();

    expect(apigwSendMock).toHaveBeenCalledTimes(1);
  });
});
