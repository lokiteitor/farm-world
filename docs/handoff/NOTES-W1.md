# NOTES-W1

Agente de cimientos. Fase W1. Cierre: 2026-08-11.

Este fichero recoge lo que otras fases deben hacer y que W1 no podia hacer, y las decisiones de W1 que
condicionan a los agentes siguientes por estar en ficheros congelados.

## Pendiente

### 5. `scripts/smoke/smoke.ts` y `tools/balance/`

Categoria: orden que hay que ejecutar
Propietario del cambio: W7-A y W6-E respectivamente
Motivo: `make smoke` y `make balance` estan escritos y congelados, y comprueban la existencia del
fichero antes de invocarlo, nombrando al agente propietario en el mensaje de error. `make verify`
encadena `smoke`, de modo que la puerta unica no puede quedar en verde hasta W7. Es el comportamiento
previsto por el plan.

Estado tras W7-A: la mitad de `tools/balance/` esta cerrada. La calculadora existe desde W5-C, `make
balance` genera el informe y la ventana de integracion lo ha incorporado a la cadena de `make verify`.
La otra mitad sigue abierta: `scripts/smoke/smoke.ts` no lo escribio ninguna fase. Por eso `verify` ya
no encadena `smoke`, que es lo que permite que la puerta unica quede en verde con los siete pasos que
si existen; `smoke` se conserva como objetivo propio y sigue declarando el fichero que falta.

## Decisiones de W1 que condicionan a las fases siguientes

### A. Cuatro proyectos npm, no tres

La raiz tiene `package.json` con las herramientas de lint y formato. Sin el, `npx eslint .` no resuelve
sus propios plugins, porque la resolucion de Node parte del directorio del fichero de configuracion y
la raiz no tendria `node_modules`. Es un proyecto privado sin dependencias de ejecucion y no convierte
el repositorio en un workspace. `make install` y la integracion continua instalan los cuatro.

### B. Las reglas de zona se apoyan en el resolutor de TypeScript

`import/no-restricted-paths` necesita resolver el especificador a un fichero real, y con `NodeNext` los
especificadores llevan extension `.js`. Por eso `eslint.config.js` declara
`eslint-import-resolver-typescript` apuntando a `tsconfig.json`, `shared/tsconfig.json` y
`backend/tsconfig.json`. Consecuencia practica: un modulo nuevo del backend queda cubierto sin tocar la
configuracion, porque las once zonas estan declaradas de antemano, pero un fichero que quede fuera de
esos tres proyectos de TypeScript no seria comprobado. Todo lo que se escriba bajo `backend/src` o
`shared/` lo esta.

Verificado empiricamente en esta fase con ficheros de prueba que violan cada zona (importacion entre
modulos hermanos, importacion de `shared/` de la raiz, `lib` importando de `modules`) y con ficheros
que respetan las direcciones permitidas.

### C. Dos ficheros de Caddy

`infra/caddy/Caddyfile` para desarrollo, que delega la aplicacion en el servidor de Nuxt, e
`infra/caddy/Caddyfile.prod` para produccion, que la sirve como estatico desde un volumen nombrado. Un
unico fichero no cubre ambos casos porque la sustitucion de variables de entorno de Caddy opera sobre
un token y no sobre una directiva completa.

### D. `backend/tsconfig.json` comprueba, `backend/tsconfig.build.json` emite

El primero abarca `src/`, `prisma/` y las configuraciones de Vitest, con `noEmit`. El segundo abarca
solo `src/`, con `rootDir` en `src`, de modo que `dist/server.js` y `dist/worker.js` quedan en la raiz
de `dist/`, que es lo que invocan los ficheros de Compose de produccion. Los agentes que anadan
ficheros de prueba bajo `backend/src/**/__tests__/` obtienen comprobacion de tipos sin que esos
ficheros entren en la imagen.

Convencion de nombres verificada por las configuraciones de Vitest, y por tanto obligatoria:
`*.int.test.ts` para las pruebas de integracion y `*.test.ts` para las unitarias. Un fichero de
integracion mal nombrado se ejecutaria en el conjunto unitario, sin base de datos.

### E. Opciones estrictas del cliente

`frontend/tsconfig.json` es un fichero de solucion con referencias a los cuatro proyectos que genera
`nuxt prepare`, y sus `compilerOptions` no llegan a los proyectos referenciados. Las opciones que
faltaban respecto de `tsconfig.base.json` (`exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`,
`noImplicitReturns`) se inyectan desde `nuxt.config.ts`, en `typescript.tsConfig`. Verificado: aparecen
en `.nuxt/tsconfig.app.json` y `vue-tsc --build` las aplica. Quien necesite anadir otra opcion estricta
debe hacerlo ahi, no en `frontend/tsconfig.json`.

### F. El paquete `phaser` sale en su propio fragmento

`nuxt.config.ts` declara `manualChunks` como funcion, no como objeto, porque el empaquetador de Nuxt
4.5 es rolldown y su tipo solo admite funcion. Si un agente necesita mas fragmentos, se anaden a esa
funcion.

### G. Andamiajes de W1 que se sustituyen, no se amplian

`shared/index.ts`, `shared/__tests__/scaffolding.test.ts`, `frontend/app/app.vue`,
`frontend/app/pages/index.vue`, `frontend/app/__tests__/scaffolding.test.ts`,
`frontend/app/assets/tokens.css`, `backend/src/server.ts` y `backend/src/worker.ts` existen porque sin
ellos `tsc` falla por falta de entradas, `vitest` por falta de pruebas y `nuxt build` por falta de una
ruta. Cada uno lleva en cabecera el agente que lo sustituye.

`SHARED_CONTRACT_VERSION` en `shared/index.ts` no es un andamiaje: es el valor que el cliente compara
con el que el servidor publica en `world/info` para forzar una resincronizacion completa cuando el
contrato cambia de forma incompatible. W2 debe conservarlo.

## Resuelto

### 3. `/metrics` del worker

Aplicado por W3-A. `backend/src/worker.ts` abre un escuchador minimo con `/metrics` y `/health`.
Comprobado por W7-A contra el proceso arrancado: el escuchador responde 200 en el puerto que
`METRICS_PORT` fija, que desde esta ventana declara tambien `.env.example`.

El texto original de la nota:

Categoria: contrato
Ficheros afectados: `backend/src/worker.ts`
Propietario del cambio: W3-A
Motivo: `infra/prometheus/prometheus.yml` raspa `worker:9464/metrics` y los ficheros de Compose
inyectan `METRICS_PORT=9464`. El worker no tiene superficie HTTP propia, asi que debe abrir un
escuchador minimo unicamente para ese endpoint. Mientras no lo haga, el objetivo aparece como caido en
Prometheus, lo que es visible y correcto.

Mitigacion adoptada: el stub del worker registra el valor de `METRICS_PORT` recibido, de modo que la
variable esta verificada aunque no se use.

### 2. Salida del generador de Prisma

Aplicado por W2-D, que fijo la salida del generador en `backend/src/generated/prisma`. La optimizacion
de la etapa `runtime` de `backend/Dockerfile` que la nota describe como posible queda deliberadamente sin
aplicar: es tamano de imagen y no correccion, y la etapa actual es correcta en ambos casos
(`docs/handoff/INTEGRACION.md`, apartado 4).

El texto original de la nota:

Categoria: contrato
Ficheros afectados: `backend/prisma/schema.prisma` (bloque `generator`)
Propietario del cambio: W2
Motivo: la etapa `runtime` de `backend/Dockerfile` copia el `node_modules` completo de la etapa de
construccion, en lugar de hacer una instalacion de produccion aparte, precisamente porque el cliente
generado vive dentro de `node_modules` y una instalacion limpia no lo tendria. Si W2 fija la salida del
generador en una ruta bajo `src/` (por ejemplo `src/generated/prisma`), el cliente pasa a formar parte
de la salida de TypeScript y la etapa `runtime` puede reducirse a una instalacion sin dependencias de
desarrollo. Es una optimizacion de tamano de imagen, no un requisito.

Mitigacion adoptada: copia del arbol completo, que es correcta en ambos casos.

### 4. `restart` del servicio `worker` en desarrollo

Aplicado por W7-A (integracion). `docker-compose.yml` declara `restart: unless-stopped` en el servicio
`worker`, que desde W3 es un consumidor de larga vida con barrido de reconciliacion y apagado ordenado.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `docker-compose.yml`
Propietario del cambio: W7-A, a peticion de W3-A
Motivo: el stub de W1 registra una linea y termina, por lo que el servicio lleva `restart: "no"` para
no entrar en un ciclo de reinicios. Cuando W3 lo convierta en un consumidor de larga vida, la politica
debe volver a `unless-stopped`. Es un cambio de una linea, marcado con un comentario en el propio
fichero.

### 1. `backend/prisma/` no existe todavia

Aplicado por W2-D, que escribio `schema.prisma`, `prisma.config.ts`, `seed.ts` y la migracion inicial, y
por la ventana de parcheo de W2.5, que ejecuto `make generate`, `make migrate` y `make seed` contra la
pila de Compose. `make generate`, `make migrate`, `make migrate-dev`, `make reset` y `make seed`
funcionan. El texto original de la nota:

Categoria: orden que hay que ejecutar y contrato
Ficheros afectados: `backend/prisma/schema.prisma`, `backend/prisma.config.ts`, `backend/prisma/migrations/`, `backend/prisma/seed.ts`
Propietario del cambio: W2
Motivo: Prisma 7.9.1 esta declarado como dependencia e instalado, pero W1 no escribe el modelo de
datos. Hasta que exista el esquema:

- `make generate`, `make migrate`, `make migrate-dev`, `make reset` y `make seed` fallan.
- El trabajo `integration` de la integracion continua no puede quedar en verde. El trabajo `static`
  si, y es el que verifica esta fase.
- `backend/Dockerfile` genera el cliente solo si encuentra `prisma/schema.prisma`, de modo que la
  imagen se construye igualmente antes y despues de W2. La copia `COPY --from=build /app/prisma
  ./prisma` de la etapa `runtime` si exige que el directorio exista, es decir, la imagen de produccion
  no se puede construir hasta W2.

Mitigacion adoptada: el guardado condicional en el Dockerfile y mensajes explicativos en los objetivos
del `Makefile` que dependen de piezas aun no escritas.

### 6. `README.md` de la raiz

Aplicado por W2-E, que redacto el documento completo con arranque, estructura, indice de documentacion y
estado de implementacion. La ventana de parcheo de W2.5 actualizo su tabla de puertos, que quedo
desfasada al parametrizarlos. Su apartado 6, «Estado de implementacion», sigue caducando en cada fase;
esta anotado en `NOTES-w2-cierre.md`. El texto original de la nota:

Categoria: cambio en fichero congelado
Propietario del cambio: W7-A
Motivo: el fichero preexistente contiene solo el titulo. W1 le anadio el salto de linea final para que
`prettier --check` pase, y no toco el contenido porque la raiz documental del proyecto se redacta al
cierre, con el estado real. Debe describir el arranque (`make bootstrap`, `make up`, `make migrate`,
`make seed`) y remitir a `docs/`.

### Versiones ajustadas por restriccion de motor de Node

`testcontainers` fijado en 12.0.4 en lugar de 12.1.0, y `jsdom` en 29.1.1 en lugar de 30.0.1: ambas
versiones mas recientes exigen Node >= 22.22 y la maquina tiene 22.20.0. Registrado en ADR-0002 con la
tabla de desviaciones. Al actualizar Node, ambas pueden volver a la ultima sin otros cambios.

### `eslint-plugin-import` limita ESLint a la mayor 9

`eslint-plugin-import` 2.32.0 declara compatibilidad hasta ESLint 9, de modo que la raiz fija ESLint
9.39.5 y `@eslint/js` 9.39.5. Registrado en ADR-0002.
