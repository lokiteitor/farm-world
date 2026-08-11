# Propiedad de directorios y reglas de trabajo en paralelo

Estado: vigente desde el cierre del flujo de trabajo W2. La tabla se ha cuadrado con el arbol real del
repositorio mediante `git status --porcelain` y `find`, y el apartado 4 recoge todas las diferencias
frente al arbol previsto en la seccion 4 del plan.

Este documento es la tabla autoritativa de propiedad del repositorio. Cada ruta del arbol real aparece
exactamente una vez, con el agente que la escribe y la fase en la que lo hace. Su proposito es permitir
que varios agentes trabajen a la vez sin que ninguno pise el trabajo de otro.

Convenciones de lectura:

- Propietario indica quien escribe. Todo lo demas es de solo lectura para el resto de agentes.
- Congelado indica que el fichero queda cerrado al terminar la fase indicada. A partir de ese
  momento solo el agente de integracion de W7 tiene mandato para modificarlo, y solo aplicando las
  notas de `docs/handoff/`.
- Los identificadores de agente siguen el formato `W<fase>-<letra>`. Cuando una fase tiene un unico
  agente se escribe solo la fase.
- Generado indica una ruta que produce una herramienta y que nadie edita a mano. Cada una declara la
  orden que la produce.

---

## 1. Cinco reglas de la ejecucion en paralelo

Estas son las reglas de la seccion 11 del plan aprobado. Su incumplimiento no produce un conflicto
de fusion sino trabajo perdido, porque los agentes no se coordinan entre si durante la fase.

1. Un directorio, un dueno, una fase. Cada ruta del repositorio aparece exactamente una vez en la
   tabla de propiedad. Un agente escribe solo dentro de la suya; el resto del arbol es de lectura.

2. Los ficheros compartidos por naturaleza se escriben completos en los dos primeros flujos de
   trabajo, para el conjunto final de funcionalidades, y quedan congelados: `Makefile`, los tres
   ficheros de Compose, los `Caddyfile`, todos los `package.json` y los `package-lock.json`, los
   `tsconfig`, `eslint.config.js`, `schema.prisma`, `app.ts` y el registro de paneles.

3. Registro con stubs, nunca registro por anadido. Quien escribe un registro crea tambien los
   modulos que importa, con su ruta y su firma definitivas; el agente posterior sustituye el stub en
   su sitio. Asi el indice de rutas y el de paneles no se vuelven a tocar, que es el conflicto
   clasico de este tipo de reparto.

4. Ninguna importacion entre modulos hermanos de la misma fase. Se comprueba con reglas de zona de
   `eslint.config.js` (`import/no-restricted-paths`), de modo que la violacion falla en `make lint` y
   no en la integracion. Las zonas declaradas cubren ya los once modulos previstos, incluidos los que
   todavia no existen.

5. Ningun agente ejecuta ordenes que muten el repositorio: nada de `npm install`, `prisma generate`,
   `prisma migrate`, `git`, compilaciones de produccion ni `docker compose up`. Solo
   `tsc --noEmit` y `vitest run` sobre su propio directorio. Lo que necesiten fuera de eso lo
   escriben en su propio fichero de `docs/handoff/NOTES-<agente>.md`, que por ser uno por agente no
   puede colisionar.

---

## 2. Reparto por flujo de trabajo

| Flujo | Contenido | Agentes |
|---|---|---|
| W1 Cimientos | Raiz completa, tooling, Compose, CI, documentos de proceso y andamiajes de los tres proyectos | 1 |
| W2 Contrato y modelo | `shared/` completo con sus pruebas, y `schema.prisma` con migracion inicial y seed | 5 |
| W3 Esqueletos y primitivas | Esqueleto de Fastify y del worker, `lib/`, autenticacion, stubs de modulos, modulo de mundo, esqueleto de Nuxt y fabrica de texturas | 4 |
| W4 Dominio 1 y render del mundo | Tierra, granjas y edificios, campos, escena del mundo, primer grupo de paneles | 5 |
| W5 Dominio 2 e interaccion | Maquinaria, trabajadores, economia, entidades y rotulos, herramienta de seleccion, segundo grupo de paneles | 6 |
| W6 Tareas, sesion y silvicultura | Motor de tareas, sesion e instantanea, silvicultura, calculadora de balance, tercer grupo de paneles | 5 |
| W7 Integracion y revision | Aplicacion de los handoff, instalacion, migracion, `make verify`, `make smoke`, informe de balance y revision adversarial | 5 |

El plan preveia un unico agente en W2, "porque es el artefacto que leen todos los demas y la coherencia
importa mas que la velocidad". La fase se ejecuto con cinco, repartidos por ambito disjunto dentro de
`shared/` y de `backend/prisma/`, mas un agente de cierre documental que es el unico escritor de
`docs/adr.md` en la fase:

| Agente | Ambito escrito | Fichero de traspaso |
|---|---|---|
| W2-A | `shared/domain/`, `shared/config/`, `shared/index.ts` | `docs/handoff/NOTES-W2a.md` |
| W2-B | `shared/rules/`, `shared/world/` | `docs/handoff/NOTES-W2b.md` |
| W2-C | `shared/api/`, `shared/ws/` | `docs/handoff/NOTES-W2c.md` |
| W2-D | `backend/prisma/`, `backend/prisma.config.ts` | `docs/handoff/NOTES-w2d.md` |
| W2-E | `docs/adr.md`, `docs/erratas-gdd-stack.md`, `docs/ownership.md`, `README.md` | `docs/handoff/NOTES-w2-cierre.md` |

La coherencia que el plan buscaba se conservo por dos medidas: los ambitos no se solapan, y el
vocabulario compartido (`shared/domain/` y `shared/config/`) lo escribio un solo agente del que los otros
tres dependen en un unico sentido. El coste real de la division aparece en `shared/index.ts`, que es el
unico fichero que los cuatro tenian que tocar y que ninguno toco: sus cuatro reexportaciones siguen
comentadas y las aplica W7-A.

---

## 3. Tabla de propiedad

### 3.1 Raiz del repositorio

| Ruta | Propietario | Fase | Congelado tras |
|---|---|---|---|
| `Makefile` | W1 | W1 | W1 |
| `docker-compose.yml` | W1 | W1 | W1 |
| `docker-compose.prod.yml` | W1 | W1 | W1 |
| `docker-compose.obs.yml` | W1 | W1 | W1 |
| `.env.example` | W1 | W1 | W1 |
| `package.json`, `package-lock.json` (raiz, solo tooling) | W1 | W1 | W1 |
| `tsconfig.base.json` | W1 | W1 | W1 |
| `eslint.config.js` | W1 | W1 | W1 |
| `.prettierrc`, `.prettierignore` | W1 | W1 | W1 |
| `.editorconfig`, `.nvmrc`, `.dockerignore` | W1 | W1 | W1 |
| `.gitignore` | W1 | W1 | W1 |
| `README.md` | W2-E redacta, W7-A actualiza el estado | W2-W7 | — |
| `LICENSE` | — | — | preexistente |

### 3.2 Infraestructura y automatizacion

| Ruta | Propietario | Fase | Congelado tras |
|---|---|---|---|
| `infra/caddy/Caddyfile` | W1 | W1 | W1 |
| `infra/caddy/Caddyfile.prod` | W1 | W1 | W1 |
| `infra/prometheus/prometheus.yml` | W1 | W1 | W1 |
| `infra/postgres/init.sql` | W1 | W1 | W1 |
| `.github/workflows/ci.yml` | W1 | W1 | W1 |
| `scripts/sync-shared-types.sh` | W1 | W1 | W1 |
| `scripts/check-shared-sync.sh` | W1 | W1 | W1 |
| `scripts/adr-append.mjs` | W1 | W1 | W1 |
| `scripts/smoke/smoke.ts` | W7-A | W7 | — |

### 3.3 Documentacion

| Ruta | Propietario | Fase | Congelado tras |
|---|---|---|---|
| `docs/GDD_Farming_Management_Simulator_Online_v0.4.md` | — | — | intocable |
| `docs/stack.md` | — | — | intocable |
| `docs/ownership.md` | W1 crea, W2-E cuadra con el arbol real | W1-W2 | — |
| `docs/erratas-gdd-stack.md` | W1 crea, W2-E anade lo detectado al implementar | W1-W2 | — |
| `docs/adr.md` | un agente designado por fase, siempre via `scripts/adr-append.mjs` | W1-W7 | — |
| `docs/handoff/README.md` | W1 | W1 | W1 |
| `docs/handoff/NOTES-<agente>.md` | el agente homonimo | la suya | — |
| `docs/balance/` | W6-E genera, W7-D cierra | W6-W7 | — |

Reparto de la escritura de `docs/adr.md`: W1 escribe 0001-0005; W2-E, 0006-0014; W3-A, 0015-0020;
W4-A, 0021-0024; W5-A, 0025-0028; W6-A, 0029-0032; W7-D, 0033-0034. Ningun otro agente escribe en
ese fichero, y quien lo hace usa siempre el script, que rechaza numeros repetidos o no consecutivos.

Los agentes que producen decisiones no las escriben: las anotan en el apartado correspondiente de su
propio `docs/handoff/NOTES-<agente>.md` y el agente de cierre de la fase las redacta. Es lo que garantiza
un unico escritor por fase sobre `docs/adr.md`.

Los ficheros de `docs/handoff/` existentes al cierre de W2 son `NOTES-W1.md`, `NOTES-W2a.md`,
`NOTES-W2b.md`, `NOTES-W2c.md`, `NOTES-w2d.md` y `NOTES-w2-cierre.md`. La caja de los sufijos no es
uniforme, porque cada agente nombro el suyo; el nombre es libre siempre que sea unico por agente, que es
lo unico que la regla 5 exige.

### 3.4 shared/ — fuente de verdad del contrato

| Ruta | Propietario | Fase | Congelado tras |
|---|---|---|---|
| `shared/package.json`, `shared/package-lock.json` | W1 | W1 | W1 |
| `shared/tsconfig.json`, `shared/vitest.config.ts` | W1 | W1 | W1 |
| `shared/index.ts` | W1 crea el andamiaje, W2-A lo sustituye, W7-A descomenta las cuatro reexportaciones | W1-W7 | W7 |
| `shared/domain/` y `shared/domain/__tests__/` | W2-A | W2 | W2 |
| `shared/config/` y `shared/config/__tests__/` | W2-A | W2 | W2 |
| `shared/rules/` y `shared/rules/__tests__/` | W2-B | W2 | W2 |
| `shared/world/` y `shared/world/__tests__/` | W2-B | W2 | W2 |
| `shared/api/` y `shared/api/__tests__/` | W2-C | W2 | W2 |
| `shared/api/README.md` | W2-C | W2 | W2 |
| `shared/ws/` y `shared/ws/__tests__/` | W2-C | W2 | W2 |
| `shared/__tests__/` | W1 crea un test de andamiaje, que W2 conserva | W1 | W2 |

Las pruebas de `shared/` viven en un `__tests__/` por subdirectorio y no en el `shared/__tests__/` de la
raiz, que conserva el unico test de andamiaje de W1 y sirve de comprobacion de que el barril completo
carga sin ciclos. Los patrones de exclusion de `scripts/sync-shared-types.sh` (`__tests__/` y
`*.test.ts`) casan a cualquier profundidad, de modo que ningun directorio de pruebas se copia y las
suites se ejecutan solo sobre el origen, que es lo que exige la seccion 4 del plan.

`shared/` es la unica fuente de verdad. Las copias en `backend/src/shared` y `frontend/app/shared`
son generadas, estan en `.gitignore` y nadie las escribe a mano. Cada copia lleva un `README.md` de aviso
que el propio script escribe.

### 3.5 backend/

| Ruta | Propietario | Fase | Congelado tras |
|---|---|---|---|
| `backend/package.json`, `backend/package-lock.json` | W1 | W1 | W1 |
| `backend/tsconfig.json`, `backend/tsconfig.build.json` | W1 | W1 | W1 |
| `backend/vitest.config.ts`, `backend/vitest.int.config.ts` | W1 | W1 | W1 |
| `backend/Dockerfile` | W1 | W1 | W1 |
| `backend/prisma.config.ts` | W2-D | W2 | W2 |
| `backend/prisma/schema.prisma` | W2-D | W2 | W2 |
| `backend/prisma/migrations/` | W2-D crea `20260811205212_init`; cada fase anade las suyas | W2-W6 | — |
| `backend/prisma/seed.ts` | W2-D | W2 | W2 |
| `backend/prisma/README.md` | W2-D | W2 | W2 |
| `backend/src/server.ts` | W1 crea el stub, W3-A lo sustituye | W1-W3 | W3 |
| `backend/src/worker.ts` | W1 crea el stub, W3-A lo sustituye | W1-W3 | W3 |
| `backend/src/app.ts` | W3-A | W3 | W3 |
| `backend/src/plugins/` | W3-A | W3 | W3 |
| `backend/src/lib/` | W3-A | W3 | W3 |
| `backend/src/modules/auth/` | W3-A | W3 | — |
| `backend/src/modules/world/` | W3-B | W3 | — |
| `backend/src/modules/land/` | W4-A | W4 | — |
| `backend/src/modules/farms/` | W4-B | W4 | — |
| `backend/src/modules/fields/` | W4-C | W4 | — |
| `backend/src/modules/machinery/` | W5-A | W5 | — |
| `backend/src/modules/workers/` | W5-B | W5 | — |
| `backend/src/modules/economy/` | W5-C | W5 | — |
| `backend/src/modules/tasks/` | W6-A | W6 | — |
| `backend/src/modules/session/` | W6-B | W6 | — |
| `backend/src/modules/forestry/` | W6-C | W6 | — |
| `backend/src/__tests__/` | el agente de cada modulo, en el subdirectorio de su modulo | W3-W7 | — |
| `backend/src/shared/` | generado por `scripts/sync-shared-types.sh` (`make sync-types`) | — | no editable |
| `backend/src/generated/prisma/` | generado por `prisma generate` (`make generate`) | — | no editable |

W3-A crea los stubs de los once modulos con su ruta y su firma definitivas, mas el registro de rutas
que los importa (regla 3). Los agentes de W4, W5 y W6 sustituyen el contenido del stub de su modulo,
nunca el registro.

### 3.6 frontend/

| Ruta | Propietario | Fase | Congelado tras |
|---|---|---|---|
| `frontend/package.json`, `frontend/package-lock.json` | W1 | W1 | W1 |
| `frontend/nuxt.config.ts` | W1 | W1 | W1 |
| `frontend/tsconfig.json`, `frontend/vitest.config.ts` | W1 | W1 | W1 |
| `frontend/Dockerfile` | W1 | W1 | W1 |
| `frontend/app/app.vue` | W1 crea el stub, W3-C lo sustituye | W1-W3 | W3 |
| `frontend/app/pages/` | W1 crea `index.vue` de andamiaje, W3-C lo sustituye | W1-W3 | W3 |
| `frontend/app/layouts/` | W3-C | W3 | W3 |
| `frontend/app/components/panels/index.ts` (registro) | W3-C | W3 | W3 |
| `frontend/app/components/panels/` (primer grupo) | W4-E | W4 | — |
| `frontend/app/components/panels/` (segundo grupo) | W5-F | W5 | — |
| `frontend/app/components/panels/` (tercer grupo) | W6-D | W6 | — |
| `frontend/app/stores/` | W3-C crea todos los stores con su forma final | W3 | W3 |
| `frontend/app/composables/` | W3-C | W3 | — |
| `frontend/app/net/api.ts`, `frontend/app/net/ws.ts` | W3-C | W3 | W3 |
| `frontend/app/mock/` | W3-C | W3 | — |
| `frontend/app/assets/tokens.css` | W1 crea el andamiaje, W3-D lo genera | W1-W3 | W3 |
| `frontend/app/game/boot/` | W3-D | W3 | — |
| `frontend/app/game/textures/` | W3-D | W3 | — |
| `frontend/app/game/world/` | W4-D | W4 | — |
| `frontend/app/game/entities/` | W5-D | W5 | — |
| `frontend/app/game/overlay/` | W5-D | W5 | — |
| `frontend/app/game/selection/` | W5-E | W5 | — |
| `frontend/app/__tests__/` | W1 crea un test de andamiaje; despues, el agente de cada pieza | W1-W7 | — |
| `frontend/app/shared/` | generado por `scripts/sync-shared-types.sh` (`make sync-types`) | — | no editable |
| `frontend/.nuxt/` | generado por `nuxt prepare`, que invoca `make typecheck` | — | no editable |

El reparto de los tres grupos de paneles se cierra en W3-C al escribir el registro: cada panel existe
como stub con su nombre, sus props y su lugar en el indice desde esa fase.

### 3.7 tools/

| Ruta | Propietario | Fase | Congelado tras |
|---|---|---|---|
| `tools/balance/` | W6-E | W6 | — |

La calculadora importa las mismas constantes que el juego desde `shared/config/` y emite el informe
en `docs/balance/`. W7-D cierra el informe con la lista de valores del GDD no reproducibles.

---

## 4. Correspondencia con el arbol real

El arbol de la seccion 4 del plan esta cubierto por completo en la tabla anterior, y toda ruta existente
en el arbol real esta atribuida. Comprobado al cierre de W2 con `git status --porcelain` y con
`find . -type f` excluyendo `node_modules/` y `.git/`.

### 4.1 Diferencias introducidas en W1

| Ruta | Situacion |
|---|---|
| `package.json` y `package-lock.json` en la raiz | Adicion de W1. El plan no los previo, pero `eslint.config.js` y Prettier necesitan un lugar donde declararse; sin ello `npx eslint .` no resuelve sus propios plugins. Es un proyecto privado de solo herramientas, sin dependencias de ejecucion, que no convierte el repositorio en un workspace. |
| `infra/caddy/Caddyfile.prod` | Adicion de W1. Un unico Caddyfile no puede a la vez delegar en el servidor de desarrollo y servir ficheros estaticos, porque la sustitucion de variables de entorno de Caddy opera sobre un token y no sobre una directiva completa. |
| `backend/tsconfig.build.json` | Adicion de W1. Separa la comprobacion de tipos, que abarca `src/`, `prisma/` y las configuraciones de Vitest, de la emision, que solo debe abarcar `src/` para que `dist/server.js` quede en la raiz de `dist/`. |
| `shared/vitest.config.ts`, `backend/vitest.config.ts`, `backend/vitest.int.config.ts`, `frontend/vitest.config.ts` | Adicion de W1. Los scripts de `package.json` estan congelados y los invocan, asi que deben existir desde la primera fase. |
| `.prettierignore` | Adicion de W1. Excluye el GDD, el documento de stack y el resto de `docs/`, que no deben reformatearse. |
| `frontend/app/pages/index.vue` | Andamiaje de W1, exigido por `<NuxtPage />` en `app.vue`. |
| `shared/index.ts`, `shared/__tests__/scaffolding.test.ts`, `frontend/app/__tests__/scaffolding.test.ts` | Andamiaje de W1: sin al menos un fichero, `tsc` falla por falta de entradas y `vitest` por falta de pruebas. W2-A sustituyo `shared/index.ts`; los dos ficheros de prueba de andamiaje siguen vigentes y son utiles, porque el de `shared/` comprueba que el barril completo carga sin ciclos. |
| `frontend/app/pages/index.vue`, `frontend/app/app.vue`, `frontend/app/assets/tokens.css`, `backend/src/server.ts`, `backend/src/worker.ts` | Andamiajes de W1 que siguen sin sustituir. Sus propietarios son W3-C, W3-D y W3-A respectivamente, y cada fichero lleva en cabecera el agente que lo sustituye. |

### 4.2 Diferencias introducidas en W2

| Ruta | Situacion |
|---|---|
| `shared/api/README.md` | Adicion de W2-C. Once apartados que documentan el mapa de rutas, los conversores de frontera y la correspondencia entre los nombres de evento del plan y `GameEventType`. Es documentacion de contrato y vive junto al contrato, no en `docs/`. Consecuencia no prevista: `.prettierignore` excluye `docs/` pero no este fichero, de modo que `npx prettier --check .` lo senala y `make lint` falla. Requiere un cambio en un fichero congelado y lo aplica W7-A. |
| `backend/prisma/README.md` | Adicion de W2-D. Modelo, invariantes, contrato real de Prisma 7.9.1 y procedimiento de migracion. |
| `backend/prisma.config.ts` | Previsto por el plan en la seccion 4 y confirmado como obligatorio: en Prisma 7 la configuracion vive en la raiz del proyecto npm y no en `prisma/`, y sin ella el CLI no encuentra ni el esquema ni la ruta de migraciones. |
| `backend/src/generated/prisma/` | Adicion obligada por el contrato de Prisma 7, que exige `output` explicito en el generador. No puede estar fuera de `src/`, porque `tsconfig.build.json` declara `rootDir: "src"` y una fuente generada fuera falla con TS6059. Son 28 ficheros y 2,3 MB de codigo generado y regenerable, equivalente a `backend/src/shared`. Pendiente que hay que aplicar: `.gitignore` y `.prettierignore` no lo excluyen, de modo que hoy se versionaria y `make lint` falla. Ambos son ficheros congelados; lo aplica W7-A. |
| `frontend/.nuxt/` | Generado por `nuxt prepare`, que ejecuta el objetivo `typecheck`. Ignorado por git. Contiene los cuatro proyectos de TypeScript que Nuxt 4.5 genera y a los que `frontend/tsconfig.json` hace referencia. |
| `shared/rules/codes.ts` | No existe y no se creara. La seccion 8 del plan lo enumera entre los modulos de reglas, pero los codigos de validacion y su tabla de mensajes son vocabulario cerrado y no una regla, de modo que viven en `shared/domain/enums.ts`, escrito por W2-A. `shared/rules/` los consume desde alli. |
| `shared/__tests__/` frente a los `__tests__/` por subdirectorio | El plan solo preveia `shared/__tests__/`. Las suites reales viven en un `__tests__/` por subdirectorio, que es lo que permitio a los cuatro agentes de W2 escribir pruebas sin compartir directorio. |
| `backend/prisma/` | Ya existe. `backend/Dockerfile` genera el cliente de Prisma solo si encuentra el esquema, de modo que la imagen se construye antes y despues de esa fase; la etapa de produccion si exige el directorio. |
| `tools/balance/`, `scripts/smoke/`, `docs/balance/` | No existen todavia. `make balance` y `make smoke` detectan su ausencia y nombran al agente propietario en el mensaje de error, y `make verify` encadena `smoke`, de modo que la puerta unica no puede quedar en verde hasta W7. Es el comportamiento previsto por el plan. |
