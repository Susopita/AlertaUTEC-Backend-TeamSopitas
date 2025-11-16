// src/services/eventBridgeService.ts
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { 
    EventSources, 
    EventDetailTypes,
    EventSource,
    EventDetailType,
    UsuarioCreadoEvent,
    IncidenteCreadoEvent,
    IncidenteActualizadoEvent,
    IncidenteEnAtencionEvent,
    IncidenteResueltoEvent,
    CerrarIncidenteEvent,
    IncidenteEliminadoEvent,
    PriorizarIncidenteEvent,
    NotificacionEnviadaEvent
} from "../events/schemas.js";

export class EventBridgeService {
    private client: EventBridgeClient;
    private eventBusName: string;

    constructor() {
        this.client = new EventBridgeClient({});
        this.eventBusName = process.env.EVENT_BUS_NAME || 'default';
    }

    /**
     * Método genérico para publicar eventos a EventBridge
     */
    private async publishEvent<T>(
        source: EventSource,
        detailType: EventDetailType,
        detail: T
    ): Promise<void> {
        try {
            const eventDetail = {
                ...detail,
                timestamp: new Date().toISOString()
            };

            await this.client.send(
                new PutEventsCommand({
                    Entries: [
                        {
                            Source: source,
                            DetailType: detailType,
                            Detail: JSON.stringify(eventDetail),
                            EventBusName: this.eventBusName,
                            Time: new Date()
                        }
                    ]
                })
            );

            console.log(`Evento publicado: ${detailType}`, eventDetail);
        } catch (error) {
            console.error('Error publicando evento a EventBridge:', error);
            // No lanzamos el error para no afectar el flujo principal
            // pero lo registramos para debugging
        }
    }

    // ==================== EVENTOS DE USUARIO ====================

    async publishUsuarioCreado(data: Omit<UsuarioCreadoEvent, 'timestamp'>): Promise<void> {
        await this.publishEvent(
            EventSources.USUARIO,
            EventDetailTypes.USUARIO_CREADO,
            data
        );
    }

    // ==================== EVENTOS DE INCIDENTE ====================

    async publishIncidenteCreado(data: Omit<IncidenteCreadoEvent, 'timestamp'>): Promise<void> {
        await this.publishEvent(
            EventSources.INCIDENTE,
            EventDetailTypes.INCIDENTE_CREADO,
            data
        );
    }

    async publishIncidenteActualizado(data: Omit<IncidenteActualizadoEvent, 'timestamp'>): Promise<void> {
        await this.publishEvent(
            EventSources.INCIDENTE,
            EventDetailTypes.INCIDENTE_ACTUALIZADO,
            data
        );
    }

    async publishPriorizarIncidente(data: Omit<PriorizarIncidenteEvent, 'timestamp'>): Promise<void> {
        await this.publishEvent(
            EventSources.INCIDENTE,
            EventDetailTypes.PRIORIZAR_INCIDENTE,
            data
        );
    }

    async publishIncidenteEnAtencion(data: Omit<IncidenteEnAtencionEvent, 'timestamp'>): Promise<void> {
        await this.publishEvent(
            EventSources.INCIDENTE,
            EventDetailTypes.INCIDENTE_EN_ATENCION,
            data
        );
    }

    async publishIncidenteResuelto(data: Omit<IncidenteResueltoEvent, 'timestamp'>): Promise<void> {
        await this.publishEvent(
            EventSources.INCIDENTE,
            EventDetailTypes.INCIDENTE_RESUELTO,
            data
        );
    }

    async publishCerrarIncidente(data: Omit<CerrarIncidenteEvent, 'timestamp'>): Promise<void> {
        await this.publishEvent(
            EventSources.INCIDENTE,
            EventDetailTypes.CERRAR_INCIDENTE,
            data
        );
    }

    async publishIncidenteEliminado(data: Omit<IncidenteEliminadoEvent, 'timestamp'>): Promise<void> {
        await this.publishEvent(
            EventSources.INCIDENTE,
            EventDetailTypes.INCIDENTE_ELIMINADO,
            data
        );
    }

    // ==================== EVENTOS DE NOTIFICACIÓN ====================

    async publishNotificacionEnviada(data: Omit<NotificacionEnviadaEvent, 'timestamp'>): Promise<void> {
        await this.publishEvent(
            EventSources.NOTIFICACION,
            EventDetailTypes.NOTIFICACION_ENVIADA,
            data
        );
    }
}

// Exportar instancia singleton para reutilizar
export const eventBridgeService = new EventBridgeService();
