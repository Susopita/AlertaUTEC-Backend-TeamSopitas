// src/events/schemas.ts
// Esquemas de eventos para EventBridge

export const EventSources = {
    USUARIO: 'alertautec.usuario',
    INCIDENTE: 'alertautec.incidente',
    NOTIFICACION: 'alertautec.notificacion'
} as const;

export const EventDetailTypes = {
    // Eventos de Usuario
    USUARIO_CREADO: 'UsuarioCreado',
    USUARIO_ACTUALIZADO: 'UsuarioActualizado',
    USUARIO_ELIMINADO: 'UsuarioEliminado',

    // Eventos de Incidente (según diagrama)
    INCIDENTE_CREADO: 'IncidenteCreado',
    INCIDENTE_ACTUALIZADO: 'IncidenteActualizado',
    INCIDENTE_ELIMINADO: 'IncidenteEliminado',
    INCIDENTE_EN_ATENCION: 'IncidenteEnAtencion',
    INCIDENTE_RESUELTO: 'IncidenteResuelto',
    PRIORIZAR_INCIDENTE: 'PriorizarIncidente',
    CERRAR_INCIDENTE: 'CerrarIncidente',

    // Eventos de Notificación
    NOTIFICACION_ENVIADA: 'NotificacionEnviada'
} as const;

// Tipos de eventos

export interface UsuarioCreadoEvent {
    userId: string;
    codigo: string;
    nombre: string;
    correo: string;
    rol: string;
    area: string;
    timestamp: string;
}

export interface UsuarioActualizadoEvent {
    userId: string;
    campos: string[];
    timestamp: string;
}

export interface IncidenteCreadoEvent {
    incidenciaId: string;
    titulo: string;
    descripcion: string;
    urgencia: 'alto' | 'medio' | 'bajo';
    tipo: string;
    ubicacion?: string;
    area?: string;
    creadoPor: string;
    viewId: string;
    timestamp: string;
}

export interface IncidenteActualizadoEvent {
    incidenciaId: string;
    campos: string[];
    actualizadoPor: string;
    timestamp: string;
}

export interface IncidentePriorizadoEvent {
    incidenciaId: string;
    tipoPriorizacion: 'horizontal' | 'vertical';
    nuevaPrioridad: number;
    priorizadoPor: string;
    timestamp: string;
}

export interface IncidenteAsignadoEvent {
    incidenciaId: string;
    asignadoA: string;
    asignadoPor: string;
    timestamp: string;
}

export interface IncidenteEnAtencionEvent {
    incidenciaId: string;
    atendidoPor: string;
    timestamp: string;
}

export interface IncidenteResueltoEvent {
    incidenciaId: string;
    resolucion: string;
    resueltoPor: string;
    timestamp: string;
}

export interface CerrarIncidenteEvent {
    incidenciaId: string;
    cerradoPor: string;
    motivo?: string;
    timestamp: string;
}

export interface IncidenteEliminadoEvent {
    incidenciaId: string;
    eliminadoPor: string;
    timestamp: string;
}

export interface PriorizarIncidenteEvent {
    incidenciaId: string;
    tipoPriorizacion: 'horizontal' | 'vertical';
    nuevaPrioridad: number;
    priorizadoPor: string;
    timestamp: string;
}

export interface NotificacionEnviadaEvent {
    notificacionId: string;
    tipo: string;
    destinatarios: string[];
    mensaje: string;
    timestamp: string;
}

// Union types para type safety
export type EventSource = typeof EventSources[keyof typeof EventSources];
export type EventDetailType = typeof EventDetailTypes[keyof typeof EventDetailTypes];

export type EventDetail =
    | UsuarioCreadoEvent
    | UsuarioActualizadoEvent
    | IncidenteCreadoEvent
    | IncidenteActualizadoEvent
    | IncidenteEnAtencionEvent
    | IncidenteResueltoEvent
    | CerrarIncidenteEvent
    | IncidenteEliminadoEvent
    | PriorizarIncidenteEvent
    | NotificacionEnviadaEvent;
