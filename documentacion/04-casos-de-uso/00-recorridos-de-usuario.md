# Recorridos de usuario

**En una frase:** cuatro recorridos típicos, paso a paso, de las personas que usan TaskMate: un usuario nuevo, un miembro, un admin y un líder.

**Cómo leer la puntuación (1 a 5).** No es una medición de satisfacción. Es una regla fija para ver dónde está la fricción:

| Puntos | Significa |
|---|---|
| 5 | Un clic o un formulario dentro de TaskMate |
| 4 | Varios pasos o decisiones dentro de TaskMate |
| 3 | Hay que salir a GitHub o a la terminal, o esperar a otro sistema |
| 2 | Algo falló y hay que corregirlo |

## 1. Usuario nuevo: del registro a su primera tarea

**Persona:** alguien que entra a TaskMate por primera vez y quiere anotar su primera tarea.

```mermaid
journey
    title Usuario nuevo, del registro a la primera tarea
    section Crear la cuenta
      Abrir TaskMate, ver el login: 5: Usuario
      Create Account y formulario: 4: Usuario
      Se crea cuenta y grupo personal: 5: TaskMate
    section Entrar
      Vuelve al login a los 2 s: 5: TaskMate
      Entrar con usuario y contraseña: 4: Usuario
      Llega a /home con su grupo: 5: TaskMate
    section Primera tarea
      Get Started o Tasks: 5: Usuario
      Add List, crear una lista: 4: Usuario
      Add Task con nombre y fecha: 4: Usuario
      Asignarse con Assign user: 4: Usuario
```

- El grupo personal se llama «*usuario*'s Group» y la persona queda como su admin.
- Al iniciar sesión, TaskMate activa el primer grupo de la lista. Con un solo grupo, es el personal.
- Con la sesión ya iniciada, `/register` lleva directo a `/home`.

## 2. Miembro: un día típico con tareas, rama, PR y CI

**Persona:** un desarrollador del equipo. Su grupo ya tiene repositorio y pipeline conectados.

```mermaid
journey
    title Miembro, un día de trabajo
    section Planear
      Iniciar sesión, abrir Tasks: 5: Miembro
      Elegir la tarea del día: 5: Miembro
    section Rama
      Crear la rama desde la tarea: 5: Miembro, TaskMate
      git checkout y programar: 3: Miembro
    section PR y CI
      Push, el CI corre solo: 3: Miembro, GitHub
      Abrir el PR en GitHub: 3: Miembro, GitHub
      Ver la ejecución y sus logs: 4: Miembro
      Si falla, re-ejecutar fallidos: 2: Miembro
    section Cerrar
      Fusionar en la rama principal: 3: Miembro, GitHub
      Tarea completa, rama borrada: 5: TaskMate
      Aviso de staging actualizado: 5: TaskMate
```

- La rama se llama `tm/<nombre-de-la-tarea>-<8 caracteres del id>` y sale de la rama principal.
- TaskMate no abre PRs: el PR se abre en GitHub. TaskMate lo muestra como un chip en la tarea.
- Solo un PR fusionado **en la rama principal** completa la tarea.
- La rama se borra salvo que tenga cambios sin fusionar u otro PR abierto.

## 3. Admin: conectar el repo, configurar el pipeline y publicar

**Persona:** el admin del grupo. Tiene permiso de escritura en el repositorio de GitHub.

```mermaid
journey
    title Admin, del repositorio a producción
    section Conectar el repositorio
      Conectar repositorio: 5: Admin
      Instalar la App en GitHub: 3: Admin, GitHub
      Vincular repositorio: 4: Admin
      Permitir análisis con IA: 5: Admin
    section Pipeline
      Configurar pipeline: 5: Admin
      Revisar propuesta y YAML: 4: Admin
      Subir al repositorio: 5: Admin, TaskMate
    section Publicar
      Primer deploy a staging: 3: GitHub
      Publicar o aprobar solicitud: 5: Admin
      Aviso de producción al día: 5: TaskMate
      Rollback si algo sale mal: 4: Admin
```

- «Subir al repositorio» hace un commit de `.github/workflows/taskmate-ci.yml` en la rama principal. Si hay deploy, también activa GitHub Pages.
- Staging se actualiza solo con cada push a la rama principal que pasa el CI.
- Solo se publican versiones que pasaron el CI de TaskMate en la rama principal.

## 4. Líder: revisar el equipo con analytics

**Persona:** un miembro con un rol cuyo nombre contiene «leader» (o el admin). Quiere repartir mejor el trabajo.

```mermaid
journey
    title Líder, revisar el equipo y asignar
    section Obtener el rol
      Crear un rol con leader: 4: Admin
      Asignarle el rol en Groups: 4: Admin
    section Revisar el equipo
      Abrir Analytics: 5: Líder
      Ver miembros, tareas y avance: 5: Líder
      Filtrar la carga por rol: 4: Líder
      Ver experiencia por categoría: 4: Líder
    section Asignar
      Describir tarea y categoría: 4: Líder
      Get Recommendations: 3: Líder, TaskMate
      Asignar en Tasks: 4: Líder
```

- Un miembro sin ese rol ve «Solo líderes del equipo».
- Las recomendaciones van por el WebSocket `/insights` (canal en vivo) al servidor de IA, que usa Groq.

## Para saber más
- [Casos de uso: visión general](00-general.md) y [permisos por rol](00-permisos-por-rol.md).
- Pantallas: [interfaz](../05-interfaz/00-general.md).
- El mismo camino de punta a punta: [flujo general](../06-flujos/00-general.md).
- Uso detallado del CI/CD: [guía de CI/CD](../07-guias/guia-cicd.md).
- Limitaciones conocidas: [cierre del proyecto](../01-proyecto/cierre-del-proyecto.md#limitaciones-conocidas).
