# Usuarios y acceso: arquitectura

**En una frase:** el navegador crea la cuenta o inicia sesión en `/api/users`, recibe un JWT de 24 h y lo manda en cada llamada a la API y al abrir cada WebSocket.

![Arquitectura de usuarios y acceso](imagenes/01-usuarios-y-acceso.png)

Las flechas del dibujo no llevan texto. Esto es lo que viaja por cada una:

| De → a | Qué viaja |
|---|---|
| Login y Register → authLimiter | `POST /api/users` (registro) y `POST /api/users/login`, sin token |
| authLimiter → Rutas `/api/users` | La petición pasa si la IP lleva menos de 10 intentos en 15 min; si no, responde 429 |
| Rutas `/api/users` → SQL Server | Registro: crea usuario, grupo personal y membresía en una transacción. Login: lee el hash de la contraseña |
| App y cliente HTTP → localStorage y sessionStorage | Guarda y lee `user`, `token` y `userId`; marca la pestaña con `sessionStarted` |
| App y cliente HTTP → requireAuth | Cada llamada lleva `Authorization: Bearer <JWT>`. Justo después del login se pide la lista de grupos del usuario (`GET /api/groups/user-groups`) |
| requireAuth → Resto de la API | Solo deja pasar un JWT de acceso válido; si no, 401 |
| Resto de la API → SQL Server | Las consultas de cada módulo |
| useWebSocket → Servidor WebSocket | Upgrade a `/chat`, `/insights` o `/events` con `?token=JWT`; antes se revisa el `Origin` |

Términos:
- **JWT** (JSON Web Token): texto firmado por la API que dice quién eres y cuándo vence.
- **bcrypt**: función lenta que convierte la contraseña en un hash; la contraseña nunca se guarda tal cual.
- **Rate limit**: número máximo de peticiones en una ventana de tiempo.
- **Upgrade**: el paso de una petición HTTP a una conexión WebSocket.

## Piezas

| Pieza | Tecnología | Archivo |
|---|---|---|
| Pantalla de inicio de sesión | React 18 + MUI | `src/components/Login.jsx` |
| Pantalla de registro | React 18 + MUI | `src/components/Register.jsx` |
| Sesión del navegador y rutas protegidas | React Router 6, `localStorage`, `sessionStorage` | `src/App.js` |
| Dirección de la API y del WebSocket (`API_BASE`, `WS_BASE`): por defecto el host de la página en el puerto 9000 | JavaScript | `src/config.js` |
| Cliente HTTP (pone el Bearer, avisa los 401) | `fetch` | `src/api/client.js` |
| Cliente WebSocket (manda `?token=`, maneja el cierre 4001) | WebSocket del navegador | `src/hooks/useWebSocket.js` |
| Grupo activo (el login deja el primero), se limpia al salir | React Context | `src/components/GroupContext.jsx` |
| Menú de usuario con «Logout» y selector del grupo activo junto al logo | MUI | `src/components/Navbar.jsx`, `src/components/NavGroupSelector.jsx` |
| Rutas de usuarios: registro, login, `getuid` | Express 4 | `taskmate-api/controllers/user.controller.js` |
| Hash de contraseñas (costo 10) | bcryptjs | `taskmate-api/controllers/user.controller.js` |
| Límites `authLimiter` y `apiLimiter` | express-rate-limit 8 | `taskmate-api/middleware/rateLimit.js` |
| Firmar y verificar tokens | jsonwebtoken, HS256 | `taskmate-api/helpers/tokens.js` |
| Guardia de las rutas REST | Middleware de Express | `taskmate-api/middleware/auth.middleware.js` |
| Orígenes permitidos (CORS y WebSocket), con `ALLOW_LAN_ORIGINS` opcional | cors | `taskmate-api/middleware/cors.js` |
| Servidor WebSocket con token y `Origin` | ws 8 | `taskmate-api/services/WebSocketServer.js` |
| Acceso a la tabla `Users` | tedious, transacción | `taskmate-api/models/user.model.js` |
| Arranque: exige `JWT_SECRET` | Node.js | `taskmate-api/server.js` |
| Base de datos | SQL Server 2019 en Docker o Podman | tablas `Users`, `Groups`, `UserGroups` |

## Cómo se conectan

- **Dos rutas públicas.** Registro y login son las únicas de `/api/users` sin token. Comparten el contador `authLimiter`: 10 intentos por IP cada 15 min (`AUTH_RATE_LIMIT_MAX`).
- **El token.** El login firma un JWT HS256 con `userId`, `username`, `typ: access` y vencimiento de 24 h. La API no arranca si `JWT_SECRET` falta, mide menos de 32 caracteres o parece un valor de ejemplo.
- **Grupo activo al entrar.** Con el token guardado, `Login.jsx` pide los grupos del usuario y deja el primero como grupo activo (al registrarse, todos reciben su grupo personal). Ese grupo se ve y se cambia en el selector junto al logo ([Grupos y roles](02-grupos-y-roles.md)). Si la lista falla, entra igual sin grupo activo.
- **Rutas protegidas.** El resto de `/api/*` pasa por `requireAuth` y `apiLimiter` (300 peticiones por minuto por usuario, `API_RATE_LIMIT_MAX`). Solo quedan fuera el callback y el webhook de GitHub ([GitHub](07-github.md)) y el webhook de Vercel, `POST /api/deploy/webhook/vercel` ([CI/CD](08-cicd.md)), que se autentican de otra forma.
- **WebSockets.** Antes del upgrade el servidor revisa el `Origin` (403) y el token de `?token=` (401). Cuando el token vence, cierra el socket con el código 4001.
- **Orígenes.** Una sola función, `isAllowedOrigin`, decide CORS y el handshake de los WebSockets. Acepta los orígenes de `FRONTEND_URL` (por defecto `http://localhost:3000`; se relee en cada petición) y las peticiones sin `Origin`. Con `ALLOW_LAN_ORIGINS=true` (solo desarrollo, apagado por defecto) acepta además `http://` desde una IPv4 privada (10.x, 172.16–31.x, 192.168.x) con cualquier puerto; no https, IPv6 ni nombres de host.
- **Desde otro equipo de la red.** Sin `REACT_APP_API_URL` ni `REACT_APP_WS_URL`, el navegador usa `http://<host de la página>:9000` y `ws://<host de la página>:9000`. La API y el servidor de React escuchan en todas las interfaces, así que con `ALLOW_LAN_ORIGINS=true` la app se abre con la IP de la máquina. Sin esa variable (y si esa dirección no está en `FRONTEND_URL`), el navegador bloquea las respuestas por CORS y los WebSockets reciben 403.
- **Cierre de sesión forzado.** Un 401 de la API o un cierre 4001 disparan el evento `taskmate:unauthorized`. `App.js` lo escucha, borra la sesión y vuelve a `/`.

## Para saber más

- Tablas: [03-base-de-datos/01-usuarios-y-acceso.md](../03-base-de-datos/01-usuarios-y-acceso.md)
- Quién puede hacer qué: [04-casos-de-uso/01-usuarios-y-acceso.md](../04-casos-de-uso/01-usuarios-y-acceso.md)
- Pantallas: [05-interfaz/01-usuarios-y-acceso.md](../05-interfaz/01-usuarios-y-acceso.md)
- Paso a paso y errores: [06-flujos/01-usuarios-y-acceso.md](../06-flujos/01-usuarios-y-acceso.md)
- Arquitectura completa: [00-general.md](00-general.md)
- Todos los controles de seguridad (JWT, `Origin`, webhooks, secretos): [00-seguridad.md](00-seguridad.md)
- Limitaciones conocidas (por ejemplo, el JWT en la URL del WebSocket): [cierre de la línea de Pablo y estado](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas)
- Fuente del diagrama: [fuentes/01-usuarios-y-acceso.mmd](fuentes/01-usuarios-y-acceso.mmd)
