# Registro de decisiones de arquitectura

Documento unico de ADR del proyecto. Recoge las decisiones de arquitectura con consecuencias
duraderas, en orden de adopcion y sin reescribir las anteriores: una decision superada se marca como
sustituida y se anade la nueva, de modo que el documento conserva el razonamiento historico y no solo
el estado final.

Reglas de escritura:

- Se anade siempre con `scripts/adr-append.mjs`, nunca editando a mano el final del fichero. El
  script comprueba que el numero no exista ya y que sea el siguiente de la serie, y actualiza el
  indice. Uso: `make adr FILE=<ruta>` o `node scripts/adr-append.mjs < entrada.md`.
- Un unico agente escribe en este fichero por fase (ver `docs/ownership.md`, apartado 3.3), porque los
  flujos de trabajo son secuenciales y asi nunca hay dos escritores concurrentes.
- Los estados admitidos son: Propuesta, Aceptada, Sustituida por ADR-NNNN, Revertida.
- Las contradicciones del material de partida no son ADR: viven en `docs/erratas-gdd-stack.md`. Aqui
  se registra unicamente la decision de arquitectura que provocan.

## Indice

| Numero | Titulo | Entrada |
|---|---|---|
<!-- adr-index:start -->
| ADR-0001 | npm sin workspaces y shared/ sincronizada | [Ver](#adr-0001--npm-sin-workspaces-y-shared-sincronizada) |
| ADR-0002 | Fijacion de versiones y desviaciones respecto al documento de stack | [Ver](#adr-0002--fijacion-de-versiones-y-desviaciones-respecto-al-documento-de-stack) |
| ADR-0003 | Un solo proyecto de backend con dos puntos de entrada | [Ver](#adr-0003--un-solo-proyecto-de-backend-con-dos-puntos-de-entrada) |
| ADR-0004 | Observabilidad desde el inicio con Prometheus y Grafana bajo perfil | [Ver](#adr-0004--observabilidad-desde-el-inicio-con-prometheus-y-grafana-bajo-perfil) |
| ADR-0005 | Propiedad exclusiva de directorios y registro con stubs | [Ver](#adr-0005--propiedad-exclusiva-de-directorios-y-registro-con-stubs) |
| ADR-0006 | Zod como esquema unico de API, tipos y formularios | [Ver](#adr-0006--zod-como-esquema-unico-de-api-tipos-y-formularios) |
| ADR-0007 | Tiempo de juego en enteros y ancla con multiplicador racional | [Ver](#adr-0007--tiempo-de-juego-en-enteros-y-ancla-con-multiplicador-racional) |
| ADR-0008 | Dinero en decimal exacto, modulo Money y serializacion como cadena | [Ver](#adr-0008--dinero-en-decimal-exacto-modulo-money-y-serializacion-como-cadena) |
| ADR-0009 | Ledger de asiento unico con secuencia, saldo resultante y referencia polimorfica | [Ver](#adr-0009--ledger-de-asiento-unico-con-secuencia-saldo-resultante-y-referencia-polimorfica) |
| ADR-0010 | Persistencia procedural: modificaciones de celda, version de chunk, version de generador | [Ver](#adr-0010--persistencia-procedural-modificaciones-de-celda-version-de-chunk-version-de-generador) |
| ADR-0011 | Catalogos de balance como constantes, no como tablas | [Ver](#adr-0011--catalogos-de-balance-como-constantes-no-como-tablas) |
| ADR-0012 | Escala del mundo: celda de 10 m, chunk de 320 m, 16 px por celda | [Ver](#adr-0012--escala-del-mundo-celda-de-10-m-chunk-de-320-m-16-px-por-celda) |
| ADR-0013 | Porcentajes en puntos base, cantidades fungibles enteras y habilidad escalar | [Ver](#adr-0013--porcentajes-en-puntos-base-cantidades-fungibles-enteras-y-habilidad-escalar) |
| ADR-0014 | Huecos numericos del GDD y valores inventados con su justificacion | [Ver](#adr-0014--huecos-numericos-del-gdd-y-valores-inventados-con-su-justificacion) |
<!-- adr-index:end -->

## Plantilla de entrada

Toda entrada nueva sigue esta forma. Los cinco encabezados de tercer nivel son obligatorios y el
script los verifica.

```markdown
## ADR-NNNN — Titulo breve en una linea

Fase: WN · Fecha: AAAA-MM-DD

### Estado

Aceptada.

### Contexto

Que problema existe, que restricciones lo acotan y que dice el material de partida al respecto, con
las referencias al GDD, al documento de stack o al plan.

### Decision

Que se decide, en presente y en una sola direccion. Sin condicionales.

### Consecuencias

Que se gana, que se pierde y que queda pendiente de vigilar. Incluye el coste asumido, no solo el
beneficio.

### Alternativas descartadas

Cada alternativa considerada y el motivo concreto del descarte.
```

<!-- adr-entries -->

---

## ADR-0001 — npm sin workspaces y shared/ sincronizada

Fase: W1 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El documento de stack se contradice sobre la gestion de dependencias: sus secciones 1, 5.3 y 7.4
describen npm sin workspaces, con un `package.json` por proyecto, mientras que su seccion 11 describe
un monorepo gestionado con pnpm workspaces. El usuario decidio npm sin workspaces durante la
planificacion.

La decision arrastra un problema real. El backend y el cliente necesitan compartir el catalogo de
balance, los esquemas de la API, la union de eventos de WebSocket y las reglas puras de dominio,
porque el resaltado verde de una seleccion en el cliente y el error 400 del servidor tienen que
proceder de la misma funcion. Sin workspaces no existe un paquete instalable entre proyectos. El
documento de stack, en su seccion 5.3, evalua dos opciones: una carpeta `shared/` versionada y
sincronizada por un script, o publicar un paquete privado en un registro propio.

El riesgo conocido de la primera opcion es la divergencia entre copias, y el propio documento de
stack lo admite: "implica que la sincronizacion no es automatica, hay que recordar ejecutar el target
tras editar shared/". Un contrato compartido que se olvida de sincronizar produce el peor tipo de
fallo: el cliente valida con una regla y el servidor con otra.

### Decision

Cuatro proyectos npm independientes, sin workspaces: la raiz, que declara unicamente las herramientas
de lint y formato; `shared/`; `backend/`; y `frontend/`.

`shared/` en la raiz del repositorio es la unica fuente de verdad. Se sincroniza hacia
`backend/src/shared` y `frontend/app/shared` con `scripts/sync-shared-types.sh`, y las dos copias
estan en `.gitignore`.

La divergencia se mitiga con tres medidas, no con disciplina:

1. `sync-types` es prerrequisito de los objetivos `dev`, `build`, `test` y `lint` del `Makefile`, de
   modo que no existe un camino habitual que use una copia obsoleta.
2. `scripts/check-shared-sync.sh` compara por contenido y devuelve un codigo distinto de cero si
   alguna copia difiere del origen. La integracion continua lo ejecuta, con lo que una copia editada a
   mano no puede fusionarse.
3. Las pruebas de las reglas compartidas se ejecutan solo sobre el origen. El script excluye
   `__tests__/` y los ficheros de prueba de las copias, de modo que no existe la posibilidad de que
   una suite verde este validando una copia y no la fuente.

Las reglas de zona de `eslint.config.js` completan la medida: el backend y el cliente no pueden
importar de `shared/` en la raiz, solo de su copia, y `shared/` no puede importar de ninguno de los
dos.

### Consecuencias

Se gana simplicidad operativa: cuatro `npm install` independientes, sin resolutor de workspace, sin
enlaces simbolicos y sin registro propio que mantener. Un desarrollador nuevo entiende el arbol de
dependencias leyendo un `package.json`.

Se pierde la deteccion inmediata de un cambio en `shared/`: hay que ejecutar la sincronizacion, y
aunque este encadenada en los objetivos habituales, un agente que ejecute `npx tsc --noEmit`
directamente puede estar comprobando una copia antigua.

Se paga tambien en almacenamiento y en tiempo de instalacion: `zod` y `typescript` se instalan cuatro
veces. Es un coste aceptado a cambio de que cada proyecto pueda evolucionar su version sin arrastrar
a los demas.

Queda por vigilar: si la sincronizacion olvidada se convierte en una fuente frecuente de errores, la
evolucion natural es la opcion B del documento de stack (registro propio tipo Verdaccio como un
contenedor mas), que no exige cambiar de lenguaje ni de herramienta.

### Alternativas descartadas

Monorepo con pnpm workspaces, como propone la seccion 11 del documento de stack: descartada por
decision explicita del usuario. Habria eliminado el problema de la divergencia de raiz, a cambio de
un gestor de paquetes adicional y de un modelo de resolucion que el equipo tendria que razonar en cada
incidencia.

npm workspaces: mantiene npm pero introduce el `node_modules` compartido y el izado de dependencias,
que es precisamente la parte que la decision del usuario evita.

Paquete privado en un registro propio: correcto tecnicamente, pero anade un servicio mas que operar y
un ciclo de publicacion entre editar una regla y poder usarla, lo que en un equipo de una a tres
personas frena mas de lo que protege.

Importar `shared/` por ruta relativa desde ambos proyectos, sin copiar: descartada porque saca
ficheros fuera de la raiz de cada proyecto de TypeScript y del contexto de construccion de cada imagen
de Docker, lo que rompe tanto la compilacion incremental como la construccion de imagenes.

---

## ADR-0002 — Fijacion de versiones y desviaciones respecto al documento de stack

Fase: W1 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El documento de stack nombra tecnologias sin fijar versiones. Un proyecto que se implementa mediante
varios agentes en paralelo no puede permitirse que cada uno resuelva una version distinta: el
`package-lock.json` es un fichero compartido por naturaleza y se congela en la primera fase.

Ademas, algunas mayores recientes del ecosistema son reescrituras con riesgo propio que no aporta nada
al alcance del MVP, y otras estan consolidadas. La eleccion no puede ser "la ultima de todo".

Todas las versiones se verificaron contra el registro npm antes de escribirlas.

### Decision

Se fijan versiones exactas, sin rangos, en los tres proyectos de ejecucion. Criterio:

- Ultima mayor donde el ecosistema esta consolidado: Nuxt 4.5.2, Vue 3.5.41, Pinia 4.0.2 con
  `@pinia/nuxt` 1.0.1, Fastify 5.11.3, Zod 4.4.3, Vitest 4.1.10, Prisma 7.9.1.
- Mayor anterior donde la nueva es una reescritura reciente: Phaser 3.90.0 en lugar de 4.x, y BullMQ
  5.81.3 con ioredis 5.11.1 en lugar de BullMQ 6, que acaba de convertir el backend de Redis en peer
  opcional junto a PostgreSQL.
- TypeScript 5.9.3 en lugar de 7.x: el compilador nativo no aporta nada en este alcance y si
  incorporaria diferencias de comportamiento que habria que perseguir.
- Node 22, fijado en `.nvmrc`.

Las herramientas de lint y formato de la raiz se declaran tambien con version exacta: ESLint 9.39.5,
`typescript-eslint` 8.67.0, `eslint-plugin-import` 2.32.0, `eslint-import-resolver-typescript` 4.4.5,
`eslint-plugin-vue` 10.10.0, `vue-eslint-parser` 10.4.1 y Prettier 3.9.6.

Desviaciones respecto de las versiones previstas en el plan, cada una con su motivo:

| Paquete | Previsto | Fijado | Motivo |
|---|---|---|---|
| ESLint | ultima | 9.39.5 | `eslint-plugin-import` 2.32.0 declara compatibilidad hasta ESLint 9. ESLint 10 producia un conflicto real de dependencia entre pares, y el plan exige ese plugin por sus reglas de zona |
| `testcontainers` | ultima (12.1.0) | 12.0.4 | 12.1.0 exige Node >= 22.22 y la maquina de desarrollo tiene 22.20.0. 12.0.4 es la version mas cercana sin restriccion de motor |
| `jsdom` | ultima (30.0.1) | 29.1.1 | 30.x exige Node >= 22.22.2 por el mismo motivo. 29.1.1 admite ^22.13.0 |

Adiciones respecto de la lista del plan, todas obligadas por una dependencia entre pares o por un
fichero congelado que las invoca: `openapi-types` 12.1.3 (par requerido por
`fastify-type-provider-zod` 7.0.0), `@fastify/cors` 11.3.0, `@types/node` en el cliente (par de Nuxt y
necesario para la configuracion) y `@vitejs/plugin-vue` 6.0.8 (necesario para montar componentes de
un solo fichero en las pruebas).

### Consecuencias

La instalacion es reproducible y todos los agentes trabajan contra las mismas firmas de tipos. Un
`npm install` en una fase posterior no puede introducir un cambio de comportamiento por resolucion de
rango.

El coste es que actualizar exige una decision explicita y un cambio en un fichero congelado, es decir,
pasa por el agente de integracion. Es el comportamiento buscado.

Las dos desviaciones por restriccion de motor son un aviso: la maquina de desarrollo lleva Node
22.20.0 y el ecosistema ya publica paquetes que exigen 22.22. Al actualizar Node, ambas versiones
pueden volver a la ultima sin mas cambios.

Prisma 7.9.1 se inicializara con su andamiaje oficial en la fase W2 y se adaptara al contrato real del
generador en lugar de escribir la configuracion de memoria. Si aparece friccion, el retroceso a 6.19.3
se documenta como sustitucion de esta entrada.

### Alternativas descartadas

Rangos con caret: descartados porque el objetivo del bloqueo es que cuatro proyectos y siete fases
compartan exactamente las mismas firmas. Con caret, la fecha de instalacion pasa a formar parte del
comportamiento del sistema.

Mantener ESLint 10 y sustituir `eslint-plugin-import` por `eslint-plugin-import-x`: viable, pero
cambia el plugin que el plan nombra y con el la sintaxis de las reglas de zona, que son el mecanismo
que hace segura la paralelizacion. No es el momento de tocar esa pieza.

Actualizar Node en la maquina para poder usar `testcontainers` 12.1.0 y `jsdom` 30: fuera del ambito
de esta fase, que no administra el entorno del usuario.

Phaser 4.x: descartada. El renderizado por niveles de detalle del plan depende de comportamientos
concretos de `Tilemap`, de la generacion de texturas por codigo y del filtrado nearest, y una
reescritura reciente del motor convierte cada uno de esos puntos en una incognita sin aportar nada al
alcance.

---

## ADR-0003 — Un solo proyecto de backend con dos puntos de entrada

Fase: W1 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El documento de stack se contradice: su seccion 11 declara `apps/worker/` como paquete propio del
monorepo, mientras que su seccion 7.1 describe el servicio `worker-simulation` como "mismo codigo que
backend, proceso BullMQ worker separado" y justifica la separacion en terminos de contenedores, no de
paquetes.

El motivo de la separacion, tal como el propio documento lo argumenta, es poder escalar la simulacion
independientemente del trafico HTTP sin refactorizar. Ese motivo se satisface con dos procesos; no
exige dos proyectos.

Hay ademas una razon de correccion. El plan establece que todos los efectos de simulacion se aplican
en `advancePlayer`, y que ese punto lo invocan tanto el manejador de la cola como el envoltorio de
todo endpoint mutante. Si el worker fuera un proyecto aparte, esa funcion tendria que vivir en un
tercer lugar compartido, o duplicarse. Duplicada, la primera peticion de un jugador y el trabajo
agendado podrian dejar de coincidir, que es exactamente el fallo que el diseno de tres capas de
idempotencia pretende hacer imposible.

### Decision

Un unico proyecto `backend/` con dos puntos de entrada: `src/server.ts`, que construye la instancia de
Fastify y escucha, y `src/worker.ts`, que consume las colas de BullMQ.

Una unica imagen de Docker, construida desde `backend/Dockerfile`. Los servicios `backend` y `worker`
de los ficheros de Compose comparten imagen, variables y arbol de dependencias, y se distinguen
unicamente por `command`.

El esquema de Prisma vive en `backend/prisma/`, resolviendo la segunda contradiccion del documento de
stack sobre su ubicacion.

### Consecuencias

`advancePlayer`, el ledger, el reloj de juego y los adaptadores de cola existen una sola vez. Un
cambio en la politica de deuda o en el orden canonico de bloqueos afecta a los dos procesos por
construccion, sin coordinacion.

La puerta a extraer la simulacion como servicio independiente sigue abierta y sin coste: ya son dos
procesos con su propio ciclo de vida, sus propias metricas y su propio escalado. Lo que queda por
hacer ese dia es separar el proyecto, no rediseniar el sistema.

El coste es que el worker arrastra las dependencias HTTP y el servidor arrastra las de la cola. En un
proceso de Node eso es memoria residente que no se usa, no tiempo de ejecucion, y a cambio se elimina
un artefacto de construccion y un tercer paquete compartido.

Consecuencia operativa a vigilar: como comparten imagen, una reconstruccion afecta a los dos
servicios a la vez, de modo que un despliegue no puede actualizar solo el worker. Con replica unica en
el MVP no tiene efecto practico.

Durante la fase W1 el worker es un stub que registra una linea y termina, por lo que su servicio de
desarrollo lleva `restart: "no"`. La fase W3 lo convierte en un proceso de larga vida y devuelve esa
politica a `unless-stopped`.

### Alternativas descartadas

Dos paquetes npm, `backend/` y `worker/`, como propone la seccion 11 del documento de stack: obligaria
a un tercer paquete con el nucleo de simulacion, o a duplicar el punto unico de avance. El coste de
coordinacion supera con claridad al beneficio.

Un solo proceso que sirva HTTP y consuma colas: mas simple todavia, pero un lote de eventos vencidos
competiria por el bucle de eventos con las peticiones del jugador, y una caida del proceso detendria
la simulacion de todos. La separacion en dos contenedores es, como dice el documento de stack, barata
ahora y cara despues.

---

## ADR-0004 — Observabilidad desde el inicio con Prometheus y Grafana bajo perfil

Fase: W1 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El documento de stack se contradice cuatro veces sobre observabilidad. Su seccion 1 la declara "stack
fijo desde el inicio" y su seccion 7.1 dibuja Prometheus y Grafana en la topologia; su seccion 10 los
aplaza a una fase 2 y su seccion 14 los excluye explicitamente del MVP tecnico, con un argumento
concreto: "el coste de mantenimiento de esa infraestructura compite directamente con tiempo de
desarrollo del juego".

Las dos posturas son razonables porque hablan de cosas distintas. Instrumentar el codigo es una
decision de diseno con coste casi nulo si se toma al principio y coste alto si se retrasa. Operar dos
contenedores mas, con sus volumenes, sus paneles y sus actualizaciones, es una carga continua.

Este proyecto tiene ademas una razon propia para instrumentar pronto: la simulacion ocurre sin el
jugador delante. Un retraso en la cola, un trabajo que se reintenta indefinidamente o una liquidacion
que no corre son fallos silenciosos, y en un juego idle un socket muerto es indistinguible de que no
este pasando nada.

### Decision

Se separan las dos mitades.

Forman parte del servicio y estan presentes siempre: registro estructurado con Pino, el endpoint
`/health` que usan los healthchecks de Docker y Caddy, y el endpoint `/metrics` con `prom-client`. El
worker expone su propio `/metrics` en `METRICS_PORT`, porque no tiene superficie HTTP propia.

Prometheus y Grafana viven en `docker-compose.obs.yml` bajo el perfil `obs`, que no se levanta con la
pila de desarrollo. Se activan con `make obs-up`. `infra/prometheus/prometheus.yml` declara ya los dos
objetivos de raspado, backend y worker.

No se incorpora Loki. La agregacion centralizada de registros es la pieza cuyo coste de mantenimiento
menos se justifica con un solo host, y `docker logs` con rotacion configurada cubre el caso.

### Consecuencias

El coste de mantenimiento que la seccion 14 del documento de stack considera injustificado no se
paga hasta que alguien decide pagarlo, y ese dia no hay que instrumentar nada: las metricas ya estan
publicadas y el fichero de raspado ya apunta a ellas.

Los endpoints `/health` y `/metrics` quedan como contrato desde la primera fase. `/health` es
consumido por los healthchecks de los dos ficheros de Compose, de modo que su forma no puede cambiar
sin tocar ficheros congelados.

Se asume una consecuencia menor: con el perfil `obs` levantado y el worker todavia como stub, su
objetivo de raspado aparece como caido. Es visible y correcto, no un fallo.

Queda por definir en la fase W3 el conjunto minimo de metricas con significado de dominio: trabajos
procesados y fallidos por tipo, retraso entre `dueGameMs` y la ejecucion real, conexiones de WebSocket
activas y numero de resincronizaciones por instantanea. Publicar solo metricas de proceso convertiria
esta decision en un gesto vacio.

### Alternativas descartadas

Montar Prometheus y Grafana en la pila de desarrollo por defecto, como sugieren las secciones 1 y 7.1:
dos contenedores mas en el arranque habitual, con su consumo de memoria, para observar un sistema que
durante la mayor parte del desarrollo se depura leyendo registros.

Aplazar tambien `/metrics` a una fase 2, como sugieren las secciones 10 y 14: instrumentar despues
obliga a recorrer todos los caminos criticos ya escritos, que es cuando se olvidan la mitad. El coste
de `prom-client` en el arranque es despreciable.

Incluir Loki: descartado por la razon que el propio documento de stack da para el resto del bloque, y
que aqui si aplica sin matices.

---

## ADR-0005 — Propiedad exclusiva de directorios y registro con stubs

Fase: W1 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El proyecto se implementa mediante siete flujos de trabajo secuenciales con entre uno y seis agentes
cada uno, que trabajan a la vez y no se coordinan entre si durante la fase. En ese modo de trabajo,
dos agentes que escriben el mismo fichero no producen un conflicto que alguien resuelva luego:
producen trabajo perdido, porque el segundo sobrescribe al primero sin saberlo.

Hay dos patrones que fallan de forma sistematica. El primero es el registro por anadido: varios
agentes anaden su entrada al mismo indice de rutas o de paneles, y el ultimo en escribir borra a los
demas. El segundo es la importacion entre modulos hermanos escritos en paralelo: el modulo A importa
de B una funcion que B todavia no tiene, o que tendra con otra firma.

### Decision

Cinco reglas, recogidas en `docs/ownership.md` con la tabla completa de ruta, agente y fase:

1. Un directorio, un dueno, una fase. Cada ruta aparece exactamente una vez en la tabla. Un agente
   escribe solo dentro de la suya.
2. Los ficheros compartidos por naturaleza se escriben completos en los dos primeros flujos, para el
   conjunto final de funcionalidades, y quedan congelados: `Makefile`, los ficheros de Compose, los
   `Caddyfile`, todos los `package.json` y `package-lock.json`, los `tsconfig`, `eslint.config.js`,
   `schema.prisma`, `app.ts` y el registro de paneles.
3. Registro con stubs, nunca registro por anadido. Quien escribe un registro crea tambien los modulos
   que importa, con su ruta y su firma definitivas; el agente posterior sustituye el stub en su sitio.
4. Ninguna importacion entre modulos hermanos de la misma fase, comprobada con reglas de zona de
   ESLint (`import/no-restricted-paths`), de modo que la violacion falla en `make lint` y no en la
   integracion.
5. Ningun agente ejecuta ordenes que muten el repositorio. Lo que necesite fuera de su ambito lo
   escribe en `docs/handoff/NOTES-<agente>.md`, un fichero por agente, que no puede colisionar.

Las zonas declaradas en `eslint.config.js` cubren los once modulos previstos del backend, incluidos
los que aun no existen, y ademas prohiben que `backend/` y `frontend/` importen de `shared/` en la
raiz en lugar de su copia sincronizada, que `shared/` dependa de cualquiera de los dos, que
`backend/src/lib` conozca los modulos de dominio, y que las escenas de Phaser importen los stores de
Pinia.

### Consecuencias

La paralelizacion deja de depender de la disciplina y pasa a depender de una comprobacion ejecutable.
Una violacion de la regla 4 aparece como error de `make lint`, con la ruta, la linea y el motivo.

El coste esta en la regla 2: los ficheros congelados se escriben en la primera fase para
funcionalidades que aun no existen, es decir, se declaran dependencias que nadie usa todavia y
objetivos de `Makefile` que fallan con un mensaje explicativo hasta que su propietario llega. Es
deliberado: un `package-lock.json` reescrito en la fase W5 invalidaria el trabajo de cinco agentes.

Segundo coste: la tabla de propiedad hay que mantenerla cuadrada con el arbol real. El apartado 4 de
`docs/ownership.md` recoge las diferencias entre el arbol previsto en el plan y el implementado, con
el motivo de cada una.

Se asume una limitacion conocida: las reglas de zona se apoyan en el resolutor de TypeScript, porque
los proyectos usan `NodeNext` y los especificadores llevan extension `.js`, que solo ese resolutor
sabe mapear al fichero `.ts`. Si el resolutor no puede resolver un especificador, la regla no se
dispara. Por eso se verifico empiricamente, con ficheros que violan cada zona, que las reglas informan
del error, y con ficheros que respetan las direcciones permitidas, que no producen falsos positivos.

### Alternativas descartadas

Un agente por fase, sin paralelismo: elimina el problema y multiplica el tiempo. Se aplica solo donde
la coherencia importa mas que la velocidad, es decir en W1 y en W2, que producen el contrato que leen
todos los demas.

Ramas por agente y fusion al cierre de cada fase: traslada el problema a un conflicto de fusion sobre
ficheros que ningun agente puede resolver sin ver el trabajo de los otros. Sobre un indice de rutas,
el conflicto es exactamente igual de destructivo y ademas mas tardio.

Convencion documentada sin comprobacion automatica: es la variante que falla en silencio. Una regla
que no rompe la compilacion se incumple en la tercera fase y se descubre en la septima.

---

## ADR-0006 — Zod como esquema unico de API, tipos y formularios

Fase: W2 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El documento de stack admite TypeBox y Zod indistintamente en su seccion 2.4, y recomienda
`fastify-type-provider-typebox` en su seccion 2.2. No fija ninguna de las dos.

El proyecto tiene tres consumidores del mismo contrato y no dos. El servidor valida la peticion
entrante, el cliente necesita el tipo de la respuesta para su almacen normalizado, y los formularios de
Vue validan antes de enviar para no gastar un viaje de ida y vuelta en un campo vacio. Escribir la misma
regla tres veces es la forma habitual de que el resaltado verde de una seleccion y el error 400 dejen de
coincidir.

Hay ademas un cuarto consumidor que el plan exige en su seccion 9: un servidor simulado con el que
desarrollar los paneles sin la pila levantada. Un servidor simulado que no derive de los mismos esquemas
no simula el contrato, simula lo que su autor recordaba del contrato.

### Decision

Zod 4.4.3 como unico lenguaje de esquema, con `fastify-type-provider-zod` 7.0.0 en el servidor.

El artefacto central no son los esquemas sueltos sino `shared/api/routes.ts`: un mapa tipado de 55 rutas
en 12 areas, con clave `METODO /ruta`, que es exactamente lo que identifica una ruta HTTP y por tanto no
admite colision ni consulta ambigua. De ese mapa derivan cuatro cosas que de otro modo se escribirian
cuatro veces: el registro en Fastify, el cliente tipado del frontend, el servidor simulado y la
documentacion OpenAPI de `/docs`.

Las reglas transversales del plan se expresan como banderas del mapa y se comprueban con pruebas de
invariante, no por convencion. Son seis: `requiresAuth`, `advancesPlayer`, `sequenced`, `movesMoney`,
`requiresIdempotencyKey` y `devOnly`. Dos invariantes comprobadas por prueba, no confiadas al revisor:
`requiresIdempotencyKey` vale exactamente lo que vale `movesMoney`, y toda ruta `sequenced` responde con
`mutationReplySchema` y declara los tipos de evento que puede producir. Hoy: 22 rutas secuenciadas, 8 con
clave de idempotencia y 4 de desarrollo.

Cuatro precisiones adicionales que la implementacion obligo a fijar:

1. Todo objeto del contrato es estricto. Descartar en silencio una clave desconocida convierte un campo
   renombrado en un valor por omision, que es el fallo que no aparece en ninguna prueba.
2. Los tipos marcados de `shared/domain/` no cruzan el cable. Un esquema Zod no puede producir un tipo
   marcado sin una transformacion, y una transformacion haria diferir el tipo de entrada y el de salida
   del mismo campo, lo que rompe la simetria de la que dependen el servidor simulado y las pruebas de
   contrato. La frontera convierte explicitamente con `toWireMoney`, `fromWireMoney`, `toWireGameMs`,
   `fromWireGameMs`, `toWireRealMs` y `fromWireRealMs`.
3. La union discriminada de eventos de WebSocket se escribe miembro a miembro y no se genera de una
   tabla: una union generada pierde en el nivel de tipos la correlacion entre etiqueta y contenido, y esa
   correlacion es lo que permite al reductor del cliente conmutar sobre `type` sin conversiones.
4. Un solo campo `code` en el cuerpo de error, con dos familias de valores: las reglas del dominio
   (`ValidationCode`, en `shared/domain/enums.ts`) y los fallos de transporte (`ApiTransportCode`, once
   valores en `shared/api/errors.ts`). La correspondencia con codigos HTTP es una tabla exhaustiva, y el
   cliente ramifica por codigo y nunca por estado HTTP.

La respuesta de una ruta mutante es `{ seq, atGameMs, result }`, donde `result` lleva el estado nuevo y
completo de todas las entidades que la mutacion toco, con los mismos modelos de lectura que llevan los
eventos. No lleva la lista de sobres de WebSocket que la mutacion produjo, que era la lectura literal de
la seccion 7 del plan: esa lectura cierra un ciclo de importacion inevitable, porque los sobres llevan
los modelos de lectura que define `shared/api/schemas/` y por tanto `api` importaria `ws` y `ws`
importaria `api`.

### Consecuencias

Una regla de forma se escribe una vez. Anadir un campo obligatorio a una peticion rompe la compilacion
del cliente, del servidor simulado y de las pruebas de contrato a la vez, que es el comportamiento
buscado.

Como toda entidad de `result` es un reemplazo completo y no un delta, aplicar la respuesta y descartar
despues el eco por WebSocket converge al mismo estado que el orden inverso. Esto tiene una consecuencia
concreta para el cliente: el reductor necesita una funcion por porcion de estado (`applyPlayer`,
`applyField`, y asi) y exactamente dos puntos de entrada que las usan, uno para el sobre de WebSocket y
otro para el `result` de una respuesta mutante. No hay una tercera via, y esa es la propiedad que hace
innecesario razonar sobre el orden de llegada.

Coste asumido: la conversion en la frontera es manual y visible. `Money` es un subtipo de `string`, asi
que un valor `Money` se asigna a un campo de respuesta sin conversion y el olvido no se detecta; `GameMs`
es un `bigint` y no es asignable, de modo que ahi la llamada al conversor es obligatoria. La asimetria es
conocida y esta documentada en `shared/api/README.md`.

Queda por vigilar: `ValidationCode` no cubria los fallos de autenticacion ni de transporte, y la solucion
adoptada fue declarar `ApiTransportCode` como segundo conjunto cerrado en lugar de ampliar el primero,
porque `shared/domain/` estaba fuera del ambito del agente del contrato. Si se decide unificarlos, el
modulo conserva su forma y `API_TRANSPORT_CODES` queda vacio sin que ningun consumidor cambie, porque
todos leen `ApiErrorCode`, `API_ERROR_MESSAGES` y `API_ERROR_HTTP_STATUS`.

### Alternativas descartadas

TypeBox con `fastify-type-provider-typebox`, que es lo que recomienda la seccion 2.2 del documento de
stack: produce JSON Schema, que es lo que Fastify valida de forma nativa y por tanto es la opcion mas
rapida en el servidor. Se descarta porque su superficie de validacion refinada es notablemente mas pobre
y porque el mismo esquema tendria que reescribirse para validar un formulario en el cliente. El coste de
validacion no esta en el camino critico de un juego idle con baja frecuencia de eventos por jugador.

Esquemas por ruta sin mapa central: cada modulo declara sus propias rutas en su propio registro. Es la
forma habitual en Fastify, y se descarta por la regla 3 de la seccion 11 del plan: un registro que crece
por anadido es el conflicto clasico del trabajo en paralelo, y sin mapa central no hay donde comprobar
las invariantes transversales.

Generar la union de eventos desde una tabla de pares etiqueta-esquema: mas corto de escribir y pierde la
correlacion de tipos, que es justamente lo que se queria.

Devolver en la respuesta mutante la lista de sobres producidos: descartada por el ciclo de importacion
descrito arriba. La alternativa habria sido mover los modelos de lectura a un tercer directorio, es decir
resolver un ciclo creando un paquete intermedio que solo existe para romperlo.

---

## ADR-0007 — Tiempo de juego en enteros y ancla con multiplicador racional

Fase: W2 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El GDD fija en su seccion 51 un multiplicador de tiempo configurable en el servidor, y en su seccion 52
que la simulacion continua con el jugador desconectado. El documento de stack, en su seccion 4.3, deriva
el retardo real de un trabajo dividiendo la duracion en horas de juego por el multiplicador.

Todo coste del GDD esta expresado por hora de juego: 12 y 25 $/h de mantenimiento y 22 y 60 $/h de
operacion en la seccion 89, la suma horaria de la seccion 107, y 30 y 70 $/h de la maquinaria forestal en
la seccion 134. Si el multiplicador entra en la aritmetica economica, cambiarlo reinterpreta el pasado.

El problema concreto es que el multiplicador es una decision de operacion, no una constante: la seccion
120 del GDD lo propone como palanca de balance y la prueba de humo del plan lo lleva a un extremo, una
hora de juego cada diez milisegundos, para completar el ciclo de 325 horas de la seccion 118 en unos
quince segundos. Un sistema que almacene instantes reales y derive de ellos el tiempo de juego produce
resultados distintos segun cuando se haga la lectura.

### Decision

Todo instante con significado de simulacion o economico se almacena como `gameMs`, un `bigint`. Los
instantes reales se almacenan solo para trazas, en columnas con el sufijo `RealMs`, y no se deriva nunca
tiempo de juego de un instante real almacenado. Con esta regla el multiplicador desaparece de la
aritmetica economica y los intervalos siguen siendo exactos aunque cambie.

El mundo guarda un ancla con multiplicador racional (`anchorRealMs`, `anchorGameMs`, `rateNum`,
`rateDen`), no un factor en coma flotante, para que la conversion sea invertible sin error:

```text
gameMsAt(w, realMs)  = w.anchorGameMs + floorDiv((realMs - w.anchorRealMs) x w.rateNum, w.rateDen)
realMsFor(w, gameMs) = w.rateNum === 0 ? null
                     : w.anchorRealMs + ceilDiv((gameMs - w.anchorGameMs) x w.rateDen, w.rateNum)
```

`floorDiv` da monotonia y `ceilDiv` da ausencia de disparo temprano. Ambas propiedades estan demostradas
con `fast-check` sobre el espacio de anclas, incluida `gameMsAt(realMsFor(g)) >= g`.

Tres decisiones de contorno que la implementacion obligo a fijar:

1. `rateNum = 0` es mundo pausado, y `realMsFor` devuelve nulo. Es la unica mitigacion admisible para una
   caida prolongada: el reloj nunca se rebobina, y una incidencia se compensa con un asiento contable, no
   con tiempo.
2. Un ancla con numerador negativo o denominador no positivo se rechaza con excepcion, no se normaliza.
   Es dato corrupto y no un caso limite del dominio, y tratarlo como caso limite lo propagaria.
3. Cambiar el multiplicador es una operacion de dominio, `retimeWorld`, y no una actualizacion de
   configuracion: congela el pasado con el multiplicador anterior en `WorldTimeSegment`, re-ancla,
   incrementa `scheduleEpoch` y reprograma los trabajos del horizonte. Un disparador de la base de datos,
   `worlds_retime_guard`, rechaza cualquier cambio de multiplicador sin re-anclaje y cualquier reloj que
   retroceda.

El reloj de un mundo nuevo no se ancla en cero, sino en 960 horas de juego. No es un valor inventado: es
`PINE.stageStartGameHours.OLD_GROWTH + NATURAL_FOREST.oldGrowthAgeSpanGameHours`. Un bosque comprado llega
ya poblado (GDD secciones 130 y 141) y el arbol mas viejo que el generador puede extraer tiene esa edad;
con el mundo anclado en cero ese arbol necesitaria un instante de plantacion negativo, que el dominio
prohibe porque `gameMs` rechaza valores negativos.

El reloj se lee una sola vez por peticion o por trabajo y se propaga como contexto inyectable. No hay
`Date.now()` en ninguna funcion de dominio.

### Consecuencias

El coste de una ventana temporal es el mismo antes y despues de un cambio de multiplicador, y el informe
de balance es reproducible sin fijar la hora del reloj de pared.

La conversion es exacta y sin acumulacion de error: dos lecturas del mismo instante real dan el mismo
instante de juego, propiedad de la que dependen la clave de idempotencia de los devengos y la
recomputabilidad del ledger.

El coste esta en la ergonomia. Un `bigint` no admite los operadores aritmeticos mezclado con `number`, de
modo que toda la superficie de tiempo obliga a conversiones explicitas, y las duraciones del catalogo,
que estan en horas de juego con decimales, viven como `GameHours` sobre `number` y se convierten. La
separacion entre instante (`GameMs`, no negativo) e intervalo transcurrido (`bigint` a secas, que si puede
ser negativo) es deliberada y hay que respetarla: los constructores lanzan `RangeError`.

Queda pendiente un cambio en fichero congelado: el ancla inicial de 960 horas se deriva hoy en
`backend/prisma/seed.ts` y le corresponde estar en `shared/config/time.ts` como
`INITIAL_ANCHOR_GAME_MS`, porque la necesitan tambien el generador de bosque y las pruebas de propiedad
del reloj. Anotado en `docs/handoff/NOTES-w2d.md`, apartado 8.

### Alternativas descartadas

Multiplicador como numero en coma flotante: la conversion deja de ser invertible y `realMsFor(gameMsAt(t))`
deja de devolver `t`, lo que hace que un trabajo agendado pueda dispararse un milisegundo antes de su
vencimiento y que la guarda de vencimiento lo reencole en bucle.

Almacenar instantes reales y derivar el tiempo de juego en cada lectura: es la lectura literal de la
seccion 4.3 del documento de stack. Se descarta porque un cambio de multiplicador reinterpretaria todo el
pasado, y porque `lastSimulationTimestamp` de la seccion 52 del GDD pasaria a ser una marca cuyo
significado depende de la configuracion vigente.

Rebobinar el reloj tras una caida del worker, para que ningun jugador pierda tiempo: destruye la
monotonia, en la que se apoyan la actualizacion condicional de `lastAccrualGameMs` y la unicidad de las
claves de devengo. La pausa mas un asiento compensatorio consigue el mismo efecto sin tocar el eje del
tiempo.

Un unico reloj global sin ancla persistida, calculado desde el arranque del proceso: un reinicio del
contenedor reiniciaria el tiempo de juego, que es exactamente el fallo que la persistencia procedural
del GDD seccion 58 y la simulacion offline de la seccion 52 no toleran.

---

## ADR-0008 — Dinero en decimal exacto, modulo Money y serializacion como cadena

Fase: W2 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El GDD publica importes con dos decimales como maximo (0,22 $/litro en su seccion 82, 45 $/m3 en la 133) y
el resto en unidades enteras. La aritmetica, en cambio, no se queda en dos decimales: la seccion 107 exige
sumar tasas por hora de juego y la seccion 124 integrarlas sobre el intervalo transcurrido, y esos
intervalos no son horas enteras. Las duraciones reales del ciclo minimo son 70,0280, 61,2745 y 98,0392
horas.

El plan, en su seccion 6.2, prohibe explicitamente llevar el dinero en centimos enteros: la liquidacion es
muy frecuente por diseno, porque todo camino de escritura liquida devengos, y redondear en cada
liquidacion acumula un sesgo sistematico a favor del jugador. Con coma flotante binaria el problema es
distinto y peor: 0,22 no es representable, de modo que la suma de importes depende de su orden y el ledger
deja de ser auditable.

### Decision

El dinero es un decimal exacto de cuatro decimales. En PostgreSQL es `numeric(20,4)`; en TypeScript es el
tipo marcado `Money`, que es un subtipo de `string` cuya representacion canonica lleva siempre exactamente
cuatro decimales (`'160000.0000'`).

La aritmetica vive en un unico modulo, `shared/domain/money.ts`, sobre un `bigint` interno escalado por
10.000, sin dependencia externa. La coma flotante no sostiene nunca un importe. El tipo y el espacio de
nombres comparten el nombre `Money`, de modo que ambos se exportan del mismo modulo; por eso el tipo no
vive en `units.ts` con el resto de las primitivas marcadas, y `units.ts` documenta la razon en su
cabecera.

Como ese modulo es el unico que construye un valor `Money`, la forma canonica esta garantizada y la
igualdad de dos importes es igualdad de cadenas. El redondeo, alli donde una division es inevitable, es
mitad hacia el infinito en valor absoluto sobre la cuarta decimal, es decir una centesima de centimo por
operacion. `toDisplay`, de dos decimales, existe solo para la interfaz: el servidor nunca devuelve un
importe ya formateado.

El camino de devengo tiene dos variantes y la eleccion no es libre. `mulGameMs` multiplica una tasa por
hora de juego por un intervalo en milisegundos de juego y es exacta, porque la division por
`MS_PER_GAME_HOUR` se hace sobre enteros. `mulHours` acepta un intervalo en horas con decimales y tiene
precision de 10^-6 horas. El devengo usa la primera; la segunda queda para presupuestos y previsiones.

La acumulacion de devengos va un paso mas alla. `accrueContinuousCostsExact` devuelve las cuatro
integrales en unidades de dinero escalado por milisegundo de juego, como `bigint`, y
`accrueContinuousCosts` divide por los milisegundos de una hora de juego una unica vez por categoria. Con
eso, `AccrualBreakdown.total` es la suma de las cuatro categorias ya redondeadas y no el redondeo de la
suma exacta, deliberadamente: el ledger escribe un asiento por categoria y `balanceAfter` tiene que
cuadrar con la suma de los asientos que escribio.

En el cable, un importe viaja como cadena decimal. El tipo marcado no cruza la frontera: el campo del
esquema es `string` con patron, y la conversion es explicita en los dos sentidos. No se parchea la
serializacion de forma global; cada endpoint mapea.

### Consecuencias

El ledger es auto-auditable con una prueba ejecutable: la suma de los asientos es exactamente igual al
saldo, sin tolerancia. Recalcular el coste historico desde cero y compararlo con lo escrito es una
comparacion de igualdad y no de cercania.

La propiedad de aditividad que la seccion 8 del plan pide demostrar,
`settle(a,c) = settle(a,b) + settle(b,c)`, no es alcanzable literalmente sobre el importe redondeado,
porque cada llamada redondea una division. Su enunciado correcto, y lo que las pruebas demuestran por
separado, es: exacta sobre la integral en `bigint`, y con una cota de una unidad de la cuarta decimal por
categoria sobre el importe. Para cadenas largas de ventanas existe `addAccrualIntegrals`, que suma
integrales y convierte una sola vez al final. No es una relajacion de la propiedad: es la propiedad
correctamente enunciada, y el backend debe respetarla usando la integral cuando encadene ventanas.

Coste asumido: un importe es una cadena, con lo que no admite operadores aritmeticos y todo calculo pasa
por una llamada al modulo. Es el mismo coste que la eleccion de `bigint` para el tiempo, y por la misma
razon: el compilador impide el atajo silencioso.

Segundo coste: `Money` es un subtipo de `string`, asi que se asigna a un campo `string` de un esquema sin
conversion y el olvido de `toWireMoney` no lo detecta el compilador. Es la unica asimetria de la frontera
y esta documentada en `shared/api/README.md`.

Queda por vigilar el interes de descubierto. Se calcula sobre el saldo de apertura de la ventana y solo
sobre su parte negativa, no integrando contra el saldo en movimiento. Con la tasa cero por defecto la
distincion es nula y el barrido periodico mantiene las ventanas cortas; el dia que se active una tasa no
nula, este es el punto donde la simplificacion se vuelve visible.

### Alternativas descartadas

Centimos como entero, que es la recomendacion habitual: descartada por la seccion 6.2 del plan. Con
liquidacion en cada escritura, el redondeo a centimos ocurre miles de veces por ciclo y el sesgo es
sistematico, no aleatorio, porque el truncamiento de un cargo siempre favorece al jugador.

Coma flotante de doble precision: 0,22 no es representable, de modo que la suma de veinte mil litros
vendidos depende del orden de los sumandos. Contradice el requisito de reproducibilidad de la seccion 5.2
del plan y haria que el ledger cuadrara con tolerancia en lugar de exactamente.

Una biblioteca de decimales (`decimal.js`, `big.js`): correcta y con una superficie mucho mayor que la
necesaria. El dominio requiere seis operaciones, y el modulo propio ocupa menos que la envoltura que
habria que escribir alrededor de la biblioteca para garantizar la forma canonica. Se evita ademas una
dependencia mas en un fichero `package.json` congelado y replicado cuatro veces.

`Decimal` de Prisma como tipo de dominio: ataria `shared/` al cliente generado, que es exactamente lo que
la seccion 8 del plan prohibe. Las reglas puras no conocen Prisma.

Enviar el importe como numero en el JSON: lo convierte en un `double` en el cliente antes de que ninguna
regla lo vea. La cadena decimal es la unica forma de que el valor llegue intacto.

---

## ADR-0009 — Ledger de asiento unico con secuencia, saldo resultante y referencia polimorfica

Fase: W2 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El GDD describe la economia como un flujo (secciones 48 y 114) y el resumen de regreso de su seccion 124
como una agregacion por concepto sobre el intervalo transcurrido. El documento de stack lo llama
`transactions (ledger economico)` en su seccion 3.1 y justifica PostgreSQL por las garantias ACID que
necesita.

Ninguno de los dos define la forma del registro. Las dos opciones habituales son doble partida, con
contrapartida por asiento, y asiento unico con importe firmado. En este dominio la contrapartida no
existe: el mercado, el pool laboral y el vendedor de tierras son "el mundo".

Hay dos requisitos que si son duros. El primero es que la suma de los asientos sea igual al saldo, porque
la prueba de humo de la seccion 10 del plan lo comprueba y porque es la unica forma de detectar dinero
creado de la nada. El segundo es que un reintento no duplique un cargo: BullMQ entrega al menos una vez, y
un reintento de "cobra los salarios de este intervalo" sin proteccion duplica el importe.

### Decision

Asiento unico con importe firmado, negativo para salida de caja del jugador. No hay doble partida. Lo que
se conserva del rigor contable es la inmutabilidad y la verificabilidad, mediante cinco mecanismos:

1. `seq` monotona por jugador, incrementada bajo el mismo bloqueo que el saldo. Da orden total y resuelve
   empates entre asientos con el mismo instante de juego. Es `@@unique([playerId, seq])`.
2. `balanceAfter` almacenado. Es redundante a proposito: hace el ledger auto-auditable con una prueba
   ejecutable, permite dibujar el historico sin funciones de ventana y, sobre todo, obliga a que todo
   camino de escritura pase por la fila del jugador, que es precisamente la serializacion buscada.
3. Referencia al origen polimorfica y sin clave ajena (`refType`, `refId`, `meta`). Un registro contable
   inmutable no debe apuntar con clave ajena a entidades que se despiden (GDD seccion 109), se venden o se
   fusionan (GDD seccion 22), porque habria que elegir entre destruir el rastro o prohibir el borrado. Se
   compensa con borrado logico obligatorio en todo lo que participa en costes.
4. `@@unique([playerId, idempotencyKey])`, con claves deterministas: `accrual:<jugador>:<tipo>:<desde>`,
   `harvest:<taskId>`, `sale:<jugador>:<claveCliente>`. Los cuatro devengos continuos de
   `ACCRUAL_LEDGER_TYPES` son los unicos cuyo importe es una integral sobre un intervalo y por tanto los
   unicos cuya clave lleva el intervalo.
5. Intervalos de vigencia en todo lo que genera coste: `hiredGameMs`/`terminatedGameMs` en trabajadores,
   `acquiredGameMs`/`disposedGameMs` en maquinas, `startGameMs`/`scheduledEndGameMs`/`endedGameMs` en
   tareas. Sin ellos el coste de una ventana pasada no seria recomputable.

El registro es de solo insercion, no de solo lectura. Un disparador, `farm_world_reject_update`, rechaza
`UPDATE` sobre `ledger_entries`, `game_events` y `world_time_segments`, y no rechaza `DELETE`. La asimetria
es deliberada: reescribir un asiento ya escrito no tiene ningun llamante legitimo, mientras que borrar
filas si lo tiene (cascada al borrar un jugador, `prisma migrate reset`, fixtures de prueba). Una
correccion es un asiento nuevo.

`NON_MONETARY_LEDGER_TYPES` enumera los asientos de importe cero que existen solo para explicar una perdida
fisica en el resumen de regreso; hoy solo `HARVEST_WASTE`, el grano que no cupo en el silo, con el volumen
desperdiciado en `meta`.

Contrato real de Prisma 7.9.1, que condiciona como se implementa todo lo anterior y difiere de Prisma 6 en
cinco puntos verificados empiricamente:

- El importe es `Decimal @db.Decimal(20, 4)` en el esquema, y `numeric(20,4)` en la base.
- El generador `prisma-client-js` ha desaparecido. Solo existe `prisma-client`, con `output` obligatorio, y
  emite TypeScript. La salida se fija en `../src/generated/prisma` porque `tsconfig.build.json` declara
  `rootDir: "src"` y una fuente generada fuera de `src/` falla con TS6059.
- `new PrismaClient()` ya no compila: exige `{ adapter }` o `{ accelerateUrl }`, y no existen
  `datasourceUrl` ni `datasources`. Para PostgreSQL hace falta `@prisma/adapter-pg`, que no esta declarado
  en el `backend/package.json` congelado.
- La configuracion vive en `backend/prisma.config.ts`, en la raiz del proyecto npm y no en `prisma/`. El
  bloque `datasource` del esquema solo declara `provider`; una `url` ahi se ignora. El `.env` no se carga
  solo: se carga con `process.loadEnvFile`.
- `@default(uuid(7))` lo genera el cliente y no la base de datos, de modo que las columnas `id` no tienen
  `DEFAULT` y todo SQL crudo debe aportar el identificador.

Consecuencia directa para el ledger: los tres disparadores de solo insercion, los 32 `CHECK` y los nueve
indices parciales se escriben a mano en SQL al final de la migracion inicial, porque Prisma no los
expresa. La migracion `20260811205212_init` tiene 684 lineas generadas y 687 escritas a mano.

### Consecuencias

La invariante economica es comprobable con una sola consulta por jugador, y una prueba la ejecuta. Un
camino de escritura que olvide pasar por la fila del jugador no puede escribir un asiento coherente,
porque `balanceAfter` no cuadraria.

La triple defensa frente al doble cobro es independiente en sus tres capas: actualizacion condicional
monotona de `lastAccrualGameMs`, unicidad de la clave de idempotencia, y puerta de transicion condicional
en cada manejador. Cualquiera de las tres detiene el cargo duplicado, y las tres se apoyan en mecanismos
distintos.

Coste asumido: la referencia polimorfica no tiene integridad referencial. Un `refId` puede apuntar a una
fila borrada, y ninguna restriccion lo impide. Es el precio de que el rastro sobreviva al borrado, y se
mitiga con borrado logico en las entidades referenciadas, no con una clave ajena.

Segundo coste: sin doble partida no hay cuadre por cuentas, solo por saldo. Si algun dia el mercado o el
pool laboral pasan a tener existencia propia (contratos, GDD seccion 50 fuera del MVP), habra que anadir
una contrapartida, y eso es una migracion.

Pendiente que bloquea la ejecucion, anotado en `docs/handoff/NOTES-w2d.md`: falta declarar
`@prisma/adapter-pg@7.9.1` en `backend/package.json`, que es un fichero congelado. Sin ella no arrancan ni
el backend ni la semilla. La mitigacion vigente es que `seed.ts` carga el adaptador con un especificador
indirecto, lo que mantiene la comprobacion de tipos en verde y produce, si el paquete no esta, un error de
ejecucion que nombra el paquete.

Segundo pendiente: `LedgerType` no tiene valor para el capital inicial. Un jugador nuevo tiene 160.000 de
saldo (GDD seccion 117) y ese importe necesita un asiento, o la invariante se rompe con el primer jugador.
La semilla usa hoy `COMPENSATION` con `meta = { reason: 'STARTING_CAPITAL', gddSection: 117 }` y la clave
`starting-capital:<playerId>`. Se propone anadir `STARTING_CAPITAL` al enumerado, que en PostgreSQL es un
`ALTER TYPE` en una migracion propia. El registro de un jugador nuevo en W3 debe usar entretanto el mismo
tipo y la misma clave.

### Alternativas descartadas

Doble partida con contrapartida por asiento: es lo correcto en contabilidad real y aqui obligaria a
inventar cuentas ficticias para el mercado, el pool laboral y el vendedor de tierras. Duplica el numero de
filas y no aporta ninguna comprobacion que `balanceAfter` no de ya, porque no hay ninguna entidad externa
cuyo saldo haya que conciliar.

Saldo derivado por agregacion, sin columna: mas normalizado y elimina la redundancia. Se descarta por dos
razones concretas: obliga a una agregacion sobre todo el historico en cada comprobacion de asequibilidad,
y sobre todo elimina la fila unica por la que todos los caminos de escritura tienen que pasar, que es la
serializacion que hace innecesarios los cerrojos explicitos en el resto del dominio.

Clave ajena real desde el asiento a la entidad de origen: da integridad y obliga a elegir entre borrado en
cascada, que destruye el rastro contable, o prohibicion del borrado, que impide despedir a un trabajador.
Ninguna de las dos es aceptable.

Restriccion `CHECK (balance >= 0)` en la fila del jugador: descartada porque el devengo offline lleva el
saldo a negativo de forma legitima, y el propio GDD lo confirma en su seccion 118. La suficiencia de fondos
se comprueba con una actualizacion condicional que descuenta solo si el saldo alcanza, que es una
comprobacion del camino de gasto y no del estado.

Rechazar tambien `DELETE` en los tres registros de solo insercion: haria imposible `prisma migrate reset` y
el borrado en cascada de un jugador, que son operaciones legitimas de desarrollo y de administracion.

---

## ADR-0010 — Persistencia procedural: modificaciones de celda, version de chunk, version de generador

Fase: W2 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El GDD exige en sus secciones 5 y 128 un mundo virtualmente infinito reconstruible desde una semilla, y en
su seccion 58 que se persistan unicamente las modificaciones de los jugadores. El documento de stack, en su
seccion 3.1, considera una tabla `cell_modifications` indexada por `(chunkX, chunkY, cellIndex)` un caso de
uso natural para SQL, y en su seccion 3.2 asigna a Redis el papel de cachear el resultado de la generacion
procedural.

Las magnitudes hacen que la decision importe. Un chunk son 1.024 celdas y el generador produce mil chunks,
un millon de celdas, en 135 milisegundos. Persistir las celdas generadas seria persistir informacion que el
generador reproduce gratis; no persistir nada de ellas abre un problema distinto y peor.

Ese problema es concreto: los parametros de ruido y los umbrales de terreno son valores inventados, sin
respaldo en el GDD, y por tanto candidatos a ajuste. Ajustarlos despues de que un jugador haya creado un
campo puede convertir en agua una celda que ya forma parte de ese campo. Cambiar el tamano de chunk es
peor: invalida en silencio todas las coordenadas guardadas, porque el indice de celda dentro del chunk
cambia de significado.

### Decision

Solo las celdas modificadas existen como fila. `WorldCell` tiene unicidad
`(worldId, chunkX, chunkY, idx)`, con `idx` en orden por filas, y denormaliza `cellX`/`cellY` para que un
arbol, una huella de edificio o un parche del cliente puedan direccionarse sin recalcular la division.
Todo lo demas se regenera desde la semilla.

Tres decisiones que acompanan a la anterior y sin las cuales no funciona:

1. `Chunk` lleva un contador `version`. Permite responder `unchanged` a un cliente al dia y, sobre todo,
   permite cachear en Redis el solape de modificaciones con la version en la clave: al modificar una celda
   cambia la clave, de modo que no hay que invalidar nada y desaparece toda la clase de errores de
   invalidacion y las carreras entre invalidar y repoblar.
2. `World.generatorVersion` y `World.chunkSize` se persisten, y `WorldCell.generatedTerrain` guarda como
   testigo el terreno que el generador produjo cuando la fila se escribio. El arranque aborta si las
   constantes de `shared/config/world.ts` no coinciden con lo persistido. `GENERATOR_VERSION` esta en 1 y
   cualquier cambio a `TERRAIN_NOISE` o `TERRAIN_THRESHOLDS_BP` obliga a incrementarlo.
3. `WorldCell.terrainOverride` guarda el terreno resultante de desmontar un bosque (GDD seccion 10), y es
   nulo mientras el terreno generado sigue vigente. `WorldCell.naturalTreeConsumed` impide el
   aprovechamiento de borrar y recrear una parcela forestal para que reaparezcan los arboles generados.

El estado del ciclo de cultivo vive solo en `Field`, no en la celda, lo que resuelve la contradiccion entre
las secciones 13, 76 y 85 del GDD: duplicarlo por celda multiplicaria por entre 250 y 2.000 el coste de
cada transicion.

No se usa extension geoespacial. Toda la geometria esta alineada a rejilla y la clave de chunk es el indice
espacial natural; las consultas rectangulares derivan los chunks cubiertos en lugar de recorrer rangos
sobre `cellX`/`cellY`, que un btree solo aprovecharia en su primera columna.

El terreno generado no viaja en la respuesta de `POST /api/world/chunks`, que devuelve solo la capa de
modificaciones y la version del chunk. El cliente ejecuta el mismo generador determinista de
`shared/world/` que el servidor. La codificacion de un chunk generado (`Uint8Array` de 1.024 bytes en orden
por filas, con 0 pradera, 1 bosque, 2 montana, 3 agua) es contrato: la publica `shared/world/terrain.ts` y
no se define una segunda tabla en `shared/api/`, porque cambiar un valor invalidaria todos los chunks
cacheados.

El generador no usa `Math.random`. Es un ruido de valor fractal con suavizado quintico sobre un hash entero
(`mix32` con `Math.imul`), lo que hace que la misma semilla y las mismas coordenadas produzcan los mismos
bytes en el servidor y en el cliente.

### Consecuencias

El coste de almacenamiento crece con la actividad del jugador y no con el tamano del mundo. Un mundo
recien creado no tiene ninguna fila de celda.

La cache con la version en la clave elimina un modo de fallo entero. No existe el camino "invalidar y
repoblar", con lo que no existe la carrera entre ambos, y una entrada obsoleta simplemente deja de ser
consultada en lugar de tener que borrarse.

El testigo `generatedTerrain` convierte un ajuste de balance del generador en un fallo de arranque visible
en lugar de en una corrupcion silenciosa. Es una peticion explicita de fallar pronto, y el coste es un
campo mas por fila modificada.

Verificado en esta fase: 1.000 chunks generados en 135 milisegundos, muy por debajo del presupuesto de dos
segundos, y 1.024.000 celdas sin una sola diferencia entre dos generaciones con la misma semilla.

Consecuencia medida que conviene conocer: la distribucion de terrenos es una afirmacion valida sobre el
agregado del generador y nunca sobre una region concreta. Sobre 20 semillas y 4.096.000 celdas el reparto
es 59,08 % pradera, 28,37 % bosque, 2,57 % montana y 9,97 % agua; midiendo una sola semilla en una ventana
de 30 por 30 chunks, la cuota de montana oscila entre el 0,88 % y el 3,08 %. La banda de
`TERRAIN_DISTRIBUTION_TARGET_BP` cumple hoy, con la montana al 28 % sobre su suelo, y W2b propone bajar ese
suelo de 200 a 100 puntos base para que la comprobacion siga detectando el fallo que importa, un mundo sin
barreras naturales, sin volverse fragil.

Limite conocido: `shared/rules/geometry.ts` acota la magnitud de una coordenada de celda en 2^25, que con
la celda de 10 metros son 335.000 kilometros, para poder indexar una celda con un unico entero seguro
(`cellKey`). Es holgado frente a donde el asignador de origen coloca a un jugador, pero es un limite real:
coordenadas mayores exigirian una clave de dos niveles o de cadena.

### Alternativas descartadas

Persistir todas las celdas generadas: contradice la seccion 58 del GDD y multiplica el almacenamiento por
el area explorada. Con 1.024 celdas por chunk y un mundo virtualmente infinito, el coste no tiene techo y
el beneficio es cero, porque el generador reproduce el dato en microsegundos.

No persistir el terreno generado ni su version: es la variante que falla en silencio. Un ajuste de los
umbrales de ruido convertiria en agua una celda de un campo existente, y el sintoma apareceria como un
campo que ya no valida.

Extension PostGIS con geometria real: aporta consultas que este dominio no hace. Toda la geometria esta
alineada a rejilla, no hay poligonos arbitrarios ni distancias euclideas en el modelo de datos, y la clave
de chunk ya es el indice espacial.

Enviar el terreno generado en la respuesta de chunk: multiplica por mucho el trafico de un dato que el
cliente puede calcular, y crea una segunda fuente de verdad para el terreno. Se deja la puerta abierta como
adicion compatible (`terrain` en base64 dentro de `chunkStateSchema`) por si el presupuesto de rendimiento
del cliente no admite generar terreno en el hilo principal; seria una adicion a un directorio congelado y
la aplicaria W7.

Un unico tilemap gigante en el cliente en lugar de uno por chunk, y por tanto una version global en lugar
de una por chunk: haria que el ciclo de vida de la cache no coincidiera con el de carga y descarga, y
obligaria a asignar cientos de miles de objetos de tesela.

---

## ADR-0011 — Catalogos de balance como constantes, no como tablas

Fase: W2 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El GDD publica seis catalogos: cultivos en su seccion 82, maquinaria agricola en la 89 y forestal en la
134, edificios en la 116, precios de tierra en la 115 y especies de arbol en la 133. El documento de stack
enumera `machines`, `workers`, `fields` y `trees` como tablas de PostgreSQL en su seccion 3.1, pero no dice
nada sobre donde vive la definicion de un tipo de maquina frente a una instancia de maquina.

La tentacion habitual es una tabla `machine_types` poblada por la semilla. En este proyecto tiene tres
consumidores simultaneos: el backend, que valida y cobra; el cliente, que muestra el catalogo y calcula la
prevision de duracion antes de enviar; y la calculadora de KPIs de `tools/balance/`, que la seccion 127 del
GDD pide como herramienta de diseno. Los tres tienen que ver exactamente el mismo numero en el mismo
instante.

### Decision

Los catalogos son constantes de TypeScript en `shared/config/`, no filas. Nueve modulos: `world`, `time`,
`economy`, `curves`, `crops`, `machines`, `buildings`, `workers`, `forestry` y `transitions`.

Los valores se implementan literalmente como los publica el GDD y no se ajusta ninguno, conforme a la
decision del usuario de no tocar el balance. Todo numero lleva en un comentario la seccion de la que
procede. Los numeros derivados del GDD que no se reproducen con sus propias constantes se documentan como
desviacion en el informe de balance, sin ajustar nada.

Dos extensiones del principio, ambas mas alla de lo que el plan preveia:

1. La tabla de compatibilidad de la seccion 90 del GDD y la maquina de estados del ciclo de cultivo de la
   seccion 76 se implementan como dato y no como codigo: `OPERATION_REQUIREMENTS` con siete entradas y
   `CROP_CYCLE_TRANSITIONS` con nueve. Una prueba cruza ambas tablas, con lo que una operacion que no
   habilite ninguna transicion, o una transicion sin operacion que la produzca, es un fallo de la suite y
   no un hueco que se descubre jugando.
2. Las reglas de `shared/rules/` reciben el catalogo como parametro, con el catalogo real como valor por
   defecto. Asi las pruebas fijan valores sin duplicar formulas, que es la unica forma de que una prueba de
   curva compruebe la curva y no el catalogo.

Las curvas de balance viven en `shared/config/curves.ts` como tablas de nodos y las resuelve una unica
funcion de interpolacion, `interpolateCurve`. Los nodos llevan la entrada en porcentaje de 0 a 100 porque
asi los publica el GDD, y el llamante convierte desde puntos base. Por debajo del primer nodo y por encima
del ultimo la funcion acota, nunca extrapola. Importa concretamente en la fertilidad: la seccion 77 del GDD
no da nodo por debajo del 10 %, y extrapolar hacia cero inventaria un numero de balance.

`STORAGE_RESOURCE_UNITS`, en `shared/config/buildings.ts`, publica por recurso la unidad almacenada, la
unidad de presentacion y el divisor. La interfaz divide; el servidor no.

### Consecuencias

Un cambio de balance es un cambio de codigo, con revision, con historia en el control de versiones y con
las pruebas doradas del ciclo minimo ejecutandose contra el valor nuevo. No hay forma de que la produccion
tenga un catalogo distinto del que la calculadora de KPIs modela.

Las pruebas doradas reconstruyen desde los catalogos, y no desde literales, los numeros de la seccion 117
del GDD: 330 celdas por 120 son 39.600, edificios 23.000, maquinaria 83.500, total 146.100 y colchon 13.900
sobre el capital inicial de 160.000. Los precios de las ocho maquinas de las secciones 89 y 134 y las tres
fronteras de fase del pino salen igualmente del catalogo.

Coste asumido y real: ajustar un precio exige un despliegue. No hay panel de administracion ni ajuste en
caliente, y en las fases de playtesting eso es friccion. Se acepta porque un catalogo mutable en produccion
hace que el ledger historico deje de ser reinterpretable, y el propio GDD advierte en su seccion 89 de que
la unidad de `workSpeed` se recalculara.

Segundo coste: los catalogos se replican en las dos copias sincronizadas de `shared/`. Una copia obsoleta
en `backend/src/shared` significaria que el servidor cobra un precio y el cliente muestra otro. Es
exactamente el riesgo que `check-shared-sync` cubre en integracion continua, y la razon por la que
`sync-types` es prerrequisito de los objetivos habituales del `Makefile`.

Queda por vigilar el momento en que aparezca un segundo cultivo. Con uno solo, `CROP_CATALOGUE` es una
constante con una entrada y la decision no se nota; con ocho, lo que decidira si la eleccion sigue siendo
correcta es si el jugador puede desbloquear cultivos, porque eso convierte el catalogo en estado por
jugador y no en configuracion.

### Alternativas descartadas

Tabla `machine_types` y equivalentes, poblada por la semilla: el enfoque habitual, y aqui obliga a que el
cliente consulte el catalogo por HTTP antes de poder calcular una prevision de duracion, y a que la
calculadora de KPIs se conecte a una base de datos para leer numeros de diseno. Introduce ademas la
posibilidad de que dos entornos tengan catalogos distintos, que es la clase de divergencia que mas cuesta
diagnosticar.

Catalogo en un fichero JSON leido en ejecucion: permite ajustar sin recompilar y pierde la comprobacion de
tipos justo donde mas hace falta, en la tabla de compatibilidad y en las curvas. Un nodo de curva mal
escrito pasaria a ser un fallo de ejecucion.

Tabla en la base de datos con las constantes como semilla y la constante como valor por defecto: mantiene
dos fuentes de verdad y obliga a decidir cual gana en cada lectura. Es la peor de las tres opciones,
porque el fallo aparece solo cuando difieren.

La compatibilidad operacion-maquina como codigo, con un `switch`: se descarta porque duplicaria la regla en
el backend y en el cliente, y porque una tabla se cruza con la maquina de estados en una prueba mientras
que dos `switch` no se cruzan con nada.

---

## ADR-0012 — Escala del mundo: celda de 10 m, chunk de 320 m, 16 px por celda

Fase: W2 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El GDD propone en su seccion 6 un chunk de 32 por 32 celdas, "sujeto a validacion tecnica", y en ningun
punto dice cuanto mide una celda. Su seccion 89 declara `workSpeed` en celdas por hora y advierte de que se
recalculara como hectareas por hora "cuando el tamano real de la celda se defina tecnicamente". La seccion
119 da 90 litros de trigo por celda.

Sin escala no se puede hacer tres cosas. No se puede juzgar si el balance es plausible, porque 90 litros por
celda es un dato sin sentido hasta saber que area es una celda. No se puede dimensionar el renderizado,
porque el numero de celdas visibles depende de los pixeles por celda. Y no se puede acotar la geometria,
porque el tope de una seleccion es a la vez un limite de rendimiento del cliente y de coste de transaccion
del servidor.

### Decision

Una celda son 10 por 10 metros, es decir un area. Un chunk son 32 por 32 celdas, conforme a la seccion 6 del
GDD, y por tanto 320 metros de lado. A zoom 1 una celda son 16 pixeles.

Las tres constantes viven en `shared/config/world.ts` como `CELL_SIZE_M`, `CHUNK_SIZE` y `CELL_PX`, junto a
`CELLS_PER_CHUNK` derivada y `MAX_SELECTION_CELLS`, fijada en 2.000.

La eleccion de 10 metros no es arbitraria: es la que hace que los numeros que el GDD si publica resulten
plausibles. Las 250 celdas del campo inicial de la seccion 117 son 2,5 hectareas, y los 90 litros por celda
de la seccion 119 equivalen a 9.000 litros por hectarea de trigo, que es un rendimiento realista. Con una
celda de 1 metro el campo inicial serian 250 metros cuadrados y el rendimiento 900.000 litros por hectarea;
con una celda de 100 metros serian 250 hectareas y 90 litros por hectarea. Ninguna de las dos deja el
catalogo del GDD en un rango defendible.

`CELL_PX` en 16 fija el caso de carga del renderizado, que es lo que decide el diseno de la escena: a zoom 1
hay unas 8.100 celdas visibles y a zoom 0,25 unas 130.000, donde un cuadrilatero por celda es imposible. De
ahi salen los dos niveles de detalle del plan y el presupuesto de unos 110 draw calls a zoom 1.

`MAX_SELECTION_CELLS` es un tope compartido y no dos topes iguales por casualidad: lo aplica el cliente al
arrastrar y lo aplica el servidor al validar, con la misma funcion de `shared/rules/selection.ts`, de modo
que el resaltado verde y el rechazo no pueden discrepar. Es tambien lo que impide que una peticion malformada
haga pasear un recorrido en anchura por una region ilimitada de un mundo virtualmente infinito.

`MAX_SELECTION_CELLS` vive en `shared/config/world.ts` y no en los limites de transporte de
`shared/api/schemas/common.ts`, precisamente porque no es un limite de transporte: es una regla de dominio
que el cliente necesita antes de enviar nada.

### Consecuencias

El catalogo del GDD queda interpretable en unidades reales, y el informe de balance puede afirmar que los
rendimientos son realistas en lugar de solo internamente coherentes.

La advertencia de la seccion 89 del GDD queda atendida sin cambiar el catalogo: `workSpeed` sigue en celdas
por hora, y ahora se puede convertir. Un arado a 4,2 celdas por hora son 0,042 hectareas por hora, que es
lento para maquinaria real; es una desviacion de balance conocida, no de escala, y el informe la recoge.

El coste es que la escala queda fijada antes de que exista renderizado. Si el juego resulta ilegible a 16
pixeles por celda, cambiar `CELL_PX` es barato porque solo afecta al cliente; cambiar `CELL_SIZE_M` es
barato porque solo afecta a la interpretacion; cambiar `CHUNK_SIZE` no lo es, porque invalida en silencio
todas las coordenadas guardadas y por eso se persiste en `World.chunkSize` y el arranque aborta si no
coincide.

Consecuencia de la que hay que ser consciente: la codificacion de un chunk generado supone `CHUNK_SIZE`, un
`Uint8Array` de 1.024 bytes. Un cambio de tamano de chunk cambia el contrato de transporte, la clave de
cache de Redis y el indice de celda a la vez.

### Alternativas descartadas

Dejar la escala sin definir hasta la fase de renderizado, que es lo que hace el GDD: significa que las
pruebas doradas de balance no pueden afirmar nada sobre plausibilidad y que el diseno de la escena se
decide sin caso de carga. Es el tipo de decision que se toma sola y mal si no se toma a tiempo.

Celda de 1 metro, que es lo habitual en un simulador agricola con conduccion: aqui la maquinaria no se
conduce (GDD seccion 1) y una celda de 1 metro convertiria el campo inicial de 250 celdas en una parcela de
250 metros cuadrados. Multiplicaria ademas por cien el numero de celdas de cualquier area util, lo que hace
inviable el modelo de una fila por celda modificada.

Celda de 100 metros, es decir una hectarea: haria que el campo inicial fueran 250 hectareas, una explotacion
grande desde el primer minuto, y que la seleccion celda a celda perdiera sentido como herramienta.

Un tope de seleccion distinto en el cliente y en el servidor, mas permisivo en el servidor: es la variante
que produce el fallo mas confuso, un area que el cliente pinta invalida y el servidor acepta.

Chunk de 64 celdas de lado, para reducir el numero de filas de chunk: 4.096 celdas por chunk cuadruplica el
coste de un parche por chunk y el tamano de la miniatura, y el GDD propone 32 explicitamente.

---

## ADR-0013 — Porcentajes en puntos base, cantidades fungibles enteras y habilidad escalar

Fase: W2 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El GDD expresa cinco atributos como porcentaje de 0 a 100: habilidad del trabajador (seccion 34), condicion
de la maquina (seccion 93), fertilidad (seccion 77), nivel de malezas (seccion 78) y fertilizacion (seccion
79). Tres de ellos evolucionan de forma continua con el tiempo y se liquidan de forma perezosa: las malezas
crecen a 0,6 puntos porcentuales por hora (seccion 82), la fertilidad se regenera en barbecho, y la
fertilizacion decae.

Un atributo perezoso se calcula como valor anterior mas tasa por intervalo transcurrido. Con coma flotante,
el resultado de esa acumulacion depende del numero de liquidaciones intermedias y del orden en que
ocurrieron, y el numero de liquidaciones depende de cuantas veces el jugador toco el campo. Es decir: dos
partidas con las mismas acciones en el mismo tiempo de juego pueden dar rendimientos distintos.

Aparte, el GDD sugiere en su seccion 139 modelar la habilidad como mapa (`skills: { farming: X, forestry: Y }`)
desde el inicio, para no tener que migrar si algun dia se diferencia la habilidad forestal de la agricola, y
en el mismo parrafo declara que en el MVP no hay habilidad diferenciada.

### Decision

Los cinco porcentajes de dominio se almacenan como enteros en puntos base, de 0 a 10.000, en el tipo marcado
`Bp`. El constructor `bp` exige entero y rango y lanza `RangeError`; los caminos que convierten un valor
calculado usan `clampBp`, que redondea y acota. La distincion es deliberada: un valor fuera de rango que
llega de la base de datos es dato corrupto, y uno que sale de una formula es un valor que hay que acotar.

Las cantidades fungibles tambien son enteras, extension que el plan no preveia y que responde al mismo
motivo. El trigo se cuenta en litros y la madera en decimetros cubicos: los volumenes de la seccion 131 del
GDD son multiplos de 0,05 metros cubicos y sumar decenas de miles en coma flotante haria que el resultado de
una suma perezosa dependiera de su orden. Los 500 metros cubicos de capacidad del almacen de la seccion 136
son 500.000 decimetros cubicos, y `STORAGE_RESOURCE_UNITS` publica por recurso la unidad almacenada, la de
presentacion y el divisor: la interfaz divide, el servidor no.

La habilidad se modela como escalar entero, no como mapa. Se rechaza la sugerencia de la seccion 139 del
GDD: anadir una columna en PostgreSQL es inmediato, mientras que un campo JSON cuesta seguridad de tipos de
forma permanente en el camino caliente del calculo de duracion, que es donde el compilador tiene que
garantizar que no se lee una clave inexistente.

En cambio si se reservan valores de enumerado de forma agresiva, porque migrar un enumerado en Prisma es
bastante mas incomodo que anadir una columna: `COMPACTED`, `BROKEN`, `IN_REPAIR`, `TRAVELING`, `UNAVAILABLE`,
`RESTING`, `INJURED`, `FELLED`, `BANKRUPT` y los tipos de asiento futuros, incluido `SEED_PURCHASE`.

Los atributos perezosos integran la tasa en `bigint` y truncan hacia cero, de modo que una liquidacion nunca
concede mas de lo que el tiempo transcurrido devenga y el resultado no depende de la plataforma. Nueve
`CHECK` de la migracion inicial verifican el rango de puntos base en la base de datos, no solo en la
aplicacion.

### Consecuencias

Un atributo perezoso es reproducible: liquidarlo una vez sobre 100 horas y liquidarlo diez veces sobre 10
horas dan el mismo resultado hasta el sesgo acotado que se describe abajo. Eso es lo que hace que la prueba
de propiedad de aditividad sea afirmable y que dos partidas identicas no divergan.

El truncamiento introduce un sesgo de hasta un punto base por liquidacion. Como los atributos se liquidan
solo en los cambios de estado, y un ciclo de trigo pasa por nueve como maximo, el sesgo acumulado queda por
debajo del 0,1 % del nivel. Consecuencia operativa que el backend debe respetar: no se puede liquidar estos
atributos con mas frecuencia que los cambios de estado. Liquidar cada 30 segundos de juego con una tasa de 60
puntos base por hora truncaria a cero cada vez y detendria el crecimiento de las malezas por completo.

Coste asumido: la unidad de dominio no es la que el GDD publica ni la que el jugador ve. Toda entrada de
catalogo en porcentaje se convierte al construirla, todo nodo de curva lleva la entrada en porcentaje porque
asi lo publica el GDD, y el llamante convierte con `bpToPercent`. Es una conversion mas en la frontera, y
tenerla explicita es preferible a que un 0,5 signifique el 50 % en un sitio y el 0,5 % en otro.

Segundo coste: la habilidad escalar significa que el dia que se diferencie la habilidad forestal habra una
migracion. Es una columna nueva con valor por defecto, es decir la migracion mas barata que existe en
PostgreSQL, y a cambio el calculo de duracion es de tipos comprobados desde el primer dia.

### Alternativas descartadas

Coma flotante de 0 a 1 o de 0 a 100, que es lo que el GDD escribe: descartada por el problema de
reproducibilidad descrito. No es una preocupacion teorica, porque el patron perezoso del plan hace que el
numero de liquidaciones sea una funcion del comportamiento del jugador.

Decimal exacto para los porcentajes, reutilizando el modulo `Money`: correcto y desproporcionado. Un
porcentaje con cuatro decimales de precision no significa nada en este dominio, y la aritmetica de cadenas
en el camino caliente del calculo de duracion cuesta sin aportar.

Puntos porcentuales enteros de 0 a 100: pierde resolucion justo donde hace falta. Una tasa de 0,6 puntos
porcentuales por hora no se puede acumular en pasos de un punto sin truncar el 40 % del crecimiento en cada
liquidacion corta.

Habilidad como mapa JSON desde el inicio, como sugiere la seccion 139 del GDD: pierde seguridad de tipos de
forma permanente para evitar una migracion que en PostgreSQL es una sola sentencia. El propio GDD declara que
en el MVP no hay habilidad diferenciada, de modo que el mapa tendria hoy una unica clave.

Madera en metros cubicos con decimales, que es como la publica el GDD: reintroduce la coma flotante
exactamente en el recurso que se suma en lotes de cientos de arboles.

---

## ADR-0014 — Huecos numericos del GDD y valores inventados con su justificacion

Fase: W2 · Fecha: 2026-08-11

### Estado

Aceptada.

### Contexto

El GDD advierte en la cabecera de su seccion 50.1 que los valores de economia son ilustrativos y requieren
playtesting, y la decision del usuario durante la planificacion fue no ajustar el balance: los valores
ilustrativos se implementan tal cual y las desviaciones se documentan.

Eso resuelve los numeros que el GDD publica. No resuelve los que no publica, y son bastantes. Sin
`wearRatePerHour` la condicion de una maquina nunca baja; sin duracion de fase el ciclo de cultivo no
avanza; sin `poolRefreshInterval` el pool de contratacion no se refresca; sin punto de origen un jugador
nuevo no puede registrarse. Cada hueco es un bloqueo de implementacion, no una imprecision.

La distincion que ordena esta entrada es entre dos clases de valor inventado. Un numero de balance cambia lo
que el jugador puede permitirse y compite con la decision de no ajustar el balance. Un parametro de forma
decide como se ve el mundo o cuanto tarda una busqueda, y no tiene efecto economico.

### Decision

Todo valor que el GDD no publica y que la implementacion necesita se inventa una sola vez, vive en
`shared/config/`, y lleva en el propio codigo el comentario que dice que es inventado y por que ese valor.
Ninguno se deduce en dos sitios.

Numeros con efecto economico:

| Valor | Fijado | Justificacion |
|---|---|---|
| Duracion de las fases del ciclo (secciones 76, 80, 82, 84, 118) | `SEEDED` 6 h, `GERMINATING` 12 h, `GROWING` 78 h | Suman las 96 h de `growthDuration` de la seccion 82 y preservan el ciclo de 325 h de la seccion 118. Las dos unicas cifras que el GDD publica quedan intactas |
| `wearRatePerHour` (secciones 93, 95) | 15 puntos base/h en tractor e implementos, 25 en cosechadora, 30 en maquinaria forestal | Nunca se define. El orden relativo sigue el de los costes de mantenimiento del catalogo, que es el unico indicio de intensidad de uso que el GDD da |
| Coste de reparacion por punto (seccion 93) | 30 puntos base del precio de compra | La seccion 93 da la formula y no la tasa. Derivarla del precio mantiene la proporcion entre maquinas sin inventar una tabla |
| Duracion de la reparacion por punto | 0,25 h de juego | La seccion 93 no da duracion, y sin ella `IN_REPAIR` no seria un estado observable |
| Suelo de `conditionFactor` y minimo para asignar (seccion 91) | Nodos `[0, 0,2] [10, 0,4] [50, 0,75] [100, 1,0]`, y rechazo por debajo del 10 % | Los tres puntos de la seccion 91 no son colineales y no define nada por debajo del 10 %. Sin suelo, condicion cero daria duracion infinita |
| Regeneracion de fertilidad en barbecho (secciones 77, 86) | 5 puntos base/h en `VIRGIN` | La seccion 77 admite el barbecho como via de restauracion sin cuantificarla. Sin ella el jugador queda sin tierra util en unos seis ciclos |
| Factor de reventa | 60 % | El GDD no dice a que precio se recompra un activo. Necesario para la liquidacion forzosa y para vender un edificio |
| Umbral de liquidacion forzosa | 30 % del valor liquidable | El GDD no define la quiebra, y con sus valores el saldo negativo es el estado esperado del primer ciclo |
| Interes de descubierto | 0 puntos base/h | Cuarto tipo de devengo, presente en el modelo y desactivado por valor, para no anadir una palanca de dificultad que el GDD no pide |
| Huella de `WOOD_STORAGE` (seccion 136) | 6 x 8 = 48 celdas | La seccion 136 da precio y capacidad, no huella. Se reutiliza la del garaje. Afecta al coste real de la seccion 116 y por tanto al total de la seccion 138, que no incluye suelo para el almacen |
| Velocidad de `REPLANT` (seccion 137) | 6,0 celdas/h | La seccion 137 exige maquinaria forestal y la unica velocidad publicada son 0,8 arboles/h, que haria plantar un planton cuatro veces mas lento que talar un arbol adulto |
| Velocidad de `CLEAR_LAND` (seccion 10) | 2,0 celdas/h, con tractor y arado | El desmonte no figura en la tabla de la seccion 90. La mitad de la velocidad del arado. Sin tarifa monetaria adicional: el coste economico que pide la seccion 10 es el coste de operacion de la tarea |
| `poolRefreshInterval` (seccion 102) | 48 h de juego | Aparece sin valor ni unidad. Se elige la unidad del resto del dominio |
| Tamano del pool (seccion 102) | 3 candidatos | Por literalidad del ejemplo de la seccion 102, que enumera tres |
| Ruido y suelo salarial (seccion 102) | 12 % de ruido, suelo de 6,00 por hora de juego | La seccion 102 dice "salario correlacionado con skill mas ruido" sin cuantificar ninguno de los dos |
| Mezcla de fases del bosque generado (secciones 130, 138) | 800 / 2.000 / 5.000 / 2.200 puntos base para planton, joven, maduro y viejo | No es una invencion libre: es la distribucion que hace salir la estimacion de la seccion 138. Da 1,534 m3 de volumen medio por celda, es decir 383,5 m3 en 250 celdas frente a los 382 m3 del GDD, y la prueba lo comprueba con tolerancia del 2 % |

Parametros de forma, sin efecto economico: los dos campos de ruido de `TERRAIN_NOISE` (elevacion con 4
octavas y periodo de 96 celdas, humedad con 3 y 64), los umbrales de `TERRAIN_THRESHOLDS_BP`, la banda
admisible de `TERRAIN_DISTRIBUTION_TARGET_BP`, el minimo de 400 celdas de pradera contiguas para un origen
valido, la separacion minima de 8 chunks entre origenes y el tope de 4.096 chunks de la busqueda.

Ademas, la regla procedural de salario de la seccion 102 se ajusta por minimos cuadrados sobre los tres
candidatos del ejemplo, ya que no son colineales: `salario = 0,45 x habilidad - 8,75`, con residuo maximo de
1,15 $/h en el intermedio, dentro de la banda de ruido declarada. Los 30 $/h de la seccion 36 y los 15 $/h de
la seccion 117 quedan como no reproducibles.

Asignador de origen de jugador, que resuelve el hueco mas grande del GDD, el de donde empieza un jugador
nuevo. `assignSpawn(seed, playerIndex)` es determinista en la semilla y el indice del jugador y no lee
ninguna fila, lo que permite asignar el origen dentro de la transaccion de registro. El indice se proyecta
sobre una espiral cuadrada de puntos de reticula separados `2 x SPAWN_MIN_DISTANCE_CHUNKS` chunks y la
busqueda se confina a un bloque de `SPAWN_MIN_DISTANCE_CHUNKS` chunks de lado anclado en ese punto. La
separacion minima entre dos origenes es por tanto `d + 1` chunks, superior a la exigida, y la garantia es
estructural y no probabilistica: dos registros concurrentes no pueden colisionar porque no comparten estado.
La funcion es total y devuelve siempre una celda de origen, con `meetsMinimum` en falso en el caso
degenerado, porque un fallo durante el registro es peor que un origen mediocre.

### Consecuencias

Ningun valor inventado esta oculto. La lista completa vive en el catalogo con su justificacion en el
comentario, y esta entrada es su indice.

La separacion entre numero de balance y parametro de forma tiene una consecuencia practica: los primeros
entran en el informe de balance de `docs/balance/` y son candidatos a ajuste tras playtesting; los segundos
no aparecen en el informe, pero cambiar cualquiera de los que afectan al terreno obliga a incrementar
`GENERATOR_VERSION`, porque el mundo ya persistido dejaria de ser reproducible.

Sobre el asignador de origen, medido en esta fase: 200 semillas, 200 origenes validos con al menos 400
celdas de pradera contiguas, 2,26 chunks inspeccionados de media. El caso degenerado no se ha dado sobre 200
semillas ni sobre los 50 primeros indices de jugador, de modo que `SPAWN_SEARCH_MAX_CHUNKS` queda como red de
seguridad y no como presupuesto habitual de busqueda.

Coste asumido: el catalogo contiene hoy una veintena de valores que el GDD no respalda, y cada uno es una
hipotesis de diseno sin validar. La mitigacion no es reducir su numero, que es el que la implementacion exige, sino que
esten todos en un mismo sitio y etiquetados, de modo que un cambio de balance sepa exactamente que puede
tocar sin contradecir al GDD.

Riesgo que queda abierto y hay que vigilar: varios de estos valores se eligieron por coherencia interna y no
por medida. La tasa de desgaste no se ha ejercitado sobre un ciclo real y la duracion de reparacion no se ha
observado como espera del jugador. Es material de la fase de playtesting, y el informe de balance debe
listarlos como tal.

### Alternativas descartadas

Ajustar los valores que el GDD si publica para que sus propios ejemplos cuadren: descartada por decision
explicita del usuario. La consecuencia asumida es que el informe de balance documenta un primer ciclo
deficitario con un ratio ingreso/coste de 0,0963 frente al objetivo de 1,3 a 1,8 de la seccion 125, y que no
existe punto de equilibrio.

Dejar los huecos sin valor y fallar en ejecucion cuando se alcancen: convertiria cada hueco en un fallo
descubierto en integracion, y algunos de ellos (la regeneracion de fertilidad, el umbral de liquidacion) solo
se alcanzan tras horas de juego.

Poner los valores inventados en un fichero aparte, separado del catalogo del GDD: parece mas honesto y en la
practica obliga a leer dos ficheros para entender una maquina, y a mantener dos formas para el mismo tipo. La
marca en el comentario, dentro de la entrada del catalogo, cumple la misma funcion sin partir el dato.

Origen de jugador aleatorio con reintento hasta encontrar sitio libre: la garantia pasa a ser probabilistica
y dos registros concurrentes pueden colisionar, lo que obliga a un cerrojo o a una restriccion de unicidad
sobre una region. La reticula de bloques reservados da la garantia sin coordinacion.

Origen fijo para todos los jugadores: descartado porque la seccion 3.1 del GDD hace de la tierra un recurso
estrategico limitado por ubicacion, y un origen compartido lo convierte en una carrera por las mismas celdas.
