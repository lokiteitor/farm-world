# Technical Design Document — Tecnologías

**Proyecto:** Farming Management Simulator Online
**Versión:** 0.1
**Estado:** Propuesta de stack, pendiente de validación en desarrollo
**Contexto de decisión:** Equipo de 1-3 personas, infraestructura propia (Proxmox), despliegue vía Docker/Docker Compose, backend en Node.js/TypeScript, base de datos híbrida (relacional + no relacional).

**Relación con el GDD:** Este documento traduce a decisiones técnicas concretas los principios ya establecidos en el GDD, especialmente §54 (Servidor autoritativo), §53 (Simulación basada en eventos), §58 (Persistencia procedural) y §72 (Principios técnicos derivados).

---

# 1. Resumen ejecutivo de decisiones

| Área | Decisión | Motivo principal |
|---|---|---|
| Backend | Node.js + TypeScript, framework **Fastify** | Tipado compartible con frontend, buen rendimiento, bajo overhead para equipo pequeño |
| Arquitectura de servicio | **Monolito modular** (no microservicios) | 1-3 personas no pueden operar la complejidad operativa de microservicios |
| Base de datos principal | **PostgreSQL** | Fuente de verdad relacional: jugadores, tierras, campos, máquinas, trabajadores, transacciones |
| Base de datos secundaria | **Redis** | Cache, colas de eventos/simulación, pub/sub, sesiones |
| ORM | **Prisma** | Tipado end-to-end, migraciones manejables por una sola persona |
| Cola de eventos/simulación | **BullMQ** (sobre Redis) | Encaja directamente con el modelo de "simulación basada en eventos" del GDD (§53) |
| Comunicación cliente-servidor | REST (Fastify) + **WebSockets** (para estado en vivo mientras el jugador está conectado) | El juego es mayormente asíncrono, pero necesita push de eventos completados sin polling agresivo |
| Autenticación | JWT + refresh token, cookies httpOnly | Simple de operar sin infraestructura de identidad externa |
| Contenerización | **Docker Compose** sobre Proxmox (LXC/VM con Docker) | Ya decidido por el usuario; evita la complejidad de K8s para un equipo tan pequeño |
| Reverse proxy / TLS | **Caddy** | Config minimalista (Caddyfile), certificados TLS automáticos sin configuración adicional |
| Gestión de comandos | **Makefile** en la raíz del repo | Unifica build, levantar/bajar servicios, migraciones, tests, logs, etc. en comandos cortos y memorizables |
| CI/CD | GitHub Actions (o Gitea Actions si el repo es self-hosted) → build de imágenes → deploy por SSH/Watchtower | Pipeline mínimo viable para un equipo pequeño |
| Observabilidad | **Pino** (logs) + **Prometheus** (métricas) + **Grafana** (visualización) | Stack de observabilidad fijo desde el inicio, sin capas adicionales (sin Loki) |
| Gestión de dependencias | **npm sin workspaces** — `frontend/` y `backend/` cada uno con su propio `package.json` | Repos independientes en cuanto a dependencias; más simple de razonar para un equipo pequeño que un monorepo con workspaces |
| Frontend | Phaser.js + TypeScript + Vite | Ya definido en el GDD (§56) |

---

# 2. Backend

## 2.1 Runtime y lenguaje

**Node.js (LTS) + TypeScript.**

Justificación:
* Comparte lenguaje con el frontend (Phaser.js también en TS), lo que permite compartir tipos entre cliente y servidor (definiciones de `Machine`, `Worker`, `Field`, `Task`, etc.) mediante un paquete compartido (`packages/shared-types`).
* Para un equipo de 1-3 personas, reducir el número de lenguajes distintos en el stack reduce carga cognitiva y facilita mantenimiento.

## 2.2 Framework HTTP

**Fastify**, en lugar de Express o NestJS.

```text
Express   → maduro, pero rendimiento menor y sin tipado nativo fuerte
NestJS    → muy estructurado, pero añade complejidad (DI, decorators, módulos)
           excesiva para un equipo de 1-3 personas en las fases tempranas
Fastify   → rendimiento alto, schema-based validation nativa (JSON Schema/TypeBox),
           soporte TypeScript de primera clase, curva de aprendizaje moderada
```

**Recomendación:** Fastify + `@fastify/websocket` + `fastify-type-provider-typebox` para validación de payloads con tipado compartido.

## 2.3 Arquitectura del servicio: monolito modular

Dado el tamaño del equipo, se descarta una arquitectura de microservicios desde el día 1. En su lugar:

```text
backend/
├── src/
│   ├── modules/
│   │   ├── world/         (chunks, generación procedural, seed)
│   │   ├── land/          (ownership, compra de tierra)
│   │   ├── fields/         (campos agrícolas, cropCycleState)
│   │   ├── forestry/       (ForestPlot, Tree)
│   │   ├── machinery/      (Machine, tareas, desgaste)
│   │   ├── workers/        (Worker, pool de contratación)
│   │   ├── farms/          (Farm, edificios, footprint)
│   │   ├── economy/        (transacciones, mercado, resumen de regreso)
│   │   ├── simulation/     (motor de eventos, ver sección 4)
│   │   └── auth/           (autenticación, sesiones)
│   ├── shared/              (tipos, utilidades comunes)
│   └── server.ts
```

Cada módulo expone su propia API interna (funciones/servicios) y sus propias rutas HTTP/WS, pero todos corren en el mismo proceso Node.js. Esto **no impide** una futura extracción a servicios separados (ej. `simulation` como worker independiente) si el proyecto crece — de hecho, el diseño de colas con BullMQ (sección 4) ya deja esa puerta abierta sin rediseño.

## 2.4 Validación de mensajes

Fastify + TypeBox (o Zod, alternativa igualmente válida) para validar todos los payloads entrantes del cliente, coherente con el principio de servidor autoritativo (GDD §54): **el cliente nunca es fuente de verdad**, así que cada acción (`BUY_LAND`, `ASSIGN_TASK`, `HIRE_WORKER`...) se valida estructuralmente antes de tocar la lógica de negocio.

---

# 3. Bases de datos

## 3.1 PostgreSQL — fuente de verdad relacional

Todo lo que requiere consistencia fuerte, relaciones e integridad referencial vive en PostgreSQL:

```text
players
lands / cells (modificaciones persistidas, GDD §58)
fields
forest_plots / trees
farms / buildings
machines
workers
tasks (históricas y activas)
transactions (ledger económico)
```

Ventajas para este proyecto en concreto:
* Las relaciones entre `Field ↔ Cells ↔ Chunks` (GDD §16-18) y `Worker ↔ Home ↔ Farm` (GDD §108) son inherentemente relacionales — forzarlas a un modelo documental añadiría complejidad, no la quitaría.
* Soporta bien el patrón de "persistir solo modificaciones" (GDD §58): una tabla `cell_modifications` indexada por `(chunkX, chunkY, cellIndex)` es un caso de uso natural para SQL.
* Transacciones ACID son importantes para el ledger económico (comprar máquina, pagar salario, vender cosecha no deberían dejar el estado inconsistente si algo falla a mitad de operación).

## 3.2 Redis — la pieza "NoSQL" del stack híbrido

Redis no se usa aquí como base de datos documental de propósito general, sino con tres roles concretos:

```text
1. Cache          → resultados de generación procedural de chunks (evitar recalcular
                     terreno con la misma seed+coordenadas en cada request)
2. Cola de eventos → BullMQ para el motor de simulación (sección 4)
3. Pub/Sub         → notificar a los WebSockets conectados cuando una tarea completa,
                     sin que el backend tenga que hacer polling a la base de datos
```

**Nota sobre la elección:** el usuario indicó preferencia por una combinación SQL+NoSQL. En este proyecto, dado que no hay datos verdaderamente "sin esquema" (todo el dominio del GDD está bien estructurado: `Machine`, `Worker`, `Field`, `Tree`... todos tienen forma fija), **no se recomienda MongoDB** como base de datos documental adicional — añadiría una segunda fuente de verdad sin necesidad real y complicaría la consistencia con PostgreSQL. Redis cubre el rol "NoSQL" de forma más justificada: como cache/cola, no como almacén persistente de datos de dominio.

Si en el futuro aparece un caso de uso genuinamente documental (ej. logs de eventos de juego no estructurados, analítica de comportamiento), se puede reevaluar Mongo en ese momento — pero no forma parte del MVP.

## 3.3 ORM: Prisma

```text
Prisma
├── Schema declarativo (schema.prisma) → única fuente de verdad del modelo de datos
├── Migraciones automáticas versionadas
├── Cliente TypeScript autogenerado y type-safe
└── Buen soporte para el patrón "un solo dev manteniendo el esquema"
```

Alternativa considerada: **Drizzle ORM** (más ligero, SQL-first, mejor rendimiento en queries complejas). Para un equipo de 1-3 personas priorizando velocidad de desarrollo sobre control fino de queries, **Prisma es la recomendación por defecto**; Drizzle queda como opción a revisar si el rendimiento de queries se vuelve un cuello de botella real (no antes).

---

# 4. Motor de simulación basado en eventos

Esta es la pieza más importante del backend y la que traduce directamente el §53 del GDD a tecnología concreta.

## 4.1 Por qué BullMQ

```text
BullMQ (sobre Redis)
├── Colas de trabajos con delay programado (ideal para "completar tarea en X horas de juego")
├── Persistencia de jobs pendientes ante reinicios del servidor
├── Reintentos automáticos si un job falla
├── Escalable horizontalmente si en el futuro se separan workers de simulación
└── Ecosistema maduro en Node.js/TypeScript
```

## 4.2 Flujo conceptual

```text
Jugador ejecuta AssignTask(PLOW, field=12)
   ↓
Backend calcula taskDuration (GDD §91)
   ↓
BullMQ.add('completeTask', { taskId }, { delay: taskDuration_en_ms_de_servidor })
   ↓
Jugador se desconecta — el job sigue vivo en Redis, no depende del proceso del cliente
   ↓
Cuando el delay expira (esté el jugador conectado o no):
   Worker de BullMQ procesa el job → actualiza PostgreSQL (Field.cropCycleState, etc.)
   → publica evento en Redis Pub/Sub
   → si el jugador está conectado, el WebSocket empuja la actualización en vivo
```

## 4.3 Multiplicador de tiempo de juego

El `delay` real en milisegundos de servidor se calcula a partir de `taskDuration` (en horas de juego) dividido por el multiplicador de tiempo (GDD §51):

```text
realDelayMs = (taskDuration_gameHours / gameHoursPerRealHour) × 3_600_000
```

Este multiplicador vive como configuración de servidor (no hardcodeado), permitiendo ajustarlo en balance sin tocar código.

## 4.4 Simulación offline (GDD §52)

No es necesario un job separado para "simular mientras el jugador está fuera": como los jobs de BullMQ ya están agendados con su `completionTime` real desde el momento en que se crean, el sistema **ya simula offline por construcción** — no hace falta un proceso batch adicional que recorra jugadores inactivos. Al reconectar, el backend simplemente consulta qué tareas se completaron desde `lastLogin` (ya reflejado en PostgreSQL por los workers de BullMQ) y construye el "resumen de regreso" (GDD §124) a partir de esos datos.

---

# 5. Comunicación cliente-servidor

## 5.1 REST para acciones

Todas las acciones del jugador (`BUY_LAND`, `CREATE_FIELD`, `ASSIGN_TASK`, `HIRE_WORKER`, `SELL_CROP`...) se modelan como endpoints REST convencionales sobre Fastify, siguiendo el patrón request/validate/mutate/response ya descrito en GDD §54.

```text
POST /api/fields/:fieldId/tasks
POST /api/machines/buy
POST /api/workers/hire
POST /api/land/purchase
```

## 5.2 WebSockets para estado en vivo

Mientras el juego es mayormente asíncrono (el jugador puede cerrar el navegador sin perder progreso), **sí conviene un canal en vivo** para mientras está conectado: ver una tarea completarse, un trabajador quedar `IDLE`, el resumen de regreso al hacer login. Se usa WebSocket nativo vía `@fastify/websocket`, con canales por jugador (no globales), alimentados por el Pub/Sub de Redis de la sección 4.2.

**Se descarta** una arquitectura de sincronización en tiempo real tipo "juego multiplayer competitivo" (rooms, tick rate alto, interpolación de estado) — no es necesaria para un idle/management game server-authoritative con baja frecuencia de eventos por jugador.

## 5.3 Tipos compartidos

Al usar `frontend/` y `backend/` como proyectos npm independientes (sin workspaces, sección 11), no existe un paquete común instalable automáticamente entre ambos. Opciones evaluadas:

```text
Opción A — Carpeta shared/ versionada en el repo, sin publicar como paquete npm
           El backend y el frontend importan los tipos vía path relativo o
           un pequeño script de build que copia shared/ a cada proyecto
           antes de compilar.

Opción B — Publicar shared-types como paquete privado en un registry
           (GitHub Packages / Verdaccio propio). Instalable con `npm install`
           normal en ambos proyectos.
```

**Recomendación para 1-3 personas:** Opción A. Una carpeta `shared/` en la raíz del repo con las interfaces (`Field`, `Machine`, `Worker`, `Task`, `Crop`, `Tree`...), sincronizada a `backend/src/shared` y `frontend/src/shared` mediante un target del **Makefile** (`make sync-types`) que copia los archivos antes de cada build. Es más simple de operar que mantener un registry propio, aunque implica que la sincronización no es automática — hay que recordar ejecutar el target tras editar `shared/`. Si esto se vuelve una fuente frecuente de errores, la Opción B (registry propio, ej. Verdaccio en un contenedor más del Docker Compose) es la evolución natural sin cambiar de lenguaje ni herramienta.

---

# 6. Autenticación

Para un equipo de 1-3 personas sin necesidad inmediata de SSO corporativo:

```text
JWT (access token, corta duración, ~15 min)
+
Refresh token (httpOnly cookie, larga duración, rotación en cada uso)
```

* Passwords con `argon2` (preferido sobre bcrypt por resistencia a GPU-cracking).
* No se recomienda un proveedor de identidad externo (Auth0, Clerk, etc.) en el MVP — añade coste recurrente y dependencia externa que no aporta valor a un juego pequeño en fase temprana. Revisar si el proyecto escala a un volumen de usuarios donde gestionar auth propia se vuelve una carga real.

---

# 7. Infraestructura sobre Proxmox

## 7.1 Topología recomendada

```text
Proxmox Host
│
└── VM/LXC "game-host" (Docker instalado)
    │
    └── docker-compose.yml
        ├── caddy             (reverse proxy + TLS automático, Caddyfile declarativo)
        ├── backend           (Node/TS, Fastify, réplica única en MVP)
        ├── worker-simulation (mismo código que backend, proceso BullMQ worker separado)
        ├── postgres          (con volumen persistente)
        ├── redis             (con volumen persistente para BullMQ)
        ├── prometheus        (scrape de métricas de backend/worker)
        ├── grafana           (dashboards sobre Prometheus)
        └── frontend           (build estático de Phaser.js servido directamente por Caddy)
```

**Por qué Caddy sobre Traefik:** para un único host Proxmox con un puñado de servicios, el `Caddyfile` de Caddy es notablemente más simple que la configuración de labels/routers/middlewares de Traefik, y obtiene certificados TLS automáticos (Let's Encrypt) sin pasos adicionales. Traefik brilla más en entornos con muchos servicios dinámicos o múltiples orquestadores — no es el caso aquí.

```caddyfile
# Caddyfile — ejemplo ilustrativo
game.midominio.com {
    reverse_proxy /api/* backend:3000
    reverse_proxy /ws/* backend:3000
    root * /srv/frontend
    file_server
}

grafana.midominio.com {
    reverse_proxy grafana:3000
}
```

**Justificación de separar `backend` y `worker-simulation` como dos contenedores desde el mismo código:** aunque hoy corren en el mismo repositorio (monolito modular, sección 2.3), separarlos como procesos Docker distintos desde el principio permite escalar la simulación independientemente del tráfico HTTP sin refactor futuro — es una separación barata de hacer ahora y cara de añadir después.

## 7.2 Por qué no Kubernetes

Con 1-3 desarrolladores y un único servidor Proxmox propio, K3s/K8s añade una capa operativa (manifiestos, ingress controllers, gestión de secretos, actualizaciones del propio cluster) que no se justifica para el volumen de tráfico esperado en fases tempranas. Docker Compose es suficiente para orquestar un puñado de contenedores en un solo host, y es mucho más simple de depurar para un equipo pequeño.

**Revisar en el futuro si:** el juego necesita escalar horizontalmente a múltiples hosts físicos, o el equipo crece lo suficiente como para justificar la complejidad operativa adicional.

## 7.3 Backups

```text
PostgreSQL → pg_dump programado (cron dentro del propio host o vía Proxmox Backup Server)
Redis      → snapshot RDB periódico (los datos de Redis en este stack son
             mayormente recuperables/regenerables, menor criticidad que Postgres)
```

Dado que Proxmox ya ofrece snapshotting a nivel de VM/LXC, esto puede complementarse con snapshots completos de la VM como red de seguridad adicional, sin sustituir los backups a nivel de aplicación.

## 7.4 Makefile — gestión unificada

Para un equipo de 1-3 personas, memorizar (o buscar) los comandos exactos de `docker compose`, `prisma migrate`, `npm run` en cada subproyecto, backups, etc. añade fricción innecesaria. Un `Makefile` en la raíz del repo centraliza todo en comandos cortos:

```makefile
# Makefile — ejemplo ilustrativo

.PHONY: up down build logs migrate seed sync-types test lint backup

up:            ## Levanta todo el stack en local/dev
	docker compose -f docker-compose.yml up -d

down:           ## Detiene el stack
	docker compose down

build:          ## Reconstruye las imágenes (backend, worker, frontend)
	docker compose build

logs:           ## Sigue los logs de backend + worker
	docker compose logs -f backend worker-simulation

migrate:        ## Aplica migraciones de Prisma
	cd backend && npx prisma migrate deploy

seed:           ## Pobla datos iniciales (cultivos, maquinaria, etc.)
	cd backend && npm run seed

sync-types:     ## Sincroniza shared/ hacia backend y frontend (sección 5.3)
	./scripts/sync-shared-types.sh

test:           ## Ejecuta tests de backend y frontend
	cd backend && npm test
	cd frontend && npm test

lint:           ## Lint + typecheck de ambos proyectos
	cd backend && npm run lint && npm run typecheck
	cd frontend && npm run lint && npm run typecheck

deploy:         ## Pull de imágenes nuevas y reinicio en producción
	docker compose -f docker-compose.prod.yml pull
	docker compose -f docker-compose.prod.yml up -d

backup:         ## Dump manual de PostgreSQL
	docker compose exec postgres pg_dump -U postgres game > backups/$$(date +%F).sql
```

**Justificación:** con `frontend/` y `backend/` como proyectos npm independientes (sección 11), el Makefile es además el único punto donde ambos se coordinan como un solo flujo de trabajo (`make test`, `make lint`, `make sync-types`) sin necesitar workspaces ni un orquestador de tareas adicional (Turborepo, Nx, etc.), que sería sobre-ingeniería para este tamaño de equipo.

---

# 8. CI/CD

Pipeline mínimo adecuado a un equipo de 1-3 personas, sin sobre-ingeniería:

```text
git push a main
   ↓
GitHub Actions (o Gitea Actions si se self-hostea el control de versiones)
   ├── make lint      (lint + typecheck de backend y frontend)
   ├── make test       (sección 9)
   ├── build de imágenes Docker (backend, worker, frontend)
   └── push a un registry (GitHub Container Registry o registry propio)
   ↓
Despliegue en Proxmox:
   Opción simple: Watchtower detecta nuevas imágenes y actualiza contenedores
   Opción manual: `make deploy` (SSH + pull + up -d, sección 7.4)
```

**Recomendación:** empezar con `make deploy` vía SSH manual (predecible, fácil de depurar por una sola persona) y migrar a Watchtower solo si el ritmo de despliegues lo justifica. En ambos casos, el pipeline de CI y el Makefile ejecutan exactamente los mismos comandos que un desarrollador correría en local, evitando divergencia entre "lo que pasa en CI" y "lo que pasa en mi máquina".

---

# 9. Testing

```text
Backend
├── Unit tests → Vitest (rápido, buena integración con TS/ESM)
│   Prioridad: fórmulas puras del GDD (taskDuration, yield, breakeven — GDD §91, §83, §121)
│   ya que son las más fáciles de romper silenciosamente al ajustar balance
├── Integration tests → Vitest + contenedor Postgres/Redis efímero (testcontainers)
│   Prioridad: flujos de AssignTask con validación server-side (GDD §104)
└── (Opcional, Fase 2) E2E → Playwright, sobre el flujo completo cliente-servidor

Frontend
└── Vitest para lógica no visual; testing manual/exploratorio para Phaser.js
    (el ecosistema de testing automatizado de Phaser es limitado; no es
    prioridad para un equipo pequeño en MVP)
```

---

# 10. Observabilidad

Para el MVP, mantenerlo deliberadamente ligero:

```text
✔ Logs estructurados con Pino (JSON logs), agregados vía `docker logs` o
  redirigidos a un archivo rotado
✔ Healthcheck endpoints (/health) en backend y worker para que Docker/Traefik
  puedan reiniciar contenedores caídos automáticamente

Fase 2 (si el proyecto crece):
├── Prometheus + Grafana para métricas (jobs de BullMQ procesados/fallidos,
│   latencia de endpoints, conexiones WebSocket activas)
└── Loki para agregación de logs centralizada
```

No se recomienda montar el stack de observabilidad completo (Prometheus/Grafana/Loki) desde el día 1: para un equipo de 1-3 personas en fase de MVP, el coste de mantenimiento de esa infraestructura compite directamente con tiempo de desarrollo del juego.

---

# 11. Estructura de repositorio

**Monorepo**, gestionado con `pnpm` workspaces (más rápido y eficiente en disco que npm/yarn para monorepos):

```text
/
├── apps/
│   ├── backend/         (Fastify, módulos de dominio, sección 2.3)
│   ├── worker/           (proceso BullMQ separado, comparte código con backend)
│   └── frontend/         (Phaser.js + Vite)
├── packages/
│   └── shared-types/     (interfaces TS compartidas, sección 5.3)
├── docker-compose.yml
├── docker-compose.prod.yml
└── prisma/
    └── schema.prisma
```

Para un equipo de 1-3 personas, un monorepo evita la sobrecarga de coordinar versiones entre múltiples repositorios y facilita compartir tipos entre frontend y backend sin publicar paquetes npm privados.

---

# 12. Mapeo tecnología ↔ fases del roadmap del GDD

| Fase del GDD (§71) | Piezas técnicas que entran en juego |
|---|---|
| Fase 0 — Foundation | Fastify base, PostgreSQL + Prisma schema inicial, Docker Compose, auth JWT |
| Fase 1 — World | Algoritmo de generación procedural + cache en Redis (sección 3.2) |
| Fase 2 — Land | Tablas `lands`/`cell_modifications`, endpoints REST de compra |
| Fase 3 — Farming | Módulo `fields`, primeras colas BullMQ (PLOW/SEED/GROWTH/HARVEST) |
| Fase 4 — Machinery | Módulo `machinery` + `workers`, validación de `AssignTask` |
| Fase 5 — Farm | Módulo `farms`, footprint y edificios |
| Fase 6 — Economy | Módulo `economy`, ledger transaccional en Postgres |
| Fase 7 — Idle | WebSockets + Pub/Sub, "resumen de regreso" |
| Fase 8 — Forestry | Extensión de `simulation` y `machinery` para `ForestPlot`/`Tree` |
| Fase 9 — Expansion | Posible extracción de `worker-simulation` a servicio escalado independientemente si el volumen lo requiere |

---

# 13. Riesgos técnicos a vigilar

```text
1. Generación procedural de chunks bajo carga
   → mitigar con cache Redis agresiva (misma seed+coords no debería recalcularse)

2. Crecimiento del volumen de jobs en BullMQ con muchos jugadores activos
   → monitorizar cola; el worker es horizontalmente escalable si hace falta

3. Un solo servidor Proxmox físico = punto único de fallo
   → aceptable para MVP/fase temprana; revisar redundancia si el proyecto
     pasa de prototipo a producto con usuarios reales

4. Prisma con esquemas muy grandes (Field, Machine, Worker, Tree, Task...)
   puede volverse lento de migrar si el equipo crece
   → mientras el equipo sea 1-3 personas, no es un problema real
```

---

# 14. Qué NO se incluye en el MVP técnico

```text
✘ Kubernetes / orquestación multi-nodo
✘ Microservicios separados por dominio
✘ Base de datos documental adicional (MongoDB) sin caso de uso claro
✘ Proveedor de identidad externo (Auth0/Clerk)
✘ Stack de observabilidad completo (Prometheus/Grafana/Loki)
✘ CDN dedicado (el frontend estático puede servirse directamente vía Traefik/Nginx en MVP)
✘ Multi-región / alta disponibilidad
```

Todas estas piezas quedan como extensiones naturales del stack elegido si el proyecto crece más allá de lo que un equipo de 1-3 personas puede operar cómodamente — ninguna decisión tomada aquí las bloquea.

---
