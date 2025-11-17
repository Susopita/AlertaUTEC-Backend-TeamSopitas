// Mocks de AWS SDK v3 (EventBridge) - declarar ANTES de importar el SUT
const sendMock = jest.fn().mockResolvedValue({});

class PutEventsCommandMock { input: any; constructor(input:any){ this.input = input; } }

jest.mock("@aws-sdk/client-eventbridge", () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: sendMock })),
  PutEventsCommand: PutEventsCommandMock
}));

let eventBridgeService: any;
beforeAll(async () => {
  ({ eventBridgeService } = await import("../../services/eventBridgeService.js"));
});

// Utilidad para extraer el detailType, source y detail publicados
function lastEvent() {
  const call = sendMock.mock.calls[sendMock.mock.calls.length - 1][0] as PutEventsCommandMock;
  const entry = (call as any).input.Entries[0];
  return {
    source: entry.Source,
    detailType: entry.DetailType,
    detail: JSON.parse(entry.Detail)
  };
}

beforeEach(() => {
  process.env.EVENT_BUS_NAME = "mi-bus-test";
  sendMock.mockClear();
});

describe("Publicación de eventos en EventBridge (workflows)", () => {
  test("IncidenteCreado → Source y DetailType correctos", async () => {
    await eventBridgeService.publishIncidenteCreado({
      incidenciaId: "inc-1",
      titulo: "Titulo",
      descripcion: "Desc",
      urgencia: "alto",
      tipo: "tipo",
      creadoPor: "user-1"
    });

    const ev = lastEvent();
    expect(ev.source).toBe("alertautec.incidente");
    expect(ev.detailType).toBe("IncidenteCreado");
    expect(ev.detail.incidenciaId).toBe("inc-1");
  });

  test("IncidenteActualizado → Source y DetailType correctos", async () => {
    await eventBridgeService.publishIncidenteActualizado({
      incidenciaId: "inc-2",
      campos: ["descripcion"],
      actualizadoPor: "user-2"
    });
    const ev = lastEvent();
    expect(ev.source).toBe("alertautec.incidente");
    expect(ev.detailType).toBe("IncidenteActualizado");
  });

  test("IncidenteEliminado → Source y DetailType correctos", async () => {
    await eventBridgeService.publishIncidenteEliminado({
      incidenciaId: "inc-3",
      eliminadoPor: "user-3"
    });
    const ev = lastEvent();
    expect(ev.detailType).toBe("IncidenteEliminado");
  });

  test("IncidenteEnAtencion → Source y DetailType correctos", async () => {
    await eventBridgeService.publishIncidenteEnAtencion({
      incidenciaId: "inc-4",
      atendidoPor: "admin-1"
    });
    const ev = lastEvent();
    expect(ev.detailType).toBe("IncidenteEnAtencion");
  });

  test("IncidenteResuelto → Source y DetailType correctos", async () => {
    await eventBridgeService.publishIncidenteResuelto({
      incidenciaId: "inc-5",
      resolucion: "ok",
      resueltoPor: "admin-2"
    });
    const ev = lastEvent();
    expect(ev.detailType).toBe("IncidenteResuelto");
  });

  test("PriorizarIncidente → Source y DetailType correctos", async () => {
    await eventBridgeService.publishPriorizarIncidente({
      incidenciaId: "inc-6",
      tipoPriorizacion: "horizontal",
      nuevaPrioridad: 10,
      priorizadoPor: "admin-3"
    });
    const ev = lastEvent();
    expect(ev.detailType).toBe("PriorizarIncidente");
  });
});
