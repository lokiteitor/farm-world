# NOTES-w2d

Agente de esquema de datos. Fase W2. Ambito escrito: `backend/prisma/` y
`backend/prisma.config.ts`.

Contexto que necesita quien lea estas notas: el contrato real de Prisma 7.9.1 esta documentado en
`backend/prisma/README.md`, apartado 2, y difiere del de Prisma 6 en cinco puntos que afectan a todo
el backend. La nota 1 es la unica que bloquea la ejecucion.

## Pendiente

Ninguna. Las diez notas de esta fase las aplico la ventana de parcheo de W2.5; el detalle esta en el
apartado «Resuelto», que conserva el texto original de cada una.

## Estado del entorno

Sustituye al estado que este agente dejo al cerrar W2, que describia un contenedor levantado a mano
fuera de Compose. Ese contenedor y su volumen se borraron en la ventana de parcheo de W2.5.

| Dato | Valor |
|---|---|
| Servicios | `farm-world-postgres-1` y `farm-world-redis-1`, levantados con `docker compose`, ambos sanos |
| Puertos publicados | `55432` para PostgreSQL y `56379` para Redis, parametrizados en `.env.example` |
| Montaje de datos | `pg_data:/var/lib/postgresql`, que es lo que la imagen 18 admite |
| Ajustes de cluster | `infra/postgres/init.sql` aplicado: `timezone = UTC`, `default_transaction_isolation = read committed` |
| Base de datos sombra | `farmworld_shadow`, creada y declarada en el `.env` local |
| Migraciones aplicadas | `20260811205212_init` y `20260811215755_ledger_type_starting_capital` |
| Semilla | Mundo `seed 20260811`, ancla 3.456.000.000 gameMs, y jugador de desarrollo `dev@farm-world.local` con el asiento `STARTING_CAPITAL` de 160.000 |
| Deriva | Ninguna: `prisma migrate diff` devuelve 0 contra la base aplicada y contra el historial reproducido en la sombra |

El `.env` local existe, no se versiona y lleva `SEED_DEV_PLAYER=true` y `SHADOW_DATABASE_URL`
definidas. `.env.example` conserva `SEED_DEV_PLAYER=false`, que es el valor seguro por omision.

## Resuelto

Las diez notas las aplico la ventana de parcheo de W2.5. Resumen de lo aplicado; el texto original de
cada nota se conserva a continuacion.

| Nota | Aplicado |
|---|---|
| 1 | `@prisma/adapter-pg` 7.9.1 en `backend/package.json`, `npm install` ejecutado y la indireccion de `seed.ts` sustituida por un `import` normal |
| 2 | `backend/src/generated/` excluido en `.gitignore` y en `.prettierignore`; `make lint` pasa |
| 3 | `STARTING_CAPITAL` anadido a `LedgerType` en `shared/domain/enums.ts` y en `schema.prisma`, con la migracion `20260811215755_ledger_type_starting_capital`; `seed.ts` ya lo usa |
| 4 | `ScheduledEventStatus` declarado en `shared/domain/enums.ts` con `PENDING`, `PROCESSED` y `CANCELED` en ese orden |
| 5 | Las siete divergencias alineadas en `shared/domain/entities.ts` siguiendo el esquema |
| 6 | Montaje `pg_data:/var/lib/postgresql` en `docker-compose.yml` y en `docker-compose.prod.yml` |
| 7 | Las cuatro variables documentadas en `.env.example`, dentro de los apartados «Seed» y «PostgreSQL» |
| 8 | `INITIAL_ANCHOR_GAME_MS` en `shared/config/time.ts`, derivado del catalogo forestal; `seed.ts` lo importa |
| 9 | `sync-types` es prerrequisito de `seed` y de `reset` en el `Makefile` |
| 10 | Ejecutados `npm install`, `make sync-types`, `make generate` y `make migrate`, mas la limpieza del contenedor fuera de Compose |

Hallazgo adicional al ejecutar la nota 10, no previsto en ninguna nota: `make seed` fallaba con «The
environment variable DATABASE_URL is required» porque `npm run seed` invoca `tsx prisma/seed.ts`
directamente y nadie cargaba el `.env` de la raiz. Solo el camino de `prisma migrate reset` lo traia
cargado, a traves de `prisma.config.ts`. Corregido en `seed.ts` con `process.loadEnvFile`, el mismo
mecanismo y por el mismo motivo que en `prisma.config.ts`.

### 1. Falta la dependencia `@prisma/adapter-pg@7.9.1`

Categoria: dependencia que falta
Ficheros afectados: `backend/package.json`, `backend/package-lock.json`
Propietario del cambio: W1 (congelado), a aplicar por W7-A
Motivo: Prisma 7 elimino el motor de consultas binario y exige un adaptador de driver para construir
un cliente. `new PrismaClient()` no compila y `datasourceUrl` ya no existe; la unica forma admitida
para PostgreSQL es `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`. El paquete
arrastra `pg` como dependencia propia, de modo que es una sola linea:

```json
"@prisma/adapter-pg": "7.9.1"
```

Sin ella no arrancan ni el backend ni `npm run seed`. No la necesitan `prisma validate`,
`prisma format`, `prisma migrate` ni `prisma generate`, que operan a traves del motor de esquema.
Mitigacion adoptada mientras tanto: `backend/prisma/seed.ts` carga el adaptador con un especificador
indirecto (`const POSTGRES_ADAPTER_MODULE: string = '@prisma/adapter-pg'`), lo que mantiene
`tsc --noEmit` en verde para todos los agentes de W3 a W6 y produce, si el paquete no esta, un error
en tiempo de ejecucion que nombra el paquete y esta nota. El dia que se instale, esa indireccion puede
volver a ser un `import` normal sin ningun otro cambio.

### 2. Falta ignorar la salida del generador de Prisma

Categoria: cambio en fichero congelado
Ficheros afectados: `.gitignore`, `.prettierignore`
Propietario del cambio: W1 (congelado), a aplicar por W7-A
Motivo: en Prisma 7 el generador `prisma-client` emite TypeScript y exige `output` explicito. La
salida es `backend/src/generated/prisma`, y no puede estar en otro sitio: `tsconfig.build.json`
declara `rootDir: "src"`, de modo que una fuente generada fuera de `src/` falla la compilacion con
TS6059 (comprobado). Es codigo generado y regenerable, equivalente a `backend/src/shared`, asi que no
debe versionarse ni pasar por Prettier. Anadir en ambos ficheros, junto a las entradas existentes de
`backend/src/shared/`:

```
backend/src/generated/
```

Mitigacion adoptada mientras tanto: ninguna posible desde el ambito del agente. Los ficheros llevan
`/* eslint-disable */` y `// @ts-nocheck` generados por Prisma, de modo que `npx eslint .` no informa
nada; `npx prettier --check .` si informaria, y por tanto `make lint` fallaria en local tras
`make generate` hasta que se aplique la entrada. En CI no ocurre, porque el fichero no esta versionado
y el trabajo de lint no ejecuta `make generate`.

### 3. `LedgerType` no tiene un valor para el capital inicial

Categoria: valor de enumerado que falta en el contrato
Ficheros afectados: `shared/domain/enums.ts`, `backend/prisma/schema.prisma`
Propietario del cambio: W2 (cerrado), a aplicar por W7-A
Motivo: el ledger es auditable porque la suma de sus asientos es igual al saldo, y la prueba de humo
de la seccion 10 del plan lo comprueba. Un jugador nuevo tiene 160.000 de saldo (§117), asi que ese
importe necesita un asiento; si no, la invariante se rompe con el primer jugador. Los diecisiete
valores de `LedgerType` no incluyen ninguno que lo describa. Se propone `STARTING_CAPITAL`, que en
PostgreSQL es `ALTER TYPE "LedgerType" ADD VALUE 'STARTING_CAPITAL'` en una migracion propia.
Mitigacion adoptada mientras tanto: `seed.ts` emplea `COMPENSATION`, que es el valor reservado para un
asiento que el mundo hace a favor del jugador, con `meta = { reason: 'STARTING_CAPITAL', gddSection:
117 }`. Afecta tambien a W3-A: el registro de un jugador nuevo se enfrenta a la misma pregunta y debe
usar el mismo tipo y la misma clave de idempotencia (`starting-capital:<playerId>`) hasta que el valor
exista.

### 4. Falta el conjunto `ScheduledEventStatus` en el vocabulario compartido

Categoria: valor de enumerado que falta en el contrato
Ficheros afectados: `shared/domain/enums.ts`
Propietario del cambio: W2 (cerrado), a aplicar por W7-A
Motivo: la seccion 5 del plan exige `status` en `ScheduledEvent`, con unicidad parcial sobre los
pendientes e indices por `(status, dueGameMs)`. `shared/domain/enums.ts` no declara ningun conjunto
equivalente, asi que el esquema declara el enum `ScheduledEventStatus` con `PENDING`, `PROCESSED` y
`CANCELED`. Para que la paridad enum de Prisma frente a enum compartido siga siendo exacta, hay que
declararlo tambien en `shared/domain/enums.ts` con esos tres valores y en ese orden.
Mitigacion adoptada mientras tanto: el enum existe en el esquema y esta documentado en su comentario;
el backend puede importar el tipo generado por Prisma mientras no exista el compartido.

### 5. Divergencias entre `shared/domain/entities.ts` y el esquema

Categoria: campos que faltan o difieren en el contrato
Ficheros afectados: `shared/domain/entities.ts`
Propietario del cambio: W2 (cerrado), a aplicar por W7-A
Motivo: las interfaces de `entities.ts` son el reflejo previsto del esquema y los modulos hacen el
mapeo explicito, de modo que ninguna divergencia bloquea. Conviene alinearlas para que el mapeo sea
mecanico. Siete puntos, con la razon de haber seguido el brief y no la interfaz:

| Interfaz de `entities.ts` | Esquema | Razon |
|---|---|---|
| `ScheduledEvent.subjectType`, `subjectId` | `refType`, `refId` | La seccion 5 del plan y el brief nombran `refType`/`refId`, igual que en el ledger, y la referencia polimorfica es el mismo mecanismo en ambos |
| `ScheduledEvent` sin `status` ni `dedupeKey` | `status`, `dedupeKey` | Ambos los exige el brief; la unicidad parcial sobre los pendientes no es expresable sin ellos |
| `Building.occupancy`, `capacity` | `machineCount`, `workerCount`, `capacityMachines`, `capacityWorkers`, `capacityStorageUnits`, `storageResource` | El brief exige los dos contadores por separado. Con un unico contador y una unica capacidad, el `CHECK` no puede saber que cuenta, y el disparador que suma la capacidad de almacenamiento en la granja no puede saber a que recurso pertenece |
| `Building` sin precio | `purchasePrice` | Simetria con `Machine.purchasePrice`: el valor de reventa debe seguir siendo auditable si se retoca el catalogo |
| `Farm` sin capacidades | `capacityWheatLiters`, `capacityWoodDm3` | El brief pide capacidad en `Farm`. Es lo que permite que «existencias frente a capacidad» sea un `CHECK` intra-fila en lugar de una consulta |
| `Player` sin origen | `spawnCellX`, `spawnCellY` | El asignador determinista de origen debe respetar la separacion minima entre jugadores; derivarla de las celdas en propiedad la falsificaria una venta |
| `Tree` sin `worldId` | `worldId` | La unicidad de un arbol por celda tiene que estar acotada al mundo, y la celda se direcciona por coordenadas absolutas porque puede no tener fila |

Mitigacion adoptada mientras tanto: ninguna necesaria. Los nombres del esquema son los que ve el
backend a traves del cliente generado; el mapeo a las entidades de dominio es explicito en cada
modulo, como declara la cabecera de `entities.ts`.

### 6. El servicio `postgres` de Compose no arranca con la imagen 18

Categoria: cambio en fichero congelado
Ficheros afectados: `docker-compose.yml`, y `docker-compose.prod.yml` si repite el montaje
Propietario del cambio: W1 (congelado), a aplicar por W7-A
Motivo: el servicio monta `pg_data:/var/lib/postgresql/data`. La imagen `postgres:18-alpine` rechaza
ese montaje y sale con error en bucle: desde la version 18 los datos viven en un subdirectorio con el
nombre de la version mayor y el montaje debe ser `/var/lib/postgresql`. Comprobado: el contenedor
queda en `unhealthy` con «in 18+, these Docker images are configured to store database data in a
format which is compatible with pg_ctlcluster». El cambio es una linea:

```yaml
volumes:
  - pg_data:/var/lib/postgresql
```

Mitigacion adoptada mientras tanto: el agente levanto un contenedor equivalente fuera de Compose para
crear y verificar la migracion (apartado «Estado del entorno» al final de este fichero). El volumen
`farm-world_pg_data` que habia creado el intento fallido se elimino, de modo que la correccion
encontrara el volumen vacio y `initdb` se ejecute con la ruta correcta.

### 7. Variables de entorno nuevas para `.env.example`

Categoria: cambio en fichero congelado
Ficheros afectados: `.env.example`
Propietario del cambio: W1 (congelado), a aplicar por W7-A
Motivo: la semilla y la comprobacion de idempotencia del historial leen cuatro variables que la
plantilla no documenta. Ninguna es balance.

```bash
# --- Semilla ---------------------------------------------------------------
# Crea un jugador de prueba con el capital inicial de §117. No se honra con
# NODE_ENV=production, porque la contrasena es conocida.
SEED_DEV_PLAYER=false
SEED_DEV_PLAYER_EMAIL=dev@farm-world.local
SEED_DEV_PLAYER_PASSWORD=farm-world-dev

# Base de datos sombra. Solo necesaria para
# `prisma migrate diff --from-migrations`, que reproduce el historial en ella, y
# para bases gestionadas donde el usuario no puede crear bases de datos.
# SHADOW_DATABASE_URL=postgresql://farmworld:farmworld@localhost:5432/farmworld_shadow?schema=public
```

Mitigacion adoptada mientras tanto: `seed.ts` aplica los valores por defecto de la tabla del apartado
9 de `backend/prisma/README.md` y no crea jugador de prueba si la bandera no vale exactamente `true`.

### 8. El ancla inicial del reloj deberia ser constante compartida

Categoria: campo que falta en el contrato
Ficheros afectados: `shared/config/time.ts`
Propietario del cambio: W2 (cerrado), a aplicar por W7-A
Motivo: el reloj de un mundo nuevo se ancla en 960 horas de juego y no en cero, porque un bosque
comprado llega ya poblado (§130, §141) y el arbol mas viejo que el generador puede extraer tiene esa
edad; con el mundo anclado en cero necesitaria un instante de plantacion negativo, que el dominio
prohibe. El valor no es inventado: es
`PINE.stageStartGameHours.OLD_GROWTH + NATURAL_FOREST.oldGrowthAgeSpanGameHours`. Hoy se calcula en
`seed.ts`. Le corresponde estar en `shared/config/time.ts` como `INITIAL_ANCHOR_GAME_MS`, porque lo
necesitan tambien el generador de bosque y las pruebas de propiedad del reloj.
Mitigacion adoptada mientras tanto: derivado en `seed.ts` de esas dos constantes, con la razon
documentada en su comentario y en el apartado 7 del README de `prisma/`.

### 9. `make seed` no depende de `sync-types`

Categoria: cambio en fichero congelado
Ficheros afectados: `Makefile`
Propietario del cambio: W1 (congelado), a aplicar por W7-A
Motivo: `seed.ts` importa las constantes de `backend/src/shared`, que es la copia sincronizada, porque
la regla de zonas de ESLint prohibe importar `shared/` de la raiz desde el backend. Los objetivos
`typecheck`, `lint`, `test-unit`, `test-int`, `up`, `dev` y `build` ya declaran `sync-types` como
prerrequisito; `seed` y `reset` no, de modo que un `make seed` en un arbol recien clonado falla con
«does not provide an export named CHUNK_SIZE». Anadir el prerrequisito a `seed` y a `reset`.
Mitigacion adoptada mientras tanto: documentado en el apartado 9 del README de `prisma/`. El error es
inmediato y explicito, no silencioso.

### 10. Ordenes que quedan por ejecutar fuera del ambito del agente

Categoria: ordenes que hay que ejecutar
Propietario: W7-A

1. `npm install` en `backend/` tras aplicar la nota 1.
2. `make sync-types`, que W2 no ejecuta porque escribe fuera de su ambito. Hasta entonces
   `backend/src/shared` conserva el andamiaje de W1 y `npx tsc --noEmit` en `backend/` falla al
   resolver las constantes que importa `seed.ts`. Verificado que con la copia al dia la comprobacion
   de tipos pasa (apartado de verificacion).
3. `make generate` en cualquier arbol nuevo, porque el cliente generado no se versiona.
4. `make migrate` para aplicar la migracion inicial en un entorno limpio.
