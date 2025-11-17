# AlertaUTEC Backend - Team Sopitas

## Descripción General

Este proyecto implementa el backend de la plataforma AlertaUTEC, un sistema de gestión y notificación de incidentes en tiempo real para la Universidad. Utiliza AWS Serverless (Lambda, API Gateway, DynamoDB, SQS, EventBridge) y soporta flujos de trabajo colaborativos, notificaciones WebSocket y orquestación de eventos.

---

## Arquitectura

- **API REST y WebSocket**: Permite registro, login, gestión y notificación de incidentes.
- **Lambdas**: Cada acción (crear, actualizar, priorizar, resolver, eliminar, etc.) es manejada por una función Lambda.
- **EventBridge**: Orquesta eventos de ciclo de vida de incidentes y enruta a colas SQS según reglas.
- **SQS**: Colas para procesamiento de notificaciones y orquestación.
- **DynamoDB**: Persistencia de usuarios, incidentes y conexiones WebSocket.
- **WebSocket**: Notificaciones en tiempo real a los clientes suscritos a vistas específicas.
- **Airflow (ECS)**: Orquestación de análisis batch y reportes diarios.

Ver el diagrama de arquitectura en la carpeta del proyecto.

---

## Estructura del Proyecto

```
src/
  airflow/           # Infraestructura y DAGs de Airflow
  events/            # Esquemas de eventos y tipos
  lambdas/           # Lambdas REST, WS, colas y eventos
    admin/           # Lambdas de administración
    events/          # Lambdas disparadas por eventos
    queues/          # Lambdas procesadoras de SQS
    ws/              # Lambdas WebSocket (acciones, conexión, suscripción)
  services/          # Servicios compartidos (EventBridge, etc.)
  test/              # Pruebas unitarias, E2E y helpers
  utils/             # Utilidades (auth, etc.)
```

---

## Principales Flujos de Trabajo

### 1. Gestión de Incidentes
- **Creación/Actualización/Eliminación**: Lambdas WS reciben acciones, validan y escriben en DynamoDB.
- **Publicación de eventos**: Cada cambio relevante publica un evento en EventBridge.
- **Reglas EventBridge**: Enrutan eventos a las colas SQS correspondientes según el tipo de evento.
- **Procesamiento SQS**: Lambdas leen de las colas y notifican a los WebSockets suscritos a la vista de incidentes.

### 2. Notificaciones en Tiempo Real
- **WebSocket API**: Los clientes se suscriben a vistas (ej: "incidentes").
- **Lambda Notificadora**: Cuando un incidente cambia, se notifica a todas las conexiones activas en la vista.
- **Limpieza de conexiones**: Si una conexión está muerta (410), se elimina de DynamoDB.

### 3. Orquestación y Clasificación
- **Eventos de clasificación requerida**: Algunos eventos se enrutan a la cola de orquestación para procesamiento batch (ej: Airflow).

---

## Pruebas

- **Unitarias**: En `src/test/workflows/` se validan los flujos de eventos, reglas y notificaciones.
- **E2E**: En `src/test/e2e/` hay pruebas que abren WebSockets reales, disparan eventos y verifican la recepción de notificaciones.
- **E2E Auth/WS**: Pruebas de autenticación y ciclo de vida de conexión WebSocket.

Para correr todas las pruebas:
```bash
npm test
```

Para correr solo las E2E reales (requiere entorno local levantado):
```bash
npm test -- src/test/e2e/websocket-full-workflow.e2e.test.ts
```

---

## Entorno Local (Desarrollo)

### Requisitos
- Node.js 18+
- Java 17+ (para DynamoDB local)
- AWS CLI configurado (opcional para deploy)

### Plugins necesarios
- serverless
- serverless-offline
- serverless-offline-sqs
- serverless-dynamodb-local
- serverless-dotenv-plugin

Instala dependencias:
```bash
npm install
```

### Variables de entorno
Crea un archivo `.env` en la raíz con:
```
JWT_SECRET=tu_clave_secreta
JWT_EXPIRES_IN=1d
```

### Levantar entorno local
En una terminal:
```bash
npx serverless dynamodb start --migrate --stage dev
```
En otra terminal:
```bash
npx serverless offline start --stage dev
```

Esto levanta la API REST, WebSocket, SQS y DynamoDB localmente.

---

## Despliegue en AWS

1. **Configura tus credenciales AWS** (con permisos para Lambda, API Gateway, DynamoDB, SQS, EventBridge, IAM, etc.).
2. **Despliega con Serverless Framework:**
   ```bash
   npx serverless deploy --stage prod
   ```
   Puedes cambiar `--stage` por `dev`, `qa`, etc. según tu entorno.
3. **Verifica los endpoints y recursos creados en la consola AWS.**

---

## Seguridad y buenas prácticas
- JWT para autenticación y autorización.
- Validación estricta de payloads y roles en cada lambda.
- Manejo de errores y logs en español para trazabilidad.
- Limpieza automática de conexiones WebSocket muertas.
- Uso de GSIs en DynamoDB para búsquedas eficientes.

---

## Mantenimiento y extensibilidad
- Agrega nuevas reglas de EventBridge en `serverless.yml` y en los tests de workflows.
- Nuevas vistas o tipos de notificación: crea nuevas lambdas WS y ajusta el notificador.
- Para nuevos flujos batch, agrega DAGs en `src/airflow/dags/` y conéctalos vía SQS/EventBridge.

---
