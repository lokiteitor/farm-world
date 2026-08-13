# NOTES-w2-5-parcheo

Agente integrador de la ventana de parcheo. Fase W2.5. Unico agente de la fase y unico autorizado a
tocar ficheros congelados, a ejecutar `npm install`, Prisma y `docker compose`, y a borrar contenedores.

Objeto de la fase: dejar la base sana antes de que W3 escriba encima. Este fichero recoge lo aplicado,
lo que queda pendiente y para quien, y las discrepancias detectadas. Lo aplicado se ha movido tambien al
apartado «Resuelto» del fichero de traspaso de origen, conforme al apartado 2 de `README.md` de este
directorio.

## 1. Aplicado

| Ambito | Cambio | Origen |
|---|---|---|
| `backend/package.json` | `@prisma/adapter-pg` 7.9.1 declarado e instalado | `NOTES-w2d` 1 |
| `backend/prisma/seed.ts` | Import normal del adaptador, `INITIAL_ANCHOR_GAME_MS` importado de `shared/config`, asiento con `LedgerType.STARTING_CAPITAL` y carga explicita del `.env` de la raiz | `NOTES-w2d` 1, 3, 8 |
| `.gitignore`, `.prettierignore` | `backend/src/generated/` excluido; `**/README.md` excluido de Prettier | `NOTES-w2d` 2, `NOTES-w2-cierre` 1 y 2 |
| Los tres ficheros de Compose | Todos los puertos publicados parametrizados con valores por defecto libres | Colision de puertos de esta maquina |
| `docker-compose.yml`, `docker-compose.prod.yml` | Montaje de datos de PostgreSQL en `/var/lib/postgresql` | `NOTES-w2d` 6 |
| `.env.example` | Tabla de puertos con su motivo, variables de la semilla y base de datos sombra | `NOTES-w2d` 7 |
| `Makefile` | `sync-types` como prerrequisito de `seed` y de `reset`; puertos de los objetivos informativos | `NOTES-w2d` 9 |
| `shared/domain/enums.ts` | `LedgerType.STARTING_CAPITAL`, conjunto `ScheduledEventStatus`, `TERRAIN_NOT_FORESTABLE` y los cinco codigos de autenticacion, con sus mensajes | `NOTES-w2d` 3 y 4, `NOTES-W2b` 1.2, `NOTES-W2c` 1.2 |
| `shared/api/errors.ts` | Los cinco codigos de autenticacion salen de `ApiTransportCode`, que conserva seis; estado HTTP del codigo de terreno forestal | `NOTES-W2c` 1.2 |
| `shared/rules/selection.ts` | `canBeForestPlotCell` y `canClearCell` devuelven `TERRAIN_NOT_FORESTABLE` | `NOTES-W2b` 1.2 |
| `shared/config/time.ts` | `INITIAL_ANCHOR_GAME_MS`, derivado del catalogo forestal | `NOTES-w2d` 8 |
| `shared/config/world.ts` | Suelo de montana de la banda de distribucion, de 200 a 100 puntos base | `NOTES-W2b` 1.3 |
| `shared/domain/entities.ts` | Las siete divergencias alineadas siguiendo el esquema | `NOTES-w2d` 5 |
| `shared/index.ts` | Las cuatro reexportaciones pendientes habilitadas | `NOTES-W2a` 1.1, `NOTES-W2b` 1.1, `NOTES-W2c` 1.1 |
| `backend/prisma/schema.prisma` y `migrations/` | `STARTING_CAPITAL` en el enum y migracion `20260811215755_ledger_type_starting_capital` | `NOTES-w2d` 3 |
| `backend/prisma/README.md`, `README.md` de la raiz | Estado real: dependencias resueltas, ubicacion del ancla, tabla de puertos | Consecuencia de los cambios anteriores |
| Entorno | Contenedor `farm-world-pg-w2d` y su volumen borrados; `postgres` y `redis` en marcha con Compose; `.env` local creado; migraciones aplicadas y semilla ejecutada | `NOTES-w2d` 10 |

Las pruebas de `shared/` que afirmaban los valores antiguos se actualizaron con el cambio que las
provoca, no al reves: `shared/api/__tests__/errors.test.ts`, `shared/api/__tests__/schemas.test.ts` y
`shared/rules/__tests__/selection.test.ts`, una linea cada una.

`shared/rules/__tests__/golden.tmp.test.ts`, que el brief de esta fase pedia borrar, no existe: el
directorio contiene doce ficheros de prueba y ninguno temporal. `balance-golden.test.ts` cubre la prueba
dorada completa, 23 pruebas, sin trazas.

## 2. Pendiente

### 2.1 Entradas de ADR que hay que redactar o corregir

Categoria: cambio en fichero de otro propietario
Ficheros afectados: `docs/adr.md`
Propietario del cambio: el agente designado por fase, siempre via `scripts/adr-append.mjs`

`docs/ownership.md` reserva la escritura de `docs/adr.md` a un unico agente por fase y esta ventana no
es ninguno de ellos, de modo que no se ha tocado. Tres pasajes quedan desfasados y conviene corregirlos
cuando el proximo escritor abra el fichero:

- ADR-0006, punto 4: dice que `ApiTransportCode` tiene once valores. Tiene seis. Los cinco de
  autenticacion viven en `ValidationCode`, y el propio ADR ya recogia esa posibilidad en su apartado
  «Queda por vigilar», con la unica diferencia de que `API_TRANSPORT_CODES` no queda vacio.
- ADR-0007: su «Queda pendiente un cambio en fichero congelado» sobre el ancla inicial esta aplicado.
- ADR-0009: describe `COMPENSATION` con `meta.reason` como solucion vigente para el capital inicial y
  `STARTING_CAPITAL` como propuesta. El valor existe y la semilla lo usa.

Mitigacion adoptada: los tres cambios estan documentados aqui y en el apartado «Resuelto» del fichero de
origen, de modo que ningun lector del codigo depende del ADR para conocer el estado real.

### 2.2 Tabla de propiedad

Categoria: cambio en fichero de otro propietario
Ficheros afectados: `docs/ownership.md`
Propietario del cambio: W2-E o W7-D

Dos filas quedan desfasadas: la de `shared/index.ts` atribuye a W7-A el descomentado de las cuatro
reexportaciones, que hizo esta ventana, y la tabla del apartado 2 no recoge la fase W2.5. El apartado
3.5 ya prevee que cada fase anada sus migraciones, de modo que la segunda migracion no necesita fila
nueva.

Mitigacion adoptada: ninguna necesaria. Ninguna ruta nueva se ha creado sin dueno.

### 2.4 Adelgazamiento de la etapa `runtime` de la imagen del backend

Categoria: optimizacion, no bloquea
Ficheros afectados: `backend/Dockerfile`
Propietario del cambio: W7-A

La nota 2 de `NOTES-W1` describia esta optimizacion como posible en cuanto el generador de Prisma
emitiese bajo `src/`. Ya lo hace, `backend/src/generated/prisma`, de modo que la etapa `runtime` podria
reducirse a una instalacion sin dependencias de desarrollo en lugar de copiar el `node_modules` completo.
No se ha aplicado porque es tamano de imagen y no correccion, y porque la etapa actual es correcta en
ambos casos.

Mitigacion adoptada: la copia del arbol completo, que ya estaba.

## 3. Discrepancias detectadas

### 3.1 `make seed` no cargaba el entorno

Al script llegan dos caminos y solo uno traia el `.env` cargado. `prisma migrate reset` pasa por
`prisma.config.ts`, que lo carga y lo hereda el proceso hijo; `npm run seed` ejecuta `tsx prisma/seed.ts`
directamente y fallaba con «The environment variable DATABASE_URL is required». Ninguna nota de traspaso
lo recogia. Corregido en `seed.ts` con `process.loadEnvFile`, el mismo mecanismo y el mismo argumento que
en `prisma.config.ts`: es parte de Node 22 y no sobrescribe una variable ya presente, de modo que es
inocuo en integracion continua y dentro de los contenedores, donde el entorno llega de fuera y no hay
fichero.

### 3.2 La orden de verificacion del brief no existe en Prisma 7

`npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma
--exit-code` devuelve 1 con la ayuda del subcomando: `--to-schema-datamodel` es la forma de Prisma 6. En
7.9.1 la opcion se llama `--to-schema`, como ya documentaba el apartado 8.2 de
`backend/prisma/README.md`. La comprobacion equivalente devuelve 0 y «No difference detected», tanto
contra la base aplicada como reproduciendo el historial en la base de datos sombra.

### 3.3 Puertos por defecto de la pila de produccion

`docker-compose.prod.yml` publicaba 80 y 443 fijos. Se han parametrizado con `HTTP_PORT` y `HTTPS_PORT` y
sus valores por defecto son los libres, 8080 y 8443, para que la pila de produccion pueda ejercitarse en
una maquina de desarrollo. Consecuencia que hay que respetar en un despliegue real: la emision automatica
de certificados de Caddy exige los puertos canonicos, de modo que el despliegue debe fijar
`HTTP_PORT=80` y `HTTPS_PORT=443` explicitamente. Esta escrito en el comentario del propio servicio y en
`.env.example`.

### 3.4 Dos variables para el puerto del backend

`PORT` es el puerto en el que escucha el proceso, dentro del contenedor y en local, y lo lee
`backend/src/server.ts`. `BACKEND_PORT` es el puerto publicado en el host. Coinciden en 3000 y podria
parecer duplicacion, pero solo el segundo puede colisionar con otro proyecto y solo el primero llega al
codigo. Fundirlos obligaria a que cambiar el puerto publicado cambiase tambien el interno, que es
precisamente lo que la parametrizacion evita.

### 3.5 `.env` local con el jugador de desarrollo activado

El `.env` de esta maquina lleva `SEED_DEV_PLAYER=true` y `SHADOW_DATABASE_URL` definida, de modo que la
base de datos contiene el jugador `dev@farm-world.local` con el asiento `STARTING_CAPITAL` de 160.000 y
existe la base sombra `farmworld_shadow`. Sirve a los agentes de W3 para escribir pruebas de integracion
contra datos reales. `.env.example` conserva `SEED_DEV_PLAYER=false`, que es el valor seguro por omision,
y la semilla mantiene sus dos guardas: la bandera y `NODE_ENV`.

## 4. Estado en el que queda el entorno

`postgres` y `redis` en marcha y sanos, levantados con `docker compose`, en los puertos 55432 y 56379.
Las dos migraciones aplicadas, sin deriva. Mundo y jugador de desarrollo sembrados. `make sync-types`,
`make typecheck`, `make lint`, `make test-unit`, `make check-sync` y `make compose-config` devuelven 0.

`make test-int`, `make smoke` y `make verify` no pueden pasar todavia y no es un fallo de esta fase: no
existen ni las pruebas de integracion del backend ni `scripts/smoke/smoke.ts`, cuyos propietarios son los
agentes de W3 a W6 y W7-A. `make smoke` y `make balance` detectan la ausencia y nombran al propietario en
el mensaje de error, que es el comportamiento previsto por el plan.

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 2.5 Politica de reinicio del servicio `worker`

Aplicado por W7-A (integracion). Ver la nota 4 de `NOTES-W1.md`.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `docker-compose.yml`
Propietario del cambio: W7-A, a peticion de W3-A

Sigue en `restart: "no"` porque el punto de entrada continua siendo el andamiaje de W1, que registra una
linea y termina. El cambio a `unless-stopped` corresponde al momento en que W3 lo convierta en consumidor
de larga vida, no antes: adelantarlo produciria un ciclo de reinicios. La linea lleva su comentario en el
propio fichero.

### 2.3 `CORS_ORIGIN` de la integracion continua

Aplicado por W7-A (integracion). `.github/workflows/ci.yml` declara `CORS_ORIGIN: http://localhost:3100`,
que es el puerto publicado, y anade `METRICS_PORT`. Se aprovecho la apertura del fichero para anadir al
trabajo `static` el paso `make generate`: `backend/src/generated/prisma` esta en `.gitignore` y tanto la
comprobacion de tipos como la suite unitaria del backend, que `make test-unit` ejecuta desde esta ventana,
lo necesitan.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `.github/workflows/ci.yml`
Propietario del cambio: W7-A

El trabajo declara `CORS_ORIGIN: http://localhost:3001`, que era el puerto del servidor de desarrollo
antes de parametrizarlo y ahora es 3100. No se ha cambiado porque en integracion continua no hay
navegador y ningun trabajo levanta el cliente, de modo que el valor no se ejercita; cambiarlo sin
necesidad habria tocado un fichero congelado por estetica. Conviene alinearlo cuando W7 revise el
fichero, junto con las variables de la semilla si el trabajo `integration` acaba ejecutandola.

Mitigacion adoptada: los servicios de la integracion continua publican sus propios puertos canonicos y
son independientes de `.env`, de modo que nada mas del fichero depende de este parcheo.
