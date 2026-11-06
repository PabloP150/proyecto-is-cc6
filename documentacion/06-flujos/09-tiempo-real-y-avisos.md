# Tiempo real y avisos: flujos

**En una frase:** el navegador se suscribe a sus grupos por `/events`; cuando GitHub avisa de una ejecución o de un deploy (o cambia una solicitud de producción), la API reparte el evento a los miembros, las pantallas se recargan y puede aparecer un aviso.

## Flujo principal: de GitHub al aviso

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuario
    participant FE as RealtimeProvider (navegador)
    participant WS as WebSocketServer /events
    participant HUB as Hub realtime
    participant DB as SQL Server
    participant API as webhookHandler o deployService
    participant GH as GitHub (por smee en desarrollo)

    U->>FE: inicia sesión
    FE->>WS: upgrade a /events?token=JWT
    alt Origin no permitido o token inválido
        WS-->>FE: HTTP 403 o 401, el navegador reintenta más tarde
    end
    WS->>HUB: alta del socket
    FE->>WS: subscribe con los ids de sus grupos
    WS->>HUB: aplica el último subscribe, uno por segundo
    HUB->>DB: es miembro de cada grupo? (UserGroups)
    HUB-->>FE: subscribed con los grupos aceptados
    Note over FE: connected = true, polling lento de 60 s

    GH->>API: webhook workflow_run, workflow_job o deployment_status
    API->>API: verifica la firma HMAC y registra la entrega
    API->>DB: grupos vinculados al repositorio (GroupRepositories)
    API->>HUB: publica ci_run, ci_job o deployment en cada grupo
    Note over API,HUB: deployService publica deploy_request al crear, aprobar, rechazar o cancelar una solicitud
    opt la última comprobación tiene más de 5 min
        HUB->>DB: vuelve a comprobar la membresía
    end
    HUB-->>FE: event con event, gid, data y at
    FE->>FE: las pantallas de ese grupo recargan sus datos
    FE-->>U: aviso abajo a la derecha, si le corresponde
```

## Ciclo de vida de la conexión

```mermaid
stateDiagram-v2
    [*] --> SinSesion
    SinSesion --> Conectando: inicia sesión
    Conectando --> Abierta: upgrade aceptado
    Conectando --> Reconectando: 401, 403 o sin red
    Abierta --> EnVivo: llega subscribed
    EnVivo --> Abierta: SUBSCRIBE_FAILED, reintento a los 10 s
    Abierta --> Reconectando: el socket se cierra
    EnVivo --> Reconectando: red caída, API reiniciada o sin respuesta al ping del servidor
    Reconectando --> Conectando: espera de 1 s a 30 s, o vuelve la red o la pestaña
    EnVivo --> Inactiva: cierre 1000, se abrió una pestaña número 11
    Inactiva --> Conectando: vuelves a esa pestaña
    EnVivo --> SesionCerrada: cierre 4001, venció el token
    EnVivo --> SinSesion: cierras sesión
    SesionCerrada --> [*]
```

- **EnVivo** es `connected = true`: las pantallas de CI/CD consultan cada 60 s como red de seguridad; en los demás estados, cada 10–15 s (solo mientras algo corre y con la pestaña visible).
- **Reconectando** no se rinde nunca: espera 1 s, luego ×1,5 por intento hasta 30 s, más hasta 1 s al azar.

## Qué decide el hub con cada evento

```mermaid
flowchart TD
    E["Llega un evento del grupo G"] --> Q1{"¿El socket tiene G<br/>aceptado o pendiente?"}
    Q1 -->|"no"| X["No se envía"]
    Q1 -->|"sí"| Q2{"¿Comprobación de más de 5 min<br/>o G pendiente?"}
    Q2 -->|"no"| SEND["Se envía el evento"]
    Q2 -->|"sí"| CHK["Consulta UserGroups<br/>(una sola para toda la ráfaga)"]
    CHK -->|"es miembro"| OK["Guarda la hora<br/>si estaba pendiente, manda otro subscribed"]
    OK --> SEND
    CHK -->|"ya no es miembro"| OUT["Quita G del socket"] --> X
    CHK -->|"falla la BD"| PEND["G queda pendiente<br/>se salta este evento"]
    SEND --> NAV["Navegador: recargan las pantallas de G<br/>CicdNotifications decide si hay aviso"]
```

Los eventos de un mismo grupo llegan en orden: mientras uno espera su comprobación, los siguientes hacen fila detrás.

## Paso a paso

1. Al iniciar sesión, `RealtimeProvider` abre `/events` con el JWT en `?token=`.
2. Antes del upgrade, el servidor revisa el `Origin` y el token.
3. Si la lista de grupos está vacía (por ejemplo, tras recargar), el navegador la pide a la API.
4. El navegador manda `subscribe` con sus grupos: al conectar, al reconectar y cuando cambian.
5. El hub deja los grupos donde es miembro y responde `subscribed`.
6. GitHub manda un webhook; la API verifica la firma, registra la entrega y busca los grupos del repositorio.
7. La API publica el evento en cada grupo; `deploy_request` lo publica sin pasar por GitHub.
8. El hub re-verifica la membresía si hace falta y envía el evento a cada socket del grupo.
9. Las pantallas de ese grupo recargan, agrupando ráfagas (1 s la lista, 800 ms detalle y entornos).
10. `CicdNotifications` decide el aviso; el de una ejecución terminada espera 3 s por si antes llega el del deploy.
11. Si el socket se cae, se reconecta solo y, al confirmar la suscripción, las pantallas se recargan una vez.

## Qué ve el usuario si algo falla

| Situación | Código | Qué ve el usuario |
|---|---|---|
| `Origin` no permitido | HTTP 403 en el upgrade | Sin avisos en vivo; el navegador reintenta y las pantallas consultan cada 10–15 s |
| Sin token o token inválido | HTTP 401 en el upgrade | Igual que arriba. Si el token ya no sirve, la API REST también da 401 y TaskMate vuelve a «Sign In» |
| El token vence con el socket abierto | Cierre 4001 | TaskMate cierra la sesión y vuelve a «Sign In» |
| El navegador manda un mensaje de más de 64 KB | Cierre 1009 | El socket se reconecta solo. En `/events` no pasa en la práctica: el navegador solo manda `ping` y los ids de sus grupos |
| Más de 20 `subscribe` en un minuto | `RATE_LIMITED` con `retryAfterMs` | Nada: sigue la suscripción anterior y la nueva se reenvía entre 1,1 s y 60 s después |
| Falla inesperada al suscribir | `SUBSCRIBE_FAILED` | Nada visible: las pantallas pasan a consultar cada 10–15 s y se reintenta a los 10 s |
| La BD falla al comprobar la membresía | `subscribed` con `pending` | Se pierden los eventos de ese grupo hasta que la comprobación pasa; entonces las pantallas se recargan una vez |
| Se cae la red, se reinicia la API o el socket no responde al ping del servidor (cada 30 s) | Socket cerrado | Reconexión automática; al volver, las pantallas se recargan una vez |
| Se abre una pestaña número 11 | Cierre 1000 «Too many connections» | La pestaña más vieja deja de recibir avisos y consulta a GitHub; se reconecta al volver a ella |
| Te sacan de un grupo | — | Puedes recibir sus eventos hasta 5 min más; luego dejan de llegar |
| Webhook con firma inválida | HTTP 401 | Nadie recibe nada |
| Webhook de un repositorio sin grupo | Entrega `ignored` | Nadie recibe nada |

## Para saber más

- Arquitectura: [02-arquitectura/09-tiempo-real-y-avisos.md](../02-arquitectura/09-tiempo-real-y-avisos.md)
- Quién ve cada aviso: [04-casos-de-uso/09-tiempo-real-y-avisos.md](../04-casos-de-uso/09-tiempo-real-y-avisos.md)
- Cómo se ven: [05-interfaz/09-tiempo-real-y-avisos.md](../05-interfaz/09-tiempo-real-y-avisos.md)
- Webhooks, ejecuciones y deploys: [08-cicd.md](08-cicd.md)
- El chat por `/chat`: [05-chat-ia.md](05-chat-ia.md)
- Pruebas: `taskmate-api/tests/realtime.test.js`, `taskmate-api/tests/api/websocket.test.js`, `src/components/realtime/__tests__/Realtime.test.jsx`
- Limitaciones conocidas: [cierre del proyecto](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)
