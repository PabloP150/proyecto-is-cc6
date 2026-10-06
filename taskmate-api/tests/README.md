# TaskMate API Tests

Tests unitarios e integración para los servicios del backend.

## Estructura

```
tests/
├── AnalyticsService.test.js        # Servicio de analytics
├── LLMService.test.js              # Servicio WebSocket hacia Python MCP
├── SessionManager.test.js          # Gestión de sesiones WebSocket
├── UserSession.test.js             # Sesión individual de usuario
├── analytics-api.test.js           # Endpoints REST de analytics
├── llm-fallback.test.js            # Fallback cuando el MCP no responde
├── performance.test.js             # Tests de rendimiento
└── integration/
    └── analytics-integration.test.js  # Tests de integración analytics end-to-end
```

## Cobertura por módulo

### SessionManager (`SessionManager.test.js`)
- Creación e inicialización de sesiones
- Limpieza de recursos y gestión de memoria
- Manejo de errores en conexión y cleanup
- Aislamiento entre sesiones múltiples
- Recuperación de sesión por WebSocket y userId

### UserSession (`UserSession.test.js`)
- Inicialización y configuración de contexto
- Procesamiento de mensajes (ping/pong, chat, analytics)
- Comunicación WebSocket con el cliente
- Manejo de errores y reconexión
- Limpieza de recursos y tracking de actividad

### LLMService (`LLMService.test.js`)
- Conexión WebSocket hacia Python MCP (puerto 8001)
- Reenvío de mensajes y manejo de respuestas por sessionId
- Reconexión automática ante caídas
- Manejo de errores de red y timeouts

### AnalyticsService (`AnalyticsService.test.js`)
- Registro de asignaciones y completaciones de tareas
- Cálculo de métricas de usuario y equipo
- Distribución de carga de trabajo
- Rankings de expertise por categoría

## Ejecutar tests

```bash
# Desde taskmate-api/
npm test                        # Todos los tests
npm test -- --coverage          # Con reporte de cobertura
npm test -- --watch             # Modo watch
npm test -- SessionManager      # Un archivo específico
```

## Notas

- Los tests del LLMService mockean la conexión WebSocket al servidor Python MCP
- Los tests de analytics usan mocks de la capa de base de datos (execQuery)
- Los tests de integración requieren conexión activa a SQL Server
