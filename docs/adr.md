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
| ADR-0015 | Autenticacion JWT con refresh rotativo y ticket para WebSocket | [Ver](#adr-0015--autenticacion-jwt-con-refresh-rotativo-y-ticket-para-websocket) |
| ADR-0016 | Outbox en PostgreSQL con Redis como despertador y horizonte de agendado | [Ver](#adr-0016--outbox-en-postgresql-con-redis-como-despertador-y-horizonte-de-agendado) |
| ADR-0017 | Punto unico de avance del jugador y orden canonico de bloqueos | [Ver](#adr-0017--punto-unico-de-avance-del-jugador-y-orden-canonico-de-bloqueos) |
| ADR-0018 | Restricciones duras por contador con CHECK y por actualizacion condicional | [Ver](#adr-0018--restricciones-duras-por-contador-con-check-y-por-actualizacion-condicional) |
| ADR-0019 | Sincronizacion del cliente por secuencia con reproduccion e instantanea | [Ver](#adr-0019--sincronizacion-del-cliente-por-secuencia-con-reproduccion-e-instantanea) |
| ADR-0020 | Arte generado por codigo y paleta unica compartida con CSS | [Ver](#adr-0020--arte-generado-por-codigo-y-paleta-unica-compartida-con-css) |
| ADR-0021 | Modulo de mundo: caches de clave inmutable, lectura por lote y escritura por SQL crudo | [Ver](#adr-0021--modulo-de-mundo-caches-de-clave-inmutable-lectura-por-lote-y-escritura-por-sql-crudo) |
| ADR-0022 | El servidor simulado del cliente como transporte derivado del contrato | [Ver](#adr-0022--el-servidor-simulado-del-cliente-como-transporte-derivado-del-contrato) |
| ADR-0023 | Dos niveles de detalle en el renderizado: tilemap por chunk y miniatura por chunk | [Ver](#adr-0023--dos-niveles-de-detalle-en-el-renderizado-tilemap-por-chunk-y-miniatura-por-chunk) |
| ADR-0024 | Cache de chunks en el cliente con la version en la clave y terreno generado localmente | [Ver](#adr-0024--cache-de-chunks-en-el-cliente-con-la-version-en-la-clave-y-terreno-generado-localmente) |
| ADR-0025 | Geometria de campos: clave ajena en la celda y contiguidad por recorrido en anchura | [Ver](#adr-0025--geometria-de-campos-clave-ajena-en-la-celda-y-contiguidad-por-recorrido-en-anchura) |
| ADR-0026 | Compra de tierra: reclamacion de celdas por actualizacion condicional y cobro de lo adquirido | [Ver](#adr-0026--compra-de-tierra-reclamacion-de-celdas-por-actualizacion-condicional-y-cobro-de-lo-adquirido) |
| ADR-0027 | Regla de resolucion de la fusion de campos | [Ver](#adr-0027--regla-de-resolucion-de-la-fusion-de-campos) |
| ADR-0028 | Atributos perezosos del campo: corte del intervalo por fronteras de fase y una frontera por evento agendado | [Ver](#adr-0028--atributos-perezosos-del-campo-corte-del-intervalo-por-fronteras-de-fase-y-una-frontera-por-evento-agendado) |
| ADR-0029 | La granja como unidad contable y el edificio como unidad fisica: precio transaccional y capacidades | [Ver](#adr-0029--la-granja-como-unidad-contable-y-el-edificio-como-unidad-fisica-precio-transaccional-y-capacidades) |
| ADR-0030 | Reglas de validacion compartidas entre cliente y servidor en la herramienta de seleccion | [Ver](#adr-0030--reglas-de-validacion-compartidas-entre-cliente-y-servidor-en-la-herramienta-de-seleccion) |
| ADR-0031 | Los paneles del mundo consumen los modulos del lienzo: leyenda desde la paleta y minimapa desde la miniatura de chunk | [Ver](#adr-0031--los-paneles-del-mundo-consumen-los-modulos-del-lienzo-leyenda-desde-la-paleta-y-minimapa-desde-la-miniatura-de-chunk) |
| ADR-0032 | El panel no decide: el motivo de un control inhabilitado es el codigo con el que el servidor lo rechazaria | [Ver](#adr-0032--el-panel-no-decide-el-motivo-de-un-control-inhabilitado-es-el-codigo-con-el-que-el-servidor-lo-rechazaria) |
| ADR-0033 | El plan de colocacion de edificio en el cliente como espejo declarado del modulo del servidor | [Ver](#adr-0033--el-plan-de-colocacion-de-edificio-en-el-cliente-como-espejo-declarado-del-modulo-del-servidor) |
| ADR-0034 | Presupuesto local para el arrastre y presupuesto del servidor para cobrar, con `expectedTotal` como contrato de precio | [Ver](#adr-0034--presupuesto-local-para-el-arrastre-y-presupuesto-del-servidor-para-cobrar-con-expectedtotal-como-contrato-de-precio) |
| ADR-0035 | El campo se presenta con su estado almacenado y con su proyeccion cuando difieren | [Ver](#adr-0035--el-campo-se-presenta-con-su-estado-almacenado-y-con-su-proyeccion-cuando-difieren) |
| ADR-0036 | Capacidad por catalogo, contenido por granja y ocupantes por edificio | [Ver](#adr-0036--capacidad-por-catalogo-contenido-por-granja-y-ocupantes-por-edificio) |
| ADR-0037 | Organizacion de la capa de paneles: preferencias fuera de Pinia, piezas compartidas en el directorio de su materia y un componente para dos superficies | [Ver](#adr-0037--organizacion-de-la-capa-de-paneles-preferencias-fuera-de-pinia-piezas-compartidas-en-el-directorio-de-su-materia-y-un-componente-para-dos-superficies) |
| ADR-0038 | La lista de lo que sigue siendo andamiaje se deriva del registro y no se mantiene a mano | [Ver](#adr-0038--la-lista-de-lo-que-sigue-siendo-andamiaje-se-deriva-del-registro-y-no-se-mantiene-a-mano) |
| ADR-0039 | Deuda, interes de descubierto y liquidacion forzosa | [Ver](#adr-0039--deuda-interes-de-descubierto-y-liquidacion-forzosa) |
| ADR-0040 | La tarea como unico vinculo entre trabajador y maquina, y el desgaste por horas trabajadas | [Ver](#adr-0040--la-tarea-como-unico-vinculo-entre-trabajador-y-maquina-y-el-desgaste-por-horas-trabajadas) |
| ADR-0041 | La reparacion como evento agendado cuya duracion codifica los puntos comprados | [Ver](#adr-0041--la-reparacion-como-evento-agendado-cuya-duracion-codifica-los-puntos-comprados) |
| ADR-0042 | El pool de contratacion: regla procedural determinista, reemplazo integro y listado perezoso | [Ver](#adr-0042--el-pool-de-contratacion-regla-procedural-determinista-reemplazo-integro-y-listado-perezoso) |
| ADR-0043 | Mercado e historico: precio del catalogo, unidad almacenada como unidad de calculo y paginacion por secuencia | [Ver](#adr-0043--mercado-e-historico-precio-del-catalogo-unidad-almacenada-como-unidad-de-calculo-y-paginacion-por-secuencia) |
| ADR-0044 | El informe de balance como entregable determinista y no como puerta | [Ver](#adr-0044--el-informe-de-balance-como-entregable-determinista-y-no-como-puerta) |
| ADR-0045 | Movimiento de maquinaria y trabajadores cosmetico y derivado en el cliente | [Ver](#adr-0045--movimiento-de-maquinaria-y-trabajadores-cosmetico-y-derivado-en-el-cliente) |
| ADR-0046 | La capa de entidades: decision pura, dos frecuencias, escritura diferencial y reciclado acotado | [Ver](#adr-0046--la-capa-de-entidades-decision-pura-dos-frecuencias-escritura-diferencial-y-reciclado-acotado) |
| ADR-0047 | La costura del lienzo vive en la pagina y el arbitraje de entrada tiene un unico dueno | [Ver](#adr-0047--la-costura-del-lienzo-vive-en-la-pagina-y-el-arbitraje-de-entrada-tiene-un-unico-dueno) |
| ADR-0048 | El orden de evaluacion del servidor como motivo del control inhabilitado | [Ver](#adr-0048--el-orden-de-evaluacion-del-servidor-como-motivo-del-control-inhabilitado) |
| ADR-0049 | El arbol no almacena nada y el hito de crecimiento se agenda por parcela y por ventana | [Ver](#adr-0049--el-arbol-no-almacena-nada-y-el-hito-de-crecimiento-se-agenda-por-parcela-y-por-ventana) |
| ADR-0050 | El lote de una tala se recuerda marcando sus arboles, y el desmonte es una operacion sobre la parcela | [Ver](#adr-0050--el-lote-de-una-tala-se-recuerda-marcando-sus-arboles-y-el-desmonte-es-una-operacion-sobre-la-parcela) |
| ADR-0051 | La parcela forestal publica su geometria por el marco y por la instantanea, nunca dentro de su DTO | [Ver](#adr-0051--la-parcela-forestal-publica-su-geometria-por-el-marco-y-por-la-instantanea-nunca-dentro-de-su-dto) |
| ADR-0052 | Una sola evaluacion para la prevision y para la asignacion, y la puerta de transicion como unica fuente de idempotencia | [Ver](#adr-0052--una-sola-evaluacion-para-la-prevision-y-para-la-asignacion-y-la-puerta-de-transicion-como-unica-fuente-de-idempotencia) |
| ADR-0053 | Los tres caminos por los que un cliente recupera lo que el socket no le entrego | [Ver](#adr-0053--los-tres-caminos-por-los-que-un-cliente-recupera-lo-que-el-socket-no-le-entrego) |
| ADR-0054 | Dos premisas de orden que resultaron falsas: la escena viva y el dato que solo viaja en la respuesta | [Ver](#adr-0054--dos-premisas-de-orden-que-resultaron-falsas-la-escena-viva-y-el-dato-que-solo-viaja-en-la-respuesta) |
| ADR-0055 | Lo que una prueba de panel afirma, y las tres reglas que las de esta fase destaparon | [Ver](#adr-0055--lo-que-una-prueba-de-panel-afirma-y-las-tres-reglas-que-las-de-esta-fase-destaparon) |
| ADR-0056 | Estrategia de pruebas: cinco capas y un unico recorrido que ejercita el retardo real de la cola | [Ver](#adr-0056--estrategia-de-pruebas-cinco-capas-y-un-unico-recorrido-que-ejercita-el-retardo-real-de-la-cola) |
| ADR-0057 | Balance del MVP: el catalogo del GDD se implementa sin ajustar y el deficit del primer ciclo es el resultado publicado | [Ver](#adr-0057--balance-del-mvp-el-catalogo-del-gdd-se-implementa-sin-ajustar-y-el-deficit-del-primer-ciclo-es-el-resultado-publicado) |
| ADR-0058 | Las costuras entre modulos hermanos como registro en `lib/`, y un unico punto de relleno que los dos procesos invocan | [Ver](#adr-0058--las-costuras-entre-modulos-hermanos-como-registro-en-lib-y-un-unico-punto-de-relleno-que-los-dos-procesos-invocan) |
| ADR-0059 | El criterio de cierre frente al GDD: se corrige el codigo, no la constante, y toda correccion llega con la prueba que falla antes | [Ver](#adr-0059--el-criterio-de-cierre-frente-al-gdd-se-corrige-el-codigo-no-la-constante-y-toda-correccion-llega-con-la-prueba-que-falla-antes) |
| ADR-0060 | Un catalogo de sesenta y dos cultivos como linea base por familia mas desviaciones | [Ver](#adr-0060--un-catalogo-de-sesenta-y-dos-cultivos-como-linea-base-por-familia-mas-desviaciones) |
| ADR-0061 | Las existencias recuerdan su cultivo; la categoria de almacen es solo el cubo de capacidad | [Ver](#adr-0061--las-existencias-recuerdan-su-cultivo-la-categoria-de-almacen-es-solo-el-cubo-de-capacidad) |
| ADR-0062 | Cuatro estaciones derivadas del reloj, con ventana de siembra por cultivo y sin clima | [Ver](#adr-0062--cuatro-estaciones-derivadas-del-reloj-con-ventana-de-siembra-por-cultivo-y-sin-clima) |
| ADR-0063 | Render por silueta de familia y tinte por cultivo: cuarenta casillas de atlas, no quinientas | [Ver](#adr-0063--render-por-silueta-de-familia-y-tinte-por-cultivo-cuarenta-casillas-de-atlas-no-quinientas) |
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

Nota de cierre de W3, 2026-08-12: la ventana de parcheo W2.5 movio los cinco codigos de autenticacion a
`ValidationCode`, de modo que `ApiTransportCode` tiene hoy seis valores y no los once que dice el punto 4.
La decision no cambia; cambia el recuento. Registrado en `docs/handoff/NOTES-w2-5-parcheo.md`, apartado 1.

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

Nota de cierre de W3, 2026-08-12: aplicado por la ventana de parcheo W2.5. `INITIAL_ANCHOR_GAME_MS` vive
en `shared/config/time.ts` y la semilla lo importa de alli.

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

Nota de cierre de W3, 2026-08-12: los dos pendientes estan aplicados por la ventana de parcheo W2.5.
`@prisma/adapter-pg` 7.9.1 esta declarado e instalado, y `LedgerType.STARTING_CAPITAL` existe desde la
migracion `20260811215755_ledger_type_starting_capital`. La semilla y el registro de jugador de W3 escriben
el asiento de apertura con ese tipo y con la clave `starting-capital:<playerId>`.

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

---

## ADR-0015 — Autenticacion JWT con refresh rotativo y ticket para WebSocket

Fase: W3 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

El documento de stack fija en su seccion 6 un token de acceso JWT de corta vida y un refresh en cookie
`httpOnly`, con las contrasenas cifradas con argon2. La seccion 7 del plan anade la pieza que el stack no
resuelve: el WebSocket. Un navegador no puede fijar cabeceras en el apreton de manos de una conexion
WebSocket, de modo que el token de acceso no puede viajar donde viaja en el resto de la superficie, y
ponerlo en la cadena de consulta lo deja escrito en los registros de todos los proxies del camino.

Hay ademas una restriccion de ejecucion que condiciona la forma de la solucion: `backend/package.json`
esta congelado desde W1 (regla 2 de la seccion 11 del plan) y no declara ninguna biblioteca de JWT, ni
`@fastify/jwt`, ni `jsonwebtoken`, ni `jose`. Pedir una habria bloqueado la fase entera en un cambio de
fichero congelado.

El tercer condicionante procede del cliente. La rotacion del refresh y la concurrencia del navegador
interactuan de forma no evidente: si tres peticiones simultaneas reciben 401 y cada una refresca por su
cuenta, se producen tres rotaciones, dos de ellas contra un token ya consumido, y la recuperacion destruye
la sesion que intentaba salvar.

### Decision

Tres credenciales con tres ciclos de vida distintos, y ninguna hace el trabajo de otra.

1. Token de acceso: JWT HS256 de quince minutos (`ACCESS_TOKEN_TTL_REAL_MS`), devuelto en el cuerpo de la
   respuesta y guardado por el cliente solo en memoria. Es sin estado a proposito: verificarlo cuesta un
   HMAC y ninguna consulta, que es lo que permite que lo lleve cada peticion.
2. Refresh: valor opaco de 256 bits en cookie `httpOnly`, acotada a la ruta `/api/auth`, con vigencia por
   omision de treinta dias (`REFRESH_TTL=2592000`). Solo se almacena su resumen SHA-256. Tiene fila a
   proposito: rotacion y revocacion son exactamente lo que un token autocontenido no puede hacer.
3. Ticket de WebSocket: identificador de un solo uso con treinta segundos de vigencia
   (`WS_TICKET_TTL_REAL_MS`), emitido por `POST /api/auth/ws-ticket` y guardado en Redis. Se canjea con
   `GETDEL`, de modo que el borrado y la lectura ocurren en el mismo viaje y un ticket reproducido no
   encuentra nada.

La rotacion del refresh es obligatoria en cada uso: la fila presentada se revoca, se emite una nueva y la
antigua registra en `replacedByTokenId` cual la sustituyo. Esa cadena es lo que hace detectable el robo:
un token ya revocado que tiene sucesor se ha usado dos veces, cosa que un cliente legitimo nunca hace, y
la consecuencia es la revocacion de toda la familia activa del jugador.

El JWT esta implementado a mano en `backend/src/lib/jwt.ts` sobre `node:crypto`, con un alcance
deliberadamente estrecho, que es lo que hace defendible escribirlo en lugar de temerario: un unico
algoritmo fijado en el codigo, con el `alg` de la cabecera comprobado contra el y nunca usado para elegir
implementacion, que es toda la familia de ataques de confusion de algoritmo; sin `none`, sin RSA, sin
identificador de clave, sin JWKS y sin tokens anidados; firma comparada con `timingSafeEqual` antes de
leer el payload, de modo que un token malformado no llega nunca a las reclamaciones; y `exp` obligatorio,
de modo que un descuido no puede acunar una sesion eterna. El modulo lee tiempo real y no tiempo de juego,
lo que no es una excepcion a la seccion 6.1 del plan: la vigencia de una sesion es una propiedad del
transporte y no debe estirarse cuando cambia el multiplicador.

Dos decisiones de contorno que la implementacion obligo a fijar:

- El apreton de manos del WebSocket esta exento del limitador de peticiones, y el estrangulamiento se
  aplica donde si tiene sentido, en la ruta que emite el ticket. Contar tambien el `upgrade` limitaria las
  reconexiones durante una caida, que es justo cuando un cliente reconecta mas.
- Un solo socket por jugador. Una segunda conexion desplaza a la primera, que se cierra con el codigo
  4410 (`SUPERSEDED`). Dos sockets serian ambos correctos, pero el cliente aplicaria cada sobre dos veces
  en dos pestanas y la contabilidad del latido pasaria a ser por socket sin que la interfaz lo pida.

En el cliente, el refresco es una unica promesa compartida por rafaga de 401. No es una optimizacion: es
la unica forma de que la rotacion y la concurrencia sean compatibles.

### Consecuencias

La verificacion de una peticion cuesta un HMAC y ninguna consulta, y la revocacion existe de verdad, pero
solo en el eje del refresh. Consecuencia asumida y conocida: cerrar sesion no invalida el token de acceso
ya emitido, que sigue siendo valido hasta quince minutos. Es el precio de que el token sea sin estado, y
la mitigacion es su vigencia corta, no una lista de revocacion que reintroduciria la consulta por
peticion.

El robo de un refresh es detectable y su ventana esta acotada, porque la primera vez que el token robado
y el legitimo se usan en distinto orden la familia entera cae. El coste es que un cliente con dos pestanas
que refresquen a la vez producira ese mismo sintoma si no comparte la promesa de refresco, lo que
convierte al refresco unico del cliente en parte de la decision y no en un detalle de implementacion.

El JWT escrito a mano es la deuda visible de esta entrada. Trece pruebas cubren cada forma de rechazo,
incluida la de `alg: none`, y el modulo no tiene mas superficie que la que el servicio consume. Si W7
prefiere una biblioteca, el cambio es de una linea en `plugins/auth.ts` y el borrado de `lib/jwt.ts`; el
resto del backend no conoce la diferencia. No es una peticion pendiente: la implementacion actual es
completa y esta probada.

El ticket de un solo uso obliga a un viaje REST antes de cada conexion, incluidas las reconexiones. Es lo
que se paga por no poner credenciales en la URL, y por eso la ruta que lo emite es la que se limita y no
el `upgrade`.

### Alternativas descartadas

Token de acceso en la cadena de consulta del WebSocket: es la solucion mas corta y deja la credencial en
los registros de acceso de Caddy, en el historial del navegador y en cualquier proxy intermedio. El ticket
tiene el mismo coste de implementacion y ninguna de esas propiedades.

Token de acceso en `localStorage`: sobrevive a la recarga, que es su unico atractivo, y queda expuesto a
cualquier ejecucion de script en la pagina. La combinacion de memoria mas cookie `httpOnly` da la misma
continuidad de sesion sin esa exposicion.

Refresh como JWT autocontenido: elimina la tabla y con ella la revocacion y la deteccion de reutilizacion,
que son precisamente las dos propiedades por las que existe el segundo token.

Aceptar el segundo uso de un refresh ya rotado, para tolerar clientes con carreras: convierte una cookie
robada en una credencial de duracion indefinida y hace inobservable el robo.

Declarar una biblioteca de JWT en `backend/package.json`: correcto en un proyecto normal y aqui bloquea la
fase en un fichero congelado que leen tres agentes mas. El alcance real que el servicio necesita es un
HMAC sobre dos segmentos base64url.

Varios sockets simultaneos por jugador: obliga a que la deduplicacion de sobres y la contabilidad del
latido pasen a ser por socket, sin que ninguna pantalla de la interfaz lo pida.

---

## ADR-0016 — Outbox en PostgreSQL con Redis como despertador y horizonte de agendado

Fase: W3 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

El documento de stack se contradice sobre la simulacion diferida, contradiccion recogida como 1.7 en
`docs/erratas-gdd-stack.md`: su seccion 4.4 afirma que no hace falta un proceso por lotes porque el
progreso se calcula al regresar el jugador, y su seccion 4.2 hace depender la puntualidad de trabajos
retardados que viven en Redis. Las dos afirmaciones solo son compatibles si Redis no es la lista de lo que
tiene que ocurrir.

El GDD exige en su seccion 52 que la simulacion continue con el jugador desconectado, y el volumen del
dominio impide agendar todo lo pendiente: un mundo con decenas de miles de arboles y con transiciones de
fase de cultivo por campo produce un futuro que no cabe en memoria sin cota.

Hay ademas un problema de orden que no se resuelve con disciplina. Encolar dentro de la transaccion de
dominio produce un trabajo que corre contra una fila que aun no esta comprometida, y el manejador
encuentra entonces la nada y falla o, peor, interpreta la ausencia como "ya procesado". Publicar un sobre
dentro de la transaccion convierte al cliente en autoridad durante unos milisegundos. Ninguno de los dos
errores se detecta leyendo el diff que los introduce, y quedan seis flujos de trabajo por delante.

### Decision

`ScheduledEvent` en PostgreSQL es la lista autoritativa de lo que debe ocurrir. Redis contiene unicamente
despertadores.

El orden correcto se impone con la forma y no con una convencion. El cuerpo de una transaccion recibe un
`Outbox` (`backend/src/lib/outbox.ts`) que solo registra intencion, con tres clases de efecto: crear el
despertador, retirar un trabajo y publicar sobres. `withTransaction` lo vacia cuando el commit ya ha
vuelto. El codigo capaz de alcanzar la cola o el canal de publicacion no se le pasa al cuerpo, de modo que
encolar dentro de la transaccion no es una equivocacion posible sino una expresion que no se puede
escribir.

Cuatro reglas completan el mecanismo:

1. Horizonte de agendado. Solo obtiene despertador lo que vence dentro de una ventana de tiempo real
   configurable, `SCHEDULE_HORIZON_REAL_MS`, de 24 horas por omision. El resto vive como fila pendiente.
   Es lo que acota la memoria de Redis y lo que hace que un re-anclaje del reloj reprograme decenas de
   trabajos y no el futuro entero.
2. Mundo pausado. Con `rateNum = 0` el instante de vencimiento no se alcanza nunca y `realMsFor` devuelve
   nulo, de modo que el evento se aparca en lugar de encolarse. Encolar con retardo cero produciria un
   bucle, porque cada manejador volveria a encolar en su guarda de vencimiento.
3. Guarda de vencimiento en todo manejador: si el tiempo de juego es anterior a `dueGameMs`, el trabajo se
   reencola sin aplicar efecto alguno. El payload es minimo por la misma razon: identificadores,
   `dueGameMs` y `epoch`, nunca importes ni cantidades, que se habrian calculado en el pasado.
4. `sim.reconcile` encola en orden todo lo vencido al arrancar el worker y cada minuto
   (`RECONCILE_INTERVAL_REAL_MS`). Perder el contenido de Redis no pierde nada, que es lo que la seccion
   4.4 del documento de stack da por supuesto y solo es cierto con este diseno.

El identificador de un trabajo es determinista y lleva el epoch de agendado, de modo que anadirlo dos
veces es inocuo en BullMQ y los trabajos de un epoch superado forman un conjunto distinto que puede
retirarse sin tocar el vigente.

Detalle de implementacion que conviene registrar porque costo una prueba: la deduplicacion de un evento
pendiente es `INSERT ... ON CONFLICT DO NOTHING` sobre el indice unico parcial, y no una insercion con la
violacion capturada despues. En PostgreSQL un statement que falla aborta la transaccion entera, de modo
que capturar la violacion deja una transaccion en la que ya no se puede leer nada. El predicado del indice
hay que repetirlo completo en el destino del conflicto (`status = 'PENDING' AND "dedupeKey" IS NOT NULL`),
o PostgreSQL responde 42P10.

### Consecuencias

La afirmacion de la seccion 4.4 del documento de stack pasa a ser cierta: vaciar Redis no pierde progreso,
solo puntualidad hasta el siguiente barrido. La consecuencia se ejercita en las pruebas de integracion.

La memoria de Redis queda acotada por el horizonte y no por el tamano del futuro del mundo, que es lo que
hace viable el modelo perezoso de los arboles de la seccion 6.5 del plan.

Coste asumido: hay dos almacenes en el camino de agendado y hay que razonar sobre los dos. Una fila
pendiente fuera del horizonte depende del barrido para llegar a ejecutarse, lo que convierte a
`sim.reconcile` en parte de la correccion del sistema y no en una tarea de mantenimiento opcional. Si el
barrido deja de correr, los eventos lejanos no se pierden pero tampoco se disparan hasta que el jugador
toca su mundo.

Segundo coste, visible hoy: cinco de los seis tipos de evento agendado apuntan a un manejador de
andamiaje, que no aplica efecto alguno y lo hace constar en el registro y en la metrica
`farm_world_scheduled_events_unhandled_total`. La alternativa, que el andamiaje fallara, convertiria cada
vencimiento en un reintento indefinido, porque el punto de avance ya marco el evento como procesado. Esa
metrica debe quedar plana en cero cuando W6 cierre; mientras no lo este, nombra el modulo que falta.

### Alternativas descartadas

Encolar dentro de la transaccion de dominio, que es lo que se escribe cuando no se piensa en el orden: el
trabajo puede empezar antes del commit y encontrar un estado que todavia no existe. Ademas, un rollback
deja el trabajo encolado y el estado sin cambiar.

BullMQ como unica autoridad, con el retardo del propio trabajo como agenda: es la lectura literal de la
seccion 4.2 del documento de stack, y hace que un vaciado de Redis pierda progreso de forma irrecuperable
en un juego cuyo pilar es que el mundo avanza sin el jugador.

Agendar todo el futuro conocido sin horizonte: simplifica el codigo, elimina el barrido y hace que la
memoria de Redis crezca con el numero de arboles del mundo. Ademas, un cambio de multiplicador obligaria a
reprogramar todos los trabajos existentes en lugar de los del horizonte.

`LISTEN`/`NOTIFY` de PostgreSQL en lugar de una cola: no hay retardo nativo, de modo que habria que
construir el agendado igualmente, y las notificaciones se pierden si no hay ningun oyente conectado, que
es exactamente el caso que este diseno tiene que sobrevivir.

Capturar la violacion de unicidad en lugar de `ON CONFLICT DO NOTHING`: aborta la transaccion en
PostgreSQL, con lo que el camino de recuperacion queda inservible.

---

## ADR-0017 — Punto unico de avance del jugador y orden canonico de bloqueos

Fase: W3 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

El GDD exige en su seccion 52 que el mundo avance con el jugador desconectado y en su seccion 53 que la
simulacion sea por eventos y no por tick continuo. La seccion 6.3 del plan convierte esas dos exigencias
en una invariante: todos los efectos de simulacion se aplican en un unico punto.

El motivo no es de estilo. Los efectos de un intervalo de tiempo de juego son de dos clases que hay que
intercalar: eventos discretos que vencen (una tarea que termina, un campo que cambia de fase) y devengos
continuos que se integran sobre el intervalo (salarios, mantenimiento, operacion). Si se liquidan los
devengos una sola vez al final de la ventana, el intervalo entero se cobra a las tasas que hayan
sobrevivido, y no a las que estuvieron en vigor: una tarea que termino a la primera hora seguiria
devengando coste de operacion durante las cien siguientes.

El segundo motivo es de concurrencia. Bajo `READ COMMITTED` dos transacciones concurrentes leen el mismo
saldo, y sin un punto de serializacion cada una escribe sobre la lectura de la otra. Ademas, dos caminos
que tomen los mismos dos bloqueos en orden distinto producen un interbloqueo que PostgreSQL resuelve
matando a uno de los dos, lo que aparece como un 500 intermitente en el endpoint mas transitado.

### Decision

`advancePlayer(tx, playerId, toGameMs)` es el unico punto donde se aplican efectos de simulacion. Bloquea
la fila del jugador, procesa en orden los eventos vencidos liquidando devengos antes de cada uno, liquida
hasta el instante final y aplica la politica de deuda derivada (`IN_DEBT` sigue al saldo ya liquidado).

Tres llamantes y ningun cuarto: el manejador de la cola, el envoltorio `withPlayerAdvanced` de todo
endpoint mutante y el inicio de sesion. Los manejadores de cada tipo de evento viven en el modulo que
posee el dominio y se registran a traves de un registro, de modo que este fichero no se reabre para anadir
un tipo (regla 3 de la seccion 11 del plan).

Orden canonico de bloqueos, documentado en `backend/src/lib/tx.ts` y total, de modo que no puede formarse
un ciclo:

1. `worlds`, solo para un re-anclaje del reloj y para un registro, que necesita un punto de serializacion
   donde asignar el indice de jugador del asignador de origen.
2. `players`. Es el bloqueo del camino de escritura: lo sostiene `advancePlayer`, bajo el se incrementa la
   secuencia del ledger y bajo el se escribe `balanceAfter`.
3. Filas de dominio (campos, maquinas, trabajadores, tareas, parcelas y chunks), en orden ascendente de
   identificador. `ascendingIds` existe para que ese paso sea mecanico y no dependa de que cada autor lo
   recuerde.

El aislamiento es `READ COMMITTED`, que `infra/postgres/init.sql` fija como valor por omision de la base
de datos y que este modulo declara explicitamente. Es suficiente porque ninguna de las restricciones duras
de la seccion 5.4 del plan se apoya en una lectura repetible: todas fuerzan a las dos transacciones a
escribir la misma fila, y PostgreSQL entonces las serializa y reevalua la condicion contra el valor ya
comprometido. El bloqueo explicito queda reservado a la fila del jugador, que lo necesita porque el camino
de liquidacion lee el conjunto de trabajadores, maquinas y tareas antes de escribir.

Consecuencia de forma que la implementacion obligo a fijar y que condiciona a W4, W5 y W6: la guarda
`advancesPlayer` de `plugins/routes.ts` se aplica cuando la ruta exige sesion, avanza al jugador y no es
`sequenced`. Una ruta secuenciada muta, y por tanto corre dentro de `withPlayerAdvanced`, que avanza al
jugador en la misma transaccion que sus propias escrituras; avanzarlo otra vez en un `preHandler` abriria
una segunda transaccion y tomaria el bloqueo dos veces sin cambiar nada. Toda ruta `sequenced` tiene por
tanto que usar `withPlayerAdvanced`, que es ademas lo unico que devuelve el `seq` que su respuesta debe
llevar.

### Consecuencias

La consecuencia que da forma al sistema entero: si el worker de simulacion esta caido, la primera peticion
del jugador repara su mundo. BullMQ es un requisito de puntualidad, no de correccion, y eso convierte una
caida de la cola en una degradacion de latencia en lugar de en una perdida de progreso.

El coste de una ventana temporal es el mismo se procese de una vez o en veinte tramos, porque cada tramo
se cobra a las tasas vigentes en el, y porque cada asiento lleva clave de idempotencia con el intervalo.
Eso es lo que hace recomputable el ledger y afirmable la propiedad de aditividad de la seccion 8 del plan.

Coste asumido: la fila del jugador es un punto de serializacion por jugador. Dos peticiones mutantes del
mismo jugador se ejecutan en serie. Es aceptable porque el dominio es por jugador y no hay contencion
entre jugadores, pero significa que un avance largo (un jugador que vuelve tras semanas, con muchos
eventos vencidos) mantiene el bloqueo mientras dura, y que el resto de sus peticiones esperan. La palanca
si eso llega a doler es el barrido periodico, que mantiene las ventanas cortas.

Segundo coste: el orden de bloqueos es una convencion que hay que sostener en cuatro flujos de trabajo mas.
Esta escrito en la cabecera de `lib/tx.ts` y mecanizado en el paso 3 con `ascendingIds`, pero los pasos 1
y 2 dependen de que el autor de un modulo los respete; no hay comprobacion automatica.

### Alternativas descartadas

Liquidar los devengos una sola vez al final de la ventana y aplicar despues todos los eventos vencidos: es
mas corto y cobra el intervalo entero a las tasas equivocadas, que es exactamente el error que la integral
de solapes existe para evitar.

Avanzar al jugador en un `preHandler` de todas las rutas, incluidas las mutantes: abre una transaccion
adicional por peticion, toma el bloqueo del jugador dos veces y deja el avance fuera de la transaccion que
escribe, con lo que un fallo de la mutacion no revierte el avance.

Cerrojo distribuido en Redis para serializar al jugador: anade un modo de fallo (expiracion del cerrojo
con la transaccion aun viva) para obtener una garantia que la fila de PostgreSQL ya da, y contradice la
regla de la seccion 5 del plan de que Redis no es mecanismo de correccion.

Aislamiento `SERIALIZABLE`: convertiria las carreras en errores de serializacion que habria que
reintentar en todo el camino de escritura, a cambio de una garantia que las actualizaciones condicionales
ya proporcionan sin reintentos.

Marca de simulacion por jugador, que es la lectura literal de la seccion 52 del GDD: se descarto en W2 en
favor de `lastAccrualGameMs` y marcas por atributo, para que liquidar un atributo no descarte el tiempo
transcurrido de otro. Esta entrada solo confirma la decision en el camino de escritura.

---

## ADR-0018 — Restricciones duras por contador con CHECK y por actualizacion condicional

Fase: W3 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

La seccion 5.4 del plan enumera nueve restricciones duras del dominio (plazas de garaje de la seccion 96
del GDD, alojamiento de la 108, capacidad de silo de la 83, exclusividad de uso de celda de la 15, doble
compra de la misma celda, doble reserva de trabajador o maquina de la 104, fondos suficientes, un arbol
por celda de la 130 y contiguidad de campos de la 17) y les asigna un mecanismo a cada una. La idea que
las unifica es que cuando dos transacciones concurrentes deben verse, hay que forzarlas a escribir la
misma fila: bajo `READ COMMITTED` PostgreSQL serializa entonces a los escritores de esa fila y reevalua la
condicion contra el valor ya comprometido.

W2 dejo escrita la mitad declarativa: 32 restricciones `CHECK`, diez disparadores y nueve indices
parciales en la migracion inicial. Lo que W3 tiene que fijar es la mitad procedimental, es decir la forma
que adopta un camino de escritura para que la restriccion se ejercite en lugar de sortearse, y para que
una violacion no acabe convertida en un reintento indefinido dentro de un trabajo de la cola.

### Decision

Un camino de escritura no lee y despues escribe. Escribe con una condicion, y el numero de filas afectadas
es la decision. Concretado en las cuatro piezas que esta fase implementa:

1. Cobro. `charge` de `lib/ledger.ts` es un `UPDATE ... WHERE id = ? AND balance >= importe` cuyo recuento
   de filas decide: cero significa fondos insuficientes y devuelve `{ ok: false, reason:
   'INSUFFICIENT_FUNDS' }` en lugar de lanzar, para que el modulo llamante elija si eso es un 402 o un
   motivo por celda. No puede ser una restriccion de tabla, porque el devengo offline lleva el saldo a
   negativo de forma legitima (GDD seccion 118).
2. Avance del devengo. `lastAccrualGameMs` se mueve con un `UPDATE ... WHERE lastAccrualGameMs < destino`,
   monotono y condicional, de modo que dos liquidaciones concurrentes de la misma ventana no la cobran dos
   veces.
3. Puerta de transicion. Un evento agendado se reclama con `UPDATE ... WHERE status = 'PENDING'` y todos
   sus efectos viven dentro de la rama que afecto una fila y en la misma transaccion. BullMQ entrega al
   menos una vez, de modo que la segunda entrega del mismo evento no reclama nada y no aplica nada.
4. Adquisicion de celdas. `claimCells` combina dos statements: `INSERT ... ON CONFLICT DO NOTHING ...
   RETURNING` para las celdas que aun no tienen fila, que devuelve exactamente las que esta transaccion
   inserto, y un `UPDATE ... WHERE ownerPlayerId IS NULL AND landUse = 'NONE' ... RETURNING` para las que
   ya la tenian. El llamante cobra lo devuelto y no lo pedido, con lo que dos compradores concurrentes de
   la misma celda pagan uno solo. `assignCellUse` sigue el mismo patron y devuelve ademas si la operacion
   fue completa, para que el llamante aborte toda la transaccion en lugar de dejar geometria parcial.

Las tres defensas frente al doble cobro de la seccion 6.3 del plan son independientes y se apoyan en
mecanismos distintos: la marca monotona del punto 2, la unicidad `(playerId, idempotencyKey)` del ledger
con claves deterministas, y la puerta de transicion del punto 3. La suite de integracion las ejercita por
separado.

Regla de reparto entre la aplicacion y la base de datos, que es la parte de esta decision que mas
consecuencias tiene: la restriccion declarativa es la red de seguridad y nunca el mecanismo de negocio.
Una violacion de `CHECK` levantada dentro de un trabajo de la cola produce reintentos indefinidos, de modo
que la aplicacion no delega en ella ningun caso previsible. `assertUseIdentifier` de
`modules/world/cellRepo.ts` es el ejemplo de la fase: comprueba antes del statement la misma condicion que
el `CHECK` intra-fila `world_cells_use_exclusivity_check` expresa, y lanza un `Error` corriente y no un
`ApiError`, porque llegar ahi es un defecto del modulo llamante y no algo que un jugador pueda provocar.

### Consecuencias

Ningun camino de escritura de esta fase necesita bloqueo explicito salvo la fila del jugador, que lo toma
por la razon de ADR-0017. Las carreras se resuelven en la fila que las dos transacciones tienen que tocar,
sin cerrojos, sin reintentos y sin aislamiento serializable.

El recuento de filas se convierte en un valor de dominio y hay que tratarlo como tal. Un `UPDATE` que
afecta menos filas de las pedidas no es un fallo tecnico: es una respuesta, y el llamante tiene que
decidir entre abortar la transaccion y continuar con lo obtenido. Esa decision es distinta para una compra
de tierra, que cobra lo adquirido, y para la asignacion de uso de un campo, que aborta.

Coste asumido: los tres caminos de escritura de celdas estan escritos en SQL crudo, porque el cliente
tipado no expresa `ON CONFLICT DO NOTHING ... RETURNING`. `createMany({ skipDuplicates })` no devuelve lo
que realmente inserto, que es precisamente el valor que una compra necesita. La mitigacion es que todo
valor viaja como parametro ligado y solo la lista de marcadores se construye, y se construye a partir de
un recuento; nada procedente de una peticion alcanza el texto del statement.

Segundo coste: la cota de celdas por escritura (`MAX_CELLS_PER_WRITE`, igual a `MAX_SELECTION_CELLS`) deja
de ser solo una regla de dominio y pasa a acotar tambien el numero de parametros ligados, tres por celda,
6.000 en el tope, holgadamente dentro de los 65.535 que PostgreSQL admite. Subir el tope de seleccion
obliga a revisar ese calculo.

### Alternativas descartadas

Leer y despues escribir, comprobando en memoria: es la forma natural de escribirlo y es exactamente la que
falla bajo concurrencia, porque las dos transacciones leen el mismo valor antes de que ninguna escriba.

`SELECT ... FOR UPDATE` sobre las filas implicadas en cada restriccion: da la garantia y multiplica los
bloqueos explicitos, con lo que reaparece el riesgo de interbloqueo que el orden canonico de ADR-0017
tiene que evitar, y a cambio de nada, porque la actualizacion condicional ya serializa a los escritores.

Cerrojo en Redis por recurso: la seccion 5 del plan lo excluye por principio. Un cerrojo distribuido sobre
una base de datos transaccional solo anade un modo de fallo.

Delegar el caso de negocio en la restriccion declarativa y capturar la excepcion: convierte un rechazo
previsible en una violacion, que dentro de un trabajo de la cola es un reintento indefinido, y en
PostgreSQL aborta ademas la transaccion entera, con lo que el manejador no puede ni leer para explicar el
fallo.

Restriccion `CHECK (balance >= 0)` para los fondos: incompatible con el devengo offline, que lleva el
saldo a negativo de forma legitima. Ya descartada en ADR-0009 y confirmada aqui desde el camino de
escritura.

---

## ADR-0019 — Sincronizacion del cliente por secuencia con reproduccion e instantanea

Fase: W3 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

El GDD hace del servidor la autoridad en su seccion 54 y describe en la 61 una interfaz que muestra saldo,
dia y estado en vivo. La seccion 7 del plan traduce eso a una sola regla: el cliente es una cache y nunca
una autoridad. Lo que hace falta decidir es como se detecta que la cache dejo de estar al dia, porque en
un juego asincrono un socket muerto en silencio es indistinguible de que no este pasando nada.

Un canal en vivo no puede ser el unico camino. Se pierden sobres al reconectar, un trabajo que corre muy
tarde o un barrido de reconciliacion tras una caida aplican decenas de eventos de un jugador en pocos
segundos, y el navegador puede tener dos pestanas. Hace falta por tanto un criterio con el que el cliente
sepa, sin preguntar, si lo que acaba de recibir se puede aplicar.

### Decision

Un numero de secuencia por jugador, y la regla que se deriva de el:

```text
seq = ultimo aplicado + 1   se aplica
seq <= ultimo aplicado      se descarta por duplicado
seq >  ultimo aplicado + 1  hay hueco: se reproduce, y si no alcanza, instantanea
```

En el servidor, la secuencia se asigna en un unico sitio, `backend/src/lib/events.ts`, incrementando la
fila del jugador dentro de la transaccion de dominio y bajo su bloqueo. Eso es lo que la hace sin huecos:
las filas de `game_events` se escriben en la misma transaccion que el estado que describen, de modo que un
cambio comprometido tiene siempre su sobre y un cambio revertido no lo tiene nunca.

Dos capas de almacenamiento con papeles distintos: `game_events` en PostgreSQL es autoritativa y de solo
insercion, protegida por disparador, y una lista acotada en Redis es el camino rapido de la misma
reproduccion, escrita despues del commit. Perder Redis cuesta una lectura de base de datos y nada mas.
`CLOCK` no llega a ninguna de las dos: es periodico, no describe ningun cambio de dominio, no consume
numero de secuencia y una restriccion de la base de datos lo rechaza.

Guarda de tormenta: cuando un vaciado del outbox produce mas de diez sobres para un jugador
(`MAX_LIVE_FRAMES_PER_FLUSH`), solo se publica el ultimo, que es el que lleva la secuencia mas alta.
Descartar un sobre del canal en vivo es seguro por diseno, porque la fila autoritativa ya esta escrita y
el cliente ve un hueco y reproduce con una sola peticion en lugar de recibir cientos de sobres. Lo que no
se hace nunca es suprimir el sobre antes de escribirlo.

En el cliente, el reductor tiene exactamente dos puntos de entrada y ningun tercero: `applyFrame` para un
sobre de WebSocket y `applyMutationReply` para el `result` de una ruta secuenciada. La respuesta mutante
se reduce por nombre de campo con una tabla, no con un `switch` por endpoint, de modo que anadir una ruta
secuenciada no obliga a tocar el reductor. Cada aplicador valida su valor con el esquema que lo describe,
que es a la vez como un `unknown` se convierte en fila tipada y como un nombre ambiguo no puede escribir en
la porcion equivocada.

Cuatro precisiones que la implementacion obligo a fijar:

1. La frontera entre reproducir y pedir instantanea es `oldestReplaySeq <= lastAppliedSeq + 1`. El anillo
   tiene que contener la primera trama que falta, no meramente solaparse con el rango pedido.
2. La respuesta de una ruta mutante se acepta con `seq > marca` y no con `seq === marca + 1`, porque una
   mutacion produce varias tramas y su `seq` es la de la ultima. Es admisible porque toda entidad del
   `result` es un reemplazo completo y no un delta, propiedad que ADR-0006 fijo en el contrato.
3. La regla de huecos se aplica tambien por chunk, con la misma forma y una consecuencia distinta: un
   `CHUNK_PATCHED` es un delta de las celdas modificadas, de modo que solo puede aplicarse sobre la version
   exacta que le precede, y cualquier otra cosa es una recarga del chunk. Adivinar dejaria al renderizador
   pintando una celda que ya no pertenece al campo dentro del que se dibuja.
4. `lastAppliedSeq` vive en el almacen `sync` y no en `net`, porque es una propiedad del reductor y no de
   la conexion. `net` la lee y no la escribe.

El estado optimista esta aislado en un almacen aparte, `pending`, indexado por clave de idempotencia, y
solo decora el renderizado: celdas en curso para el lienzo y controles inhabilitados con su motivo. Ningun
almacen de dominio se escribe antes de que el servidor responda, de modo que el pilar de servidor
autoritativo se sostiene tambien en la arquitectura del cliente.

`HELLO` lleva la secuencia actual y la mas antigua que el anillo conserva, de modo que reconexion y hueco
comparten camino en lugar de tener cada uno el suyo.

### Consecuencias

Descartar un sobre pasa a ser una operacion segura y no una perdida de datos, lo que permite que la guarda
de tormenta exista y que un barrido de reconciliacion tras una caida no inunde a nadie. Es la propiedad
que hace barata la recuperacion: una peticion en lugar de cientos de tramas.

El cliente no necesita razonar sobre el orden de llegada entre la respuesta de una mutacion y su eco por
WebSocket. Aplicar la respuesta y descartar despues el eco converge al mismo estado que el orden inverso,
porque toda entidad es reemplazo completo y los dos caminos pasan por los mismos aplicadores.

Coste asumido: la secuencia se incrementa en la fila del jugador, de modo que todo camino que emite un
sobre tiene que pasar por el bloqueo del jugador. Es el mismo punto de serializacion de ADR-0017 y refuerza
esa decision, pero significa que no existe la posibilidad de emitir un evento de dominio fuera de una
transaccion con bloqueo.

Segundo coste: la escalada a instantanea invalida los chunks cargados por el cliente, lo que en el peor
caso es una recarga visible del lienzo. Es aceptable porque solo ocurre cuando el anillo no cubre el hueco,
y el anillo del servidor simulado se dimensiono a 64 entradas precisamente para que ese camino se ejercite
en desarrollo en lugar de descubrirse en produccion.

Queda por vigilar una asimetria del contrato: `shared/ws/envelope.ts` declara `ping` del cliente y la union
de tramas del servidor no tiene ninguna etiqueta de acuse, aunque `WS_CLOSE_CODES.HEARTBEAT_TIMEOUT`
confirma que el corte por silencio esta previsto. El cliente lo resuelve midiendo trafico entrante de
cualquier tipo y tratando dos periodos de latido sin recibir nada como socket muerto. Si se prefiere una
etiqueta `PONG` explicita, es un cambio en `shared/ws/`, que esta congelado.

### Alternativas descartadas

Estado en vivo sin numero de secuencia, confiando en que el socket entrega todo: no hay forma de detectar
un hueco, de modo que una desincronizacion se manifiesta como una interfaz que muestra datos viejos sin que
nadie lo sepa. En un juego idle eso puede durar horas.

Deltas en lugar de reemplazos completos por entidad: reduce el trafico y obliga a que el orden de
aplicacion sea exacto, con lo que la respuesta de la mutacion y su eco dejan de ser conmutativos y hay que
razonar sobre el orden de llegada en cada panel.

Reproducir siempre desde la base de datos, sin anillo en Redis: correcto y mas lento en el caso que mas
importa, que es la reconexion breve. El anillo cubre ese caso sin ser autoritativo.

Escribir el estado de dominio de forma optimista y revertirlo si el servidor rechaza: es lo que hace la
mayoria de los clientes y contradice el pilar de la seccion 54 del GDD. Ademas, revertir un estado derivado
de reglas compartidas exige guardar el estado anterior de cada entidad tocada, que es un segundo modelo de
datos en el cliente.

Filtrar los sobres `CHUNK_PATCHED` por las suscripciones que el cliente declara: ahorraria trafico y abre
un hueco de secuencia deliberado, con lo que el cliente entra en resincronizacion, que cuesta mas que el
sobre que se ahorraria. Las suscripciones se registran y no filtran.

---

## ADR-0020 — Arte generado por codigo y paleta unica compartida con CSS

Fase: W3 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

La seccion 9.4 del plan fija que el proyecto no tiene ningun recurso grafico: todas las texturas se generan
al arrancar. El motivo es de alcance, no de estetica; producir arte es un trabajo que este proyecto no puede
hacer, y descargarlo introduce una dependencia de licencias y un presupuesto de red que el renderizado por
niveles de detalle no necesita.

La consecuencia es que la legibilidad pasa a ser un problema de color y de patron antes que de forma. La
seccion 60 del GDD exige que agua, bosque, montana, pradera, tierra en propiedad, campos, edificios,
maquinas y trabajadores sean claramente distinguibles, y que los estados agricolas y forestales se lean de
un vistazo. Con arte abstracto, eso obliga a una paleta deliberada.

Y esa paleta tiene dos consumidores que no comparten lenguaje: el lienzo de Phaser, que consume enteros de
24 bits para tintes y rellenos, y el DOM, que consume variables CSS en la leyenda, los paneles y las
insignias. Dos copias del mismo color divergen a la tercera modificacion, y el sintoma es que la leyenda
dice una cosa y el mapa muestra otra, que es peor que no tener leyenda.

### Decision

La paleta vive en un unico modulo de TypeScript, `frontend/app/game/textures/palette.ts`, y llega al CSS por
dos caminos y no por uno:

1. Un bloque generado dentro de `frontend/app/assets/tokens.css`, delimitado por los marcadores
   `fw-palette:start` y `fw-palette:end`. Es lo que se revisa como diferencia en el control de versiones y
   lo que colorea la interfaz antes de que el lienzo arranque.
2. `applyPaletteCssVariables`, que escribe esas mismas variables sobre el elemento raiz al arrancar el
   juego, y es el primer paso de la fabrica de texturas. Con eso, lo que leen los paneles en ejecucion es
   exactamente lo que se uso para dibujar las texturas, diga lo que diga la hoja de estilos.

Un tercer mecanismo cierra el circulo: `game/textures/__tests__/tokens-css.test.ts` compara el bloque del
fichero con la salida del generador, de modo que una edicion a mano o una reescritura que se lo lleve por
delante son un fallo de `make test-unit` con fichero y linea, y no una divergencia silenciosa. El DOM lee
cada token como `var(--fw-x, respaldo)`, de modo que un token renombrado degrada a un color legible en lugar
de a `unset`, que en CSS resuelve a `transparent` para un fondo y produce una pagina que parece vacia en vez
de rota.

Cinco decisiones mas, todas del mismo ambito:

- Separacion entre funcion pura y adaptador de Phaser. Todo lo que decide pixeles y todo lo que decide
  indices son funciones puras sobre `Uint8ClampedArray`, sin importar Phaser; el motor solo aparece en
  `factory.ts`, en las dos escenas de arranque y en `index.ts`. La consecuencia buscada es que la aritmetica
  de indices, la extrusion y el determinismo se afirman byte a byte en Vitest, sin lienzo ni contexto WebGL.
- Extrusion obligatoria en los dos atlas: tesela de 16 pixeles dentro de una celda de 18 con replicacion de
  borde, registrada con margen 1 y espaciado 2, que es la formula que Phaser aplica
  (`margen + columna x (tesela + espaciado)`). Sin ella el zoom fraccionario sangra la tesela vecina en la
  junta. Se comprueba dos veces: sobre el bufer en Vitest y sobre los pixeles de la textura ya subida en la
  ruta de inspeccion, que es la unica forma de cubrir el paso de subida.
- La legibilidad de los ocho estados del ciclo de cultivo se apoya en el patron y no en el color (surcos
  anchos, surcos finos, puntos, puntos verdes, trazos verticales, espigas, rastrojo), de modo que la lectura
  rapida que exige la seccion 60 del GDD no depende de distinguir dos tonos de marron. El progreso de
  crecimiento viaja como tinte, lo que mantiene una tesela por estado en lugar de una por tramo de progreso.
- Ningun `Math.random` en el arte. La variante de tesela de una celda sale del mismo hash entero, la misma
  semilla y la misma version de generador que el terreno, reutilizando `hashGrid` de `shared/world/terrain.ts`
  en lugar de reimplementarlo, de modo que el mosaico es estable entre sesiones y entre pestanas. El ruido
  interior de una textura sale de una semilla constante, porque las texturas se generan antes de conocer el
  mundo.
- Un paso de generacion que falla se registra y se salta, en lugar de abortar el arranque. Una textura
  ausente produce un marcador magenta en un sprite; una excepcion que escapa de la escena de precarga deja al
  jugador ante un lienzo en blanco sin explicacion. El informe lleva los fallos y la ruta de inspeccion
  `/texture-lab` los muestra.

El presupuesto de generacion es medido y publicado, no aspiracional: la ruta de inspeccion muestra el trabajo
de cada paso y el total frente al limite de 250 milisegundos. Se distinguen dos tiempos, el trabajo de los
pasos y el reloj de pared, porque la fabrica cede un fotograma entre pasos para que la barra de progreso se
presente de verdad. Medido en esta fase: 14,4 milisegundos de trabajo y 161 de reloj para 40 texturas.

### Consecuencias

No hay ningun recurso grafico en el repositorio y `PreloadScene` no hace ni una sola llamada al cargador de
Phaser. El arranque no depende de la red y no hay licencias de terceros que rastrear.

La leyenda deja de ser opcional y pasa a ser requisito de jugabilidad: con arte abstracto, un cuadrado ocre
no se explica solo. Por eso el panel de leyenda esta en el primer grupo y no en el ultimo.

El bloque de `tokens.css` es codigo generado dentro de un fichero que tambien contiene bloque escrito a mano.
La costura por marcadores funciono durante esta misma fase con dos agentes escribiendo el fichero a la vez, y
la prueba es lo que la sostiene a partir de ahora. Quien renombre un token tiene que regenerar el bloque, no
editarlo.

Coste asumido: la paleta publica quince variables mas de las que la interfaz declaro inicialmente (las ocho
de maquinaria, las cinco de edificio, `--fw-use-owned-foreign` y `--fw-canvas-void`), y los valores difieren
de los que el andamiaje traia, porque cada familia necesita en el lienzo mas de un tono y el token publica el
representativo. Son adiciones y cambios de valor, no renombrados, de modo que ningun consumidor se rompe.

Consecuencia para las fases siguientes: la generacion de texturas es un coste de arranque por carga de
pagina, y compite con el tiempo hasta la primera interaccion. El presupuesto de 250 milisegundos es
exigible porque esta instrumentado; anadir texturas sin mirarlo es como se pierde.

### Alternativas descartadas

Recursos graficos en PNG, aunque fueran generados una vez y versionados: introduce descarga en el arranque,
un paso de construccion que produce binarios en el repositorio y la posibilidad de que el atlas y el codigo
que lo indexa dejen de coincidir. El determinismo se pierde justo donde interesa, que es la correspondencia
entre indice de tesela y significado.

Paleta duplicada en CSS y en TypeScript, sincronizada a mano: es la variante que falla en silencio. La
divergencia no rompe nada, solo hace que la leyenda mienta.

Generar el CSS en ejecucion y no publicar bloque en el fichero: el DOM quedaria sin color hasta que Phaser
arranque, con lo que la pantalla de autenticacion y cualquier panel abierto antes del lienzo se veria sin
estilo. Por eso los dos caminos y no uno.

Atlas sin extrusion, confiando en el filtrado nearest: el sangrado aparece solo a zoom fraccionario, que es
justo lo que la camara de la seccion 9.5 del plan usa, y se diagnostica tarde y mal.

`Math.random` para elegir la variante de tesela: el mosaico cambiaria en cada carga y entre dos pestanas del
mismo jugador, lo que destruye la sensacion de lugar de un mundo persistente y hace inutil cualquier captura
de pantalla comparativa.

Abortar el arranque cuando falla un paso de generacion: convierte un defecto cosmetico en una pantalla en
blanco sin mensaje, que es peor tanto para el jugador como para quien depura.

---

## ADR-0021 — Modulo de mundo: caches de clave inmutable, lectura por lote y escritura por SQL crudo

Fase: W3 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

ADR-0010 fijo el modelo de persistencia procedural: solo existen como fila las celdas modificadas, el chunk
lleva un contador de version y el terreno generado se reproduce desde la semilla. Lo que esa entrada no
decide es como se sirve, porque en W2 no habia servidor.

El modulo `world` del backend, 2.125 lineas, es la pieza que lo resuelve, y ademas es la unica que cuatro
modulos posteriores (tierra, granjas, campos y silvicultura) van a consumir para tocar la rejilla. Si cada
uno escribiera su propia lectura de "terreno efectivo" o su propia actualizacion condicional, dos llamantes
acabarian discrepando sobre si un bosque desmontado es cultivable.

El agente que lo escribio (W3-B) termino justo antes de la parada del flujo de trabajo y no dejo fichero de
traspaso, aunque el codigo cita `docs/handoff/NOTES-w3b.md` en cinco puntos. Esta entrada documenta sus
decisiones leyendo el codigo, y recoge al final las dos que quedan pendientes de resolver fuera del modulo.

### Decision

El modulo se divide en cinco piezas con una responsabilidad cada una: el generador con su cache
(`generator.ts`), el repositorio de la capa de modificaciones (`cellRepo.ts`), el asignador de origen
(`spawn.ts`), la API interna que consumen los modulos de dominio (`service.ts`) y la superficie HTTP
(`routes.ts`), deliberadamente delgada.

Caches. Hay dos, y las dos tienen la misma propiedad: la clave lleva todo lo que puede cambiar el valor, de
modo que una entrada nunca puede volverse incorrecta y no hay nada que invalidar.

- Terreno: `...:world:terrain:<semilla>:<versionGenerador>:<chunkX>:<chunkY>`. El terreno es inmutable para
  esa terna; ajustar `TERRAIN_NOISE` obliga a incrementar `GENERATOR_VERSION`, lo que cambia todas las
  claves a la vez y deja las antiguas sin referencias. Delante hay un mapa de 512 chunks por proceso, que
  son 512 KiB y quedan por encima del conjunto de trabajo de un jugador.
- Capa de modificaciones: `...:world:overlay:<mundo>:<chunkX>:<chunkY>:<version>`. Al modificar una celda se
  incrementa la version, con lo que la clave es nueva y no hay carrera entre invalidar y repoblar.

Ambas llevan expiracion, siete dias y seis horas respectivamente, y eso es desalojo y no invalidacion: el
valor es reproducible, de modo que una clave expirada cuesta una regeneracion o una consulta, mientras que
una cache sin expiracion crece con el area que cualquier jugador haya mirado y no tiene techo. Una entrada
de longitud incorrecta se trata como fallo de cache y se sobrescribe, que es la unica lectura segura.

Un fallo de Redis no es nunca un fallo de peticion. El generador y PostgreSQL son la fuente de verdad y la
cache es una optimizacion, de modo que cada rama de Redis contabiliza el fallo, lo registra y continua. Los
contadores (`memoryHits`, `redisHits`, `misses`, `redisFailures`, `overlayHits`, `emptyChunks`,
`unchangedChunks`) son parte del contrato del modulo y las pruebas los afirman.

Lectura por lote. Una peticion de cincuenta chunks cuesta un statement para las versiones, un statement para
la capa de modificaciones de los que no estan cacheados y un viaje a Redis para el lote entero, nunca uno
por chunk. `hasStandingTree` se resuelve con un `EXISTS` sobre `trees` dentro del mismo statement, que es lo
que mantiene la cuenta en uno. Un chunk sin fila se responde con version 0 y sin celdas, sin consultar nada:
`world_cells` tiene clave ajena a `chunks`, de modo que la ausencia de la fila demuestra que no hay
modificaciones.

Escritura en SQL crudo, y solo donde el cliente tipado no expresa lo que hace falta: `ON CONFLICT DO
NOTHING` con `RETURNING`, que es lo que permite cobrar lo adquirido y no lo pedido (ADR-0018).
`createMany({ skipDuplicates })` no devuelve lo que inserto. Todo valor viaja como parametro ligado y solo
la lista de marcadores se construye, a partir de un recuento; nada procedente de una peticion alcanza el
texto del statement. El identificador se aporta desde la aplicacion porque `@default(uuid(7))` lo genera el
cliente de Prisma 7 y la columna no tiene `DEFAULT`.

Cuatro decisiones mas del modulo:

1. El terreno no viaja en ninguna respuesta. `POST /api/world/chunks` lleva la capa de modificaciones y la
   version, y el cliente ejecuta el mismo generador determinista, byte a byte. Un chunk es renderizable en
   cuanto se conoce la semilla.
2. `effectiveTerrain` es la unica definicion de la palabra "efectivo" en el backend: la sobreescritura si
   existe, el terreno generado si no. Un llamante que leyera `generatedTerrain` directamente trataria un
   bosque desmontado como bosque y se negaria a ararlo.
3. Las versiones de chunk se incrementan en orden ascendente de identificador, que es el paso 3 del orden
   canonico de bloqueos de ADR-0017, de modo que dos transacciones que editen los mismos dos chunks en
   orden de peticion opuesto no pueden interbloquearse.
4. El asignador de origen exige el bloqueo del mundo en la firma, porque el indice de jugador solo es
   estable bajo el, y comprueba ademas contra los origenes ya persistidos. Cuando la comprobacion falla se
   avanza el indice y no se desplaza el origen, de modo que el resultado sigue siendo un valor que el
   asignador puro puede reproducir desde la semilla y un entero. La funcion es total: un origen por debajo
   de la superficie minima se informa con `meetsMinimum` y no se rechaza, porque un registro que falla es
   peor para el jugador que un origen mediocre.

Tanto la cache de terreno como el repositorio se obtienen con un `WeakMap` indexado por contexto de
servicio, y no como singleton de modulo: dos aplicaciones construidas en el mismo proceso, que es lo que
hace la suite de integracion, no deben compartir contadores ni cache, y la entrada desaparece con el
contexto en lugar de fijarlo en memoria.

### Consecuencias

Los cuatro modulos de dominio de W4 y W6 tienen una unica puerta de entrada a la rejilla, con la validacion
apoyada en `shared/rules/selection.ts`, que es la misma funcion que el cliente usa para pintar en verde. El
resaltado y el rechazo no pueden discrepar por construccion.

La clase entera de errores de invalidacion de cache no existe en este modulo. No hay camino "invalidar y
repoblar", con lo que no hay carrera entre ambos, y una entrada obsoleta simplemente deja de ser consultada.
La contrapartida es que Redis acumula entradas de versiones superadas hasta que expiran, que es el motivo de
que las dos expiraciones existan.

Coste asumido: hay SQL escrito a mano en los tres caminos de escritura y en la lectura de la capa de
modificaciones, con nombres de columna literales. Un renombrado en `schema.prisma` no lo detecta el
compilador, solo las pruebas de integracion. Es el precio de `RETURNING` y del `EXISTS` embebido.

Segundo coste: `chunkPatchesFor` se llama dentro de la transaccion que acaba de escribir. Es seguro porque
la version ya se incremento y la clave de cache es por tanto nueva, y porque si la transaccion revierte, la
entrada escrita queda bajo una version que el chunk no alcanza nunca, es decir inalcanzable en lugar de
incorrecta. Conviene tenerlo presente antes de cachear cualquier otra cosa dentro de una transaccion.

Dos pendientes que este modulo no puede resolver, ambos sobre `eslint.config.js`, que es fichero congelado:

- Las zonas de ESLint prohiben toda importacion entre modulos hermanos del backend, no solo entre hermanos
  de la misma fase, de modo que `modules/land` no puede importar `modules/world/service.ts` tal como esta.
  La resolucion es un `except: ['./world']` en `siblingModuleZones` o mover el fichero a `lib/`, que es lo
  que W3-A tuvo que hacer con `lib/playerView.ts` por la misma razon. Lo aplica W7-A.
- Por el mismo motivo, `modules/auth/service.ts` no llama a `assignAndPersistSpawn` sino que invoca
  directamente el asignador puro `assignSpawn` con el mismo indice. Los dos caminos producen el mismo
  origen; lo que solo tiene el del modulo de mundo es la comprobacion contra los origenes ya persistidos.

### Alternativas descartadas

Cachear con invalidacion explicita al modificar una celda: es lo habitual y reintroduce la carrera entre
invalidar y repoblar, que es precisamente la clase de error que la version en la clave elimina.

Cache sin expiracion, apoyandose en que una entrada nunca es incorrecta: correcto en cuanto a correccion y
sin techo en cuanto a memoria, porque cada version superada de cada chunk se quedaria para siempre.

Tratar un fallo de Redis como fallo de la peticion: convierte una cache en una dependencia dura y hace que
una incidencia de Redis pare el juego, cuando el dato es reproducible en microsegundos.

Una consulta por chunk, que es lo que sale de escribir el caso simple y repetirlo: cincuenta chunks son
cincuenta viajes, y el caso de carga del cliente (anillo de prefetch y descarga con histeresis) pide
precisamente lotes.

Segunda consulta para los arboles en pie en lugar del `EXISTS` embebido: duplica el numero de statements del
camino mas frecuente del renderizador para obtener el mismo dato.

Enviar el terreno generado en la respuesta del chunk: multiplica el trafico de un dato que el cliente
calcula y crea una segunda fuente de verdad. Ya descartada en ADR-0010 y confirmada aqui por la
implementacion.

Rechazar el registro cuando el origen no alcanza la superficie minima: un fallo durante el registro es peor
que un origen pequeno, y la funcion dejaria de ser total sin que nadie sepa que hacer con el error.

---

## ADR-0022 — El servidor simulado del cliente como transporte derivado del contrato

Fase: W3 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

La seccion 9 del plan exige un servidor simulado con el que desarrollar los paneles sin la pila levantada, y
ADR-0006 ya lo declaro cuarto consumidor del mapa de rutas, junto al registro de Fastify, al cliente tipado
y a la documentacion OpenAPI. El motivo es el que esa entrada enuncio: un servidor simulado que no derive de
los mismos esquemas no simula el contrato, simula lo que su autor recordaba del contrato.

Lo que W3 tiene que decidir es donde se enchufa. Quince paneles de tres flujos de trabajo distintos (W4-E,
W5-F y W6-D) se van a desarrollar contra el, y la mitad de la superficie del backend no existira hasta W6.
Si el mecanismo de sustitucion se puede sortear, alguna llamada acabara yendo a la red real y el panel que
la haga fallara de una forma que no se parece a nada.

### Decision

El servidor simulado es un transporte, no un `fetch` parcheado. Hay exactamente dos costuras y ningun
objeto global sustituido: `setHttpTransport` en `net/transport.ts` y `setWsSocketFactory` en `net/ws.ts`.

Son suficientes porque nada del cliente construye un `fetch` ni un `WebSocket` propio: todas las peticiones
pasan por el cliente tipado derivado de `API_ROUTES` y toda conexion pasa por `net/ws.ts`. Y no se pueden
sortear por la misma razon.

La tabla de manejadores esta indexada por `ApiRouteKey`, de modo que una ruta anadida al contrato sin
manejador es un error de compilacion y no un 404 que descubre un panel en ejecucion. El emparejamiento de
URL recorre `routeDefinitions()`, igual que el registro de Fastify, con los segmentos literales antes que
los marcadores, para que `POST /api/fields/merge` no case con `POST /api/fields/:fieldId/extend`.

Cuanto comportamiento tiene cada manejador es un gradiente deliberado y no una omision:

- Simulado de verdad donde un panel necesita reglas: presupuesto y compra de tierra con motivo por celda,
  creacion, ampliacion, division y fusion de campo, colocacion y retirada de edificio con la huella del
  catalogo, compra, venta y reparacion de maquina con la plaza de garaje y el taller como restricciones,
  contratacion y despido con la plaza de vivienda, prevision y creacion de tarea con reserva de trabajador y
  maquinaria, cancelacion con liberacion, venta de mercado con movimiento de existencias y de saldo, y carga
  de chunks con version y respuesta `unchanged`.
- Coherente y sin simular lo que ningun panel lee: el resumen de regreso, el libro mayor paginado, la
  creacion de parcela forestal y las cuatro rutas de desarrollo.

Dos invariantes se cumplen en todos los manejadores: una ruta mutante emite sus tramas antes de construir la
respuesta y responde con la secuencia de la ultima, de modo que el cliente ejercita el mismo camino que
contra el servidor real; y ninguna respuesta se escribe con un literal alli donde una regla compartida puede
producirla. El mundo de ejemplo deriva el origen de `assignSpawn`, las capacidades de `BUILDING_CATALOGUE`,
los precios de `MACHINE_CATALOGUE` y `CROPS`, el salario de la regla procedural de la seccion 102 del GDD y
las fases del arbolado de `PINE`.

El socket simulado implementa `WsSocketLike` y nada mas, de modo que la reconexion, el latido y la regla de
secuencia de `net/ws.ts` corren sin cambios contra el. Su anillo de reproduccion tiene capacidad 64 a
proposito: la escalada de reproduccion a instantanea solo ocurre cuando el anillo no alcanza, y un anillo que
nunca truncase dejaria sin ejercitar el camino mas delicado del cliente (ADR-0019).

Activacion, en orden de precedencia: `VITE_FARM_WORLD_MOCK=1`, `?mock=1` en la URL o `farm-world.mock` en
`localStorage`. La segunda es la que usa un agente de paneles, porque no exige reiniciar el servidor de
desarrollo y sobrevive a una recarga; `?mockSession=1` arranca con sesion abierta.

### Consecuencias

Los tres grupos de paneles se pueden escribir y probar sin PostgreSQL, sin Redis y sin backend, contra una
superficie que no puede desviarse del contrato porque deriva de el. Una prueba de componente lo instala sin
tocar el entorno del proceso.

El servidor simulado es un consumidor mas del contrato, con la consecuencia buscada: anadir un campo
obligatorio a una peticion rompe su compilacion a la vez que la del cliente y la de las pruebas de contrato.

Coste asumido y real: el cliente no puede usar `$fetch` ni `useFetch` de Nuxt en ningun sitio. Es una
renuncia a ergonomia del framework, y es de todos modos necesaria para que el cliente tipado sea el unico
camino a la API.

Segundo coste: hay una segunda implementacion del dominio que mantener. Se acota con el gradiente descrito
(solo se simula de verdad lo que un panel necesita para decidir) y con la regla de no escribir literales
donde exista una regla compartida, pero sigue siendo codigo que envejece si el backend real cambia de
comportamiento sin cambiar de contrato. La mitigacion estructural es que la parte que mas importa, la de
las reglas, es la misma funcion en los dos lados.

Queda una asimetria documentada: `shared/api/__tests__/fixtures.ts` no llega al cliente, porque el script de
sincronizacion excluye `__tests__/` a cualquier profundidad, que es lo que la seccion 4 del plan exige para
que las suites corran solo sobre el origen. `frontend/app/mock/world.ts` construye los suyos desde los
catalogos, que son datos mas ricos y coherentes entre si; el apartado 8 de `shared/api/README.md` dice otra
cosa y conviene corregirlo cuando W7 abra ese fichero.

### Alternativas descartadas

Parchear `fetch` global, o instalar un interceptor de red del tipo de MSW: funciona y depende de un objeto
global, con lo que una prueba lo deja instalado para la siguiente, y cualquier llamada directa a `fetch`
desde un panel lo sortea sin que nada lo impida.

Levantar una segunda instancia real del backend con base de datos en memoria: no existe tal base de datos
para PostgreSQL con los disparadores y las restricciones que este esquema usa, y el objetivo era
precisamente desarrollar paneles sin pila.

Fixtures estaticos por panel: no ejercitan el reductor, ni la regla de secuencia, ni la escalada a
instantanea, que son las tres piezas del cliente donde estan los errores dificiles. Un panel probado contra
un fixture pasa a estar probado contra la opinion de su autor.

Desarrollar los paneles solo contra la pila real: obliga a que todos los modulos de dominio existan antes que
cualquier panel, lo que serializa cuatro flujos de trabajo que el plan paraleliza a proposito.

---

## ADR-0023 — Dos niveles de detalle en el renderizado: tilemap por chunk y miniatura por chunk

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

ADR-0012 fijo la escala: una celda son 10 x 10 m, un chunk 32 x 32 celdas y a zoom 1 una celda ocupa 16
pixeles. De esas tres cifras sale el caso de carga que decide el diseno del renderizador y que la seccion
9.3 del plan enuncia: a zoom 1 hay unas 8.100 celdas visibles en una ventana de 1920 x 1080, y a zoom 0,25
son unas 130.000. Un cuadrilatero por celda es viable en el primer caso e imposible en el segundo, y el
mundo es virtualmente infinito, de modo que no existe un tamano maximo que permita precalcular nada.

El presupuesto que el plan declara es de unos 110 draw calls y 8.000 cuadrilateros a zoom 1, con una ruta
de desarrollo dedicada a medirlo. Un presupuesto que no se mide no es un presupuesto, y el material de
partida no dice como se renderiza: el GDD describe el mundo (§5 a §12) y no la tecnica.

Lo que esta entrada decide es como se dibuja un chunk, no que dato lo describe. El dato lo fijaron ADR-0010
y ADR-0021: la capa de modificaciones viaja por `POST /api/world/chunks` y el terreno se reproduce desde la
semilla.

### Decision

Dos caminos de dibujo alimentados por la misma estructura de datos, con el umbral en zoom 0,4
(`NEAR_LOD_MIN_ZOOM` de `frontend/app/game/world/config.ts`). Ningun paso de zoom cae sobre el umbral:
0,35 es lejos y 0,5 es cerca, de modo que cruzarlo es siempre un cambio real de paso y nunca el resultado
de una comparacion de coma flotante.

- Cerca, zoom mayor o igual que 0,4: un `Tilemap` de Phaser por chunk, con dos capas sobre dos unicos
  atlas generados por codigo (ADR-0020). La capa base es el terreno, con cuatro variantes por tipo
  elegidas por hash de la coordenada; la capa de uso es que es la celda: propiedad, los ocho estados de
  `cropCycleState` (GDD §76), huella de edificio, parcela forestal y pendiente de confirmacion. El
  progreso de crecimiento se transmite con tinte y no con mas teselas.
- Lejos, zoom menor que 0,4: una miniatura de 32 x 32 pixeles por chunk, un pixel por celda, escrita de
  una sola vez y dibujada como un unico cuadrilatero escalado con filtrado nearest. Son cuatro kilobytes
  por chunk. La misma miniatura alimenta el minimapa, de modo que no hay un segundo camino de datos sino
  un segundo consumidor del primero.

Cuatro decisiones que acompanan a la anterior y sin las cuales no se sostiene:

1. Lo que se difiere es el objeto del motor, no el dato. Los indices de tesela y los pixeles de la
   miniatura se calculan al cargar el chunk, desde el mismo `WorldChunkView`; el tilemap se crea la
   primera vez que el chunk se dibuja de cerca y la textura de la miniatura la primera vez que se dibuja
   de lejos. Una vez creados, ninguno se destruye mientras el chunk viva, de modo que cruzar el umbral
   conmuta visibilidad y no reconstruye nada.
2. La construccion de la mitad que falta esta acotada por tick, en doce chunks
   (`MAX_LEVEL_UPGRADES_PER_TICK`), y solo para chunks visibles. La constante es propia y esta separada
   del techo de 32 cargas por tick de la seccion 9.5 del plan, porque acotan cosas distintas.
3. La tesela vacia de la capa de uso es el indice -1 y no la tesela transparente del atlas. El descarte de
   Phaser omite una tesela con indice -1 y batea una transparente: sobre un chunk sin modificar, que es la
   mayor parte de un mundo virtualmente infinito, es la diferencia entre 1.024 cuadrilateros y ninguno.
4. Los contornos de propiedad, de campo y de huella se extraen a nivel de escena y no por chunk,
   agrupados por sujeto, con `borderSegments` de `shared/rules/geometry.ts`, que es la misma funcion que
   usa el servidor.

El presupuesto se mide en `/perf` con un banco propio (`game/world/bench.ts`) que publica, junto a cada
cifra, el zoom con el que midio y los fotogramas que dio el motor.

### Consecuencias

El presupuesto se cumple con holgura y las cifras son medidas, no estimadas. Con Chrome 1920 x 1080 sobre
Intel Iris Xe:

| Medida | Presupuesto | Medido |
|---|---:|---:|
| Zoom 1, 52 chunks cargados, 10 visibles | 55 fps, 130 draw calls | 59,1 fps, 2 draw calls, 17.920 cuadrilateros |
| Zoom 0,25, 214 chunks cargados, 112 visibles | 55 fps, 220 draw calls | 60,1 fps, 8 draw calls, 112 cuadrilateros |
| Carga de un chunk, cerca / lejos | 4 ms | 0,14 ms / 0,06 ms de media |
| Parcheo de 250 celdas | 2 ms | 0,49 ms de media |
| Conmutacion de nivel de detalle | no reconstruir | 36 mitades sobre 64 chunks recargados, ninguna dos veces |

El margen en draw calls es de un factor quince y el motivo conviene registrarlo: el nivel cercano dibuja
dos capas de tilemap por chunk sobre dos unicas texturas y el lote multitextura de Phaser las agrupa, de
modo que ocho chunks visibles son dos llamadas de dibujo y no dieciseis. El nivel lejano dibuja una
miniatura por chunk, cada una con su textura, y ahi si aparece aproximadamente una llamada cada catorce
chunks.

Coste asumido y vigilado: el tick de streaming al nivel lejano mide 31,05 ms de media y 35,10 de maximo
frente a un presupuesto de 33 ms. El coste esta casi entero en crear la textura de lienzo de una miniatura
y subirla a la GPU, unos 1,9 ms por chunk, y no baja optimizando el codigo que la rodea porque no es
codigo. La via de salida, si algun dia estorba, es un atlas rodante de miniaturas de 512 x 512 donde el
chunk `(cx, cy)` ocupa el bloque `(cx mod 16, cy mod 16)`; el coste de esa opcion es que la miniatura de un
chunk fuera de la ventana de 16 x 16 deja de existir, lo que hay que contrastar con lo que necesite el
minimapa. Mientras tanto, bajar `MAX_LEVEL_UPGRADES_PER_TICK` es el ajuste inmediato en una maquina mas
lenta.

Segundo dato del entorno, para quien repita la medida: en Chrome sin cabeza el renderizador es SwiftShader,
es decir rasterizacion por software, y la tasa de fotogramas cae a 10-25 en el caso cercano mientras draw
calls, tiempos de carga, parcheo y memoria salen iguales. Un borrado de pantalla completa alcanza 59 fps en
ese mismo entorno, de modo que lo que se agota es el relleno de pixeles de la CPU y no el diseno. Y con la
ventana fuera de pantalla hay que forzar `Page.setWebLifecycleState('active')` o el navegador deja de
entregar fotogramas, lo que produce informes que parecen plausibles midiendo otra cosa.

El recuento de cuadrilateros que publica el contador es una cota superior: cuenta todas las teselas de los
chunks visibles y Phaser descarta por celda las que caen fuera del encuadre.

### Alternativas descartadas

Un unico tilemap gigante para todo el mundo cargado, en lugar de uno por chunk: el ciclo de vida del objeto
dejaria de coincidir con el de carga y descarga de datos, y habria que asignar cientos de miles de objetos
de tesela para una region que ademas cambia de forma continuamente.

Un cuadrilatero por celda tambien en el nivel lejano: son unas 130.000 celdas visibles a zoom 0,25, dos
ordenes de magnitud por encima del presupuesto.

Destruir la mitad no usada al cruzar el umbral, que es lo que ahorra memoria: convierte cada cruce en una
reconstruccion completa, que es exactamente la propiedad que el plan protege al pedir que los dos caminos
esten vivos a la vez.

Construir la mitad que falta para todos los chunks vivos en el fotograma del cruce: medido, con 200 chunks
son 200 texturas en un solo fotograma y el bucle del motor se detiene.

Crear el tilemap tambien para los chunks que solo se ven de lejos: un tilemap son 2.048 objetos de tesela y
el caso lejano del brief tiene 200 chunks, es decir 409.600 objetos para algo que a cuatro pixeles por
chunk nadie ve.

Usar la tesela transparente del atlas para la celda sin uso: correcta visualmente y con 1.024 cuadrilateros
por chunk de coste, sobre chunks que en su inmensa mayoria no tienen ninguna modificacion.

Extraer los contornos por chunk: ademas de mas lento es incorrecto, porque un campo que cruza la frontera
de dos chunks mostraria una costura donde sus mitades se encuentran. Y agrupar todas las celdas visibles en
un unico conjunto borraria la frontera entre dos campos adyacentes, porque el contorno de un conjunto es el
conjunto de aristas cuyo vecino esta fuera de el.

Declarar el presupuesto sin medirlo, que es la opcion por omision: durante esta fase hubo ejecuciones que
declaraban zoom 1 mientras median el nivel lejano, y ejecuciones cuya tasa de fotogramas era la del
temporizador de respaldo del propio banco. Publicar el zoom medido y los fotogramas del motor junto a cada
cifra es lo que las hace comprobables.

---

## ADR-0024 — Cache de chunks en el cliente con la version en la clave y terreno generado localmente

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

ADR-0010 fijo la persistencia procedural y ADR-0021 la resolvio en el servidor: solo existen como fila las
celdas modificadas, el chunk lleva un contador de version, las dos caches del backend llevan la version en
la clave y `POST /api/world/chunks` responde `unchanged` a un cliente al dia. Lo que ninguna de las dos
entradas decide es el lado del cliente, porque en W3 no habia escena.

El cliente tiene un problema que el servidor no tiene: mantiene ademas objetos del motor por chunk
(ADR-0023), que son caros de construir y que deben desaparecer exactamente cuando desaparece el dato. Un
chunk retenido por la cache y olvidado por la escena, o al reves, es una fuga que ademas se ve, porque la
version que el renderizador cree tener deja de ser la que el reductor actualiza.

La otra restriccion la pone la seccion 7 del plan: el cliente es una cache y nunca una autoridad. Las
actualizaciones en vivo llegan como `CHUNK_PATCHED` con la misma regla de huecos por secuencia que el resto
del estado (ADR-0019).

### Decision

El terreno no viaja por la red. El cliente ejecuta el mismo generador determinista de `shared/world/` sobre
la semilla y la version de generador que `GET /api/world/info` publica, y pide al servidor unicamente la
capa de modificaciones. Un chunk es renderizable en cuanto se conoce la semilla, y la unica parte que tiene
revision es la que de verdad cambia.

La entrada de cache lleva la version del chunk. Un `CHUNK_PATCHED` con version n+1, o una respuesta del
lote con una version mayor, produce una entrada nueva en lugar de invalidar la anterior, exactamente como
en el servidor: no hay camino "invalidar y repoblar" y por tanto no hay carrera entre ambos. Una respuesta
`unchanged` confirma la entrada que ya se tiene y no cuesta nada.

Cuatro decisiones de ciclo de vida, que son las que hacen que lo anterior no se convierta en una fuga:

1. La cache decodificada y las vistas de la escena tienen un unico ciclo de vida. Cuando el streamer
   descarta un chunk llama a `evictChunk` del origen (`WorldSource`), de modo que el dato y los objetos del
   motor mueren juntos.
2. Cache LRU de 256 chunks decodificados (`CHUNK_CACHE_CAPACITY`), para que volver sobre lo ya visto sea
   instantaneo.
3. Un chunk que la camara necesita nunca se desaloja, aunque la cache este por encima de su capacidad. La
   capacidad cede, no la imagen: el desalojo por antiguedad salta lo protegido y toma el siguiente
   candidato, y si todo lo excedente esta protegido no desaloja nada.
4. Histeresis de dos anillos: anillo de prefetch de un chunk (`PREFETCH_RING_CHUNKS`) y umbral de descarga
   de tres (`UNLOAD_RING_CHUNKS`). Un chunk entre los dos anillos ni se carga ni se descarta, que es lo que
   impide que una camara apoyada sobre una frontera de chunk cargue y descargue el mismo chunk en tics
   alternos. Las peticiones se ordenan por distancia a la camara y estan acotadas en 32 por tick
   (`MAX_CHUNK_LOADS_PER_TICK`, seccion 9.5 del plan).

La escena no importa ningun almacen de Pinia: lee por el puerto `WorldSource`, que `createStoreWorldSource`
implementa declarando la forma del almacen de manera estructural. Es lo que exige la regla de zona de
`eslint.config.js` y lo que permite que las suites de la escena corran sin Phaser y sin Pinia.

### Consecuencias

La clase entera de errores de invalidacion de cache tampoco existe en el cliente, por el mismo motivo que
en el servidor, y las dos mitades del sistema comparten la propiedad en lugar de tener cada una su propia
politica.

El trafico de un chunk es solo su capa de modificaciones. En un mundo cuya mayor parte no esta modificada,
la respuesta habitual es una lista vacia y una version.

Memoria medida tras recorrer 10.016 chunks con la camara: las texturas vivas pasan de 162 a 142 y el
monticulo de 136,7 MB a 197,3 MB, es decir estable y no creciente con el area recorrida, que es lo que la
combinacion de LRU y ciclo de vida unico tenia que demostrar.

Coste asumido: el cliente ejecuta el generador, lo que traslada trabajo de CPU al navegador. Medido, la
carga completa de un chunk (generacion, decodificacion, indices de tesela y pixeles de miniatura) es de
0,14 ms de media en el nivel cercano y 0,06 ms en el lejano, frente a un presupuesto de 4 ms.

Consecuencia que hay que vigilar en las fases siguientes: la version del generador y el tamano de chunk
forman parte de la clave de correccion, no solo de la de cache. Si el arranque del servidor aborta porque
las constantes no coinciden con lo persistido (ADR-0010), el cliente tiene que enterarse por
`GET /api/world/info` y no por una discrepancia visual.

### Alternativas descartadas

Enviar el terreno generado en la respuesta del chunk: multiplica el trafico de un dato que el cliente
calcula en microsegundos y crea una segunda fuente de verdad sobre el mismo hecho. Ya descartada en
ADR-0010 y confirmada aqui por la implementacion.

Cachear con invalidacion explicita al recibir un parche: es lo habitual y reintroduce la carrera entre
invalidar y repoblar, que es precisamente la clase de error que la version en la clave elimina.

Cache sin capacidad, apoyandose en que una entrada nunca es incorrecta: correcto en cuanto a correccion y
sin techo en cuanto a memoria, porque cada chunk que cualquier recorrido haya tocado se quedaria vivo.

Desalojar estrictamente por antiguedad, sin proteger lo visible: con la cache llena, una camara que se
mueve deprisa desalojaria chunks que esta a punto de dibujar, produciendo huecos visibles y una recarga
inmediata del mismo dato.

Un unico anillo, cargando y descargando en la misma frontera: produce vaiven al desplazarse a lo largo de
un borde de chunk, que es el caso mas frecuente al inspeccionar una parcela.

Que la escena lea directamente los almacenes de Pinia: ademas de estar prohibido por la zona de ESLint,
ataria las suites del renderizador a Pinia y haria imposible el banco de medida con un origen sin red.

---

## ADR-0025 — Geometria de campos: clave ajena en la celda y contiguidad por recorrido en anchura

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

El GDD describe el campo como un conjunto de celdas contiguas de forma arbitraria (§16 y §17), que puede
cruzar fronteras de chunk (§18), y define cuatro operaciones sobre su geometria: creacion (§19), ampliacion
(§20), division (§21) y fusion (§22). La seccion 15 anade que una celda tiene un uso y solo uno.

La seccion 5.2 del plan fijo el modelo antes de que existiera el modulo: clave ajena `fieldId` en la celda
y no un array de celdas en el campo, y contiguidad validada con recorrido en anchura sobre el conjunto
seleccionado, acotado por el mismo tope de 2.000 celdas que aplica el cliente y con la funcion compartida.
`schema.prisma` lo implemento en W2. Lo que esta entrada decide es lo que la implementacion del modulo
obligo a fijar: como se escribe esa geometria sin dejar estados parciales, y en que estados del ciclo se
admite cada operacion.

La restriccion `fields_geometry_check` de la migracion inicial exige `cellCount > 0`.

### Decision

La celda es la que apunta al campo. `world_cells.fieldId` mas `landUse = FIELD` es la unica
representacion de la geometria; `Field.cellCount` es un contador derivado que se mantiene junto a ella y
que el modelo de lectura publica sin recorrer celdas.

La contiguidad se valida con `isContiguous` de `shared/rules/geometry.ts`, que es un recorrido en anchura
acotado (`boundedBreadthFirst`) desde una celda cualquiera del conjunto, comparando el numero de celdas
alcanzadas con el tamano del conjunto. La cota no es una optimizacion: es el mismo tope de 2.000 celdas que
el cliente aplica al arrastrar, y es lo que impide que una peticion mal formada recorra una region
ilimitada de un mundo virtualmente infinito. La funcion es la misma en los dos lados, de modo que la forma
que el cliente pinta como valida y la que el servidor acepta no pueden divergir.

La escritura de la geometria es una actualizacion condicional con recuento de filas y nunca una lectura
seguida de una escritura. `assignCellUse` del modulo de mundo actualiza las celdas cuyo propietario es el
jugador y cuyo uso esta en la lista de origen admitida —`OWNED` al crear o ampliar, `FIELD` al liberar— y
devuelve cuantas filas cambiaron. Si el recuento no coincide con el numero de celdas pedidas, el modulo
lanza `CELL_IN_USE` y la transaccion entera revierte, de modo que no queda geometria parcial. Es la
aplicacion literal de ADR-0018 al caso de la exclusividad de uso entre pretendientes (§15).

Las cuatro operaciones se admiten en estos estados del ciclo (§76):

- Creacion: sobre celdas propias, sin uso, de terreno cultivable y contiguas.
- Ampliacion: solo desde `VIRGIN`, `PLOWED`, `CULTIVATED` y `HARVESTED`. Anadir celdas sin sembrar a un
  campo ya `SEEDED` aumentaria `cellCount`, que multiplica directamente el rendimiento de §83, de modo que
  el jugador cosecharia una superficie que nunca sembro. Desde las tres fases cronometradas y desde
  `READY_TO_HARVEST` se rechaza con `FIELD_STATE_NOT_ALLOWED` y la lista de estados admisibles.
- Division: en cualquier estado. Las dos partes heredan la linea de tiempo y los atributos sin cambio, la
  suma de celdas se conserva y por tanto el rendimiento total tambien. Se exige que las dos partes sean no
  vacias y las dos contiguas.
- Fusion: su regla de resolucion es materia propia y esta en ADR-0027.

El campo absorbido por una fusion queda con borrado logico y conserva su `cellCount`, porque
`fields_geometry_check` exige recuento positivo. La geometria que posee de verdad es cero celdas y eso ya
lo dice `world_cells`, cuyas filas apuntan al superviviente.

### Consecuencias

Una consulta rectangular sobre la rejilla devuelve el campo de cada celda sin ninguna union, que es lo que
el renderizador necesita para pintar la capa de uso y extraer contornos, y lo que hace que un campo
multi-chunk (§18) no sea un caso especial en ninguna parte.

Una operacion de geometria cuesta un statement por conjunto de celdas y no uno por celda. La misma
propiedad hace que dos peticiones concurrentes sobre celdas solapadas no puedan producir un campo con la
mitad de su superficie: la que llega segunda ve un recuento menor del esperado y revierte entera.

Coste asumido: `Field.cellCount` es redundante respecto a `world_cells` y hay que mantenerlo en las cuatro
operaciones. Se acepta a proposito, igual que `balanceAfter` en el ledger (ADR-0009): la respuesta del
contrato lo lleva, el rendimiento esperado de §83 lo multiplica y calcularlo con un recuento en cada
lectura pondria una agregacion en el camino mas frecuente del cliente. La prueba de integracion compara
las dos cifras despues de cada operacion.

Segundo coste: la contiguidad es una propiedad de grafo y ninguna restriccion declarativa la expresa, de
modo que vive solo en la aplicacion. La seccion 5.4 del plan ya lo declaraba. La mitigacion es que la
funcion sea compartida y este cubierta por pruebas de las dos suites, y que la escritura sea condicional,
que es lo que impide que dos peticiones validas por separado produzcan un resultado invalido.

La restriccion de estados de la ampliacion es visible para el jugador y hay que explicarla en la interfaz:
un campo sembrado no se puede ampliar, y el remedio es cosechar primero o crear un campo aparte y
fusionarlo despues, que es exactamente el recorrido que §22 describe.

### Alternativas descartadas

Un array de coordenadas en la fila del campo: obliga a leer y reescribir el array entero en cada
operacion, no permite responder "de que campo es esta celda" sin recorrer todos los campos, y convierte
la exclusividad de uso de §15 en una comprobacion de aplicacion sobre datos que otro puede estar
reescribiendo.

Una extension geoespacial: toda la geometria esta alineada a rejilla y la clave de chunk es el indice
espacial natural. Ya descartado en la seccion 5.1 del plan y confirmado aqui: ninguna consulta de este
modulo se beneficiaria.

Validar la contiguidad con una restriccion declarativa o un disparador: no existe forma declarativa de
expresar conectividad de un grafo en PostgreSQL sin una consulta recursiva por operacion, y el coste
recaeria sobre cada escritura de celda.

Recorrido en anchura sin cota: un conjunto mal formado, o una peticion adversaria, recorre una region
ilimitada. La cota compartida con el cliente es ademas la que garantiza que lo que el cliente considera
demasiado grande y lo que el servidor rechaza sean el mismo numero.

Leer las celdas, comprobar en memoria que estan libres y despues escribirlas: bajo `READ COMMITTED` deja
una ventana entre la lectura y la escritura, y es exactamente la carrera que la actualizacion condicional
con recuento cierra sin cerrojos explicitos.

Permitir la ampliacion en cualquier estado, dejando que el rendimiento se calcule sobre la superficie
sembrada: exigiria almacenar cuantas celdas se sembraron ademas de cuantas tiene el campo, es decir un
segundo recuento con su propia deriva, para habilitar una jugada que el GDD no pide.

Crear una tercera identidad en la fusion y borrar las dos partes, que es como §22 lo dibuja: deja huerfana
toda referencia que ya apunta a las partes. El motivo completo esta en ADR-0027.

---

## ADR-0026 — Compra de tierra: reclamacion de celdas por actualizacion condicional y cobro de lo adquirido

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

La compra de tierra (GDD §14, con los precios por terreno de §115) es la primera operacion del juego que
mueve dinero y toca la rejilla a la vez, y es tambien el caso mas simple de la clase de problemas que la
seccion 5.4 del plan enumera: dos jugadores que quieren la misma celda, y un jugador cuyo presupuesto se
calculo hace unos segundos.

ADR-0018 fijo el mecanismo general —cuando dos transacciones deben verse, hay que forzarlas a escribir la
misma fila— y ADR-0021 dejo en `claimCells` la escritura en SQL crudo que lo implementa. ADR-0009 fijo el
ledger de asiento unico con clave de idempotencia. Lo que esta entrada decide es como se combinan las tres
piezas en una operacion completa, y esa combinacion es la plantilla que van a copiar la compra de edificio,
la creacion de parcela forestal y cualquier otra adquisicion posterior.

El contrato declara ademas dos campos que el cuerpo de la peticion puede llevar y cuyo significado hay que
fijar: `allowPartial` y `expectedTotal`.

### Decision

La compra ejecuta cuatro pasos dentro de una unica transaccion, envuelta en `withPlayerAdvanced`, que es lo
que bloquea la fila del jugador, liquida los devengos hasta el instante de la peticion y devuelve el `seq`
de la respuesta (ADR-0017).

1. Revalidacion. La seleccion se revalida contra la base de datos con `validateCellSelection`, que resuelve
   el terreno efectivo, el propietario y el uso de cada celda desde el generador y desde la capa de
   modificaciones. La palabra del cliente no se usa nunca.
2. Reclamacion. Las celdas que pasaron las reglas se ofrecen a `claimCells`, que las adquiere con dos
   statements y ningun cerrojo: `INSERT ... ON CONFLICT DO NOTHING ... RETURNING` para las celdas que
   todavia no tienen fila, y `UPDATE ... WHERE ownerPlayerId IS NULL AND landUse = 'NONE' ... RETURNING`
   para las que ya la tienen. Lo que las dos devuelven es, por definicion, lo que esta transaccion adquirio.
3. Precio. El total se calcula con `landPurchasePrice` sobre las celdas que la reclamacion devolvio, nunca
   sobre las que la peticion pedia ni sobre las que la validacion aprobo.
4. Cobro. El cargo es a su vez una actualizacion condicional que descuenta solo si el saldo liquidado
   alcanza: fondos insuficientes es un recuento de filas cero y no una excepcion, y aborta la transaccion,
   con lo que las celdas reclamadas en el paso 2 se deshacen con ella.

Tres reglas que acompanan a los cuatro pasos:

- `expectedTotal` se compara despues de la reclamacion y no antes. Una sola regla cubre asi los dos casos
  que el campo existe para atrapar: un presupuesto caducado y una carrera perdida son el mismo hecho con
  distinta latencia, y los dos dan un total distinto del que el jugador acepto.
- La seleccion se deduplica en el servidor antes de cualquier otra cosa, como declara `cellSelectionSchema`
  del contrato, y `purchasedCount + skippedCount` se refiere siempre al conjunto de celdas distintas.
- Una compra que no adquiere nada no escribe asiento. Un asiento de importe cero seria ruido en un libro
  que ADR-0009 declara auditable sumando.

Con `allowPartial` en falso, tanto una celda rechazada por las reglas como una celda perdida en la carrera
producen un 409 y ninguna mutacion. Con `allowPartial` en cierto se compra lo que quedaba y se cobra
exactamente eso.

### Consecuencias

Comprobado con dos compras concurrentes de la misma celda: los estados son `[200, 409]`, queda exactamente
una fila de celda, exactamente un asiento `LAND_PURCHASE` entre los dos jugadores, y el que no la obtuvo no
paga nada. La suma de los asientos del jugador es exactamente igual a su saldo, que es la auditoria que
ADR-0009 exige.

La secuencia de tramas que la operacion emite es una `CHUNK_PATCHED` por chunk tocado, una
`PLAYER_UPSERTED` y una `LEDGER_APPENDED`, sin huecos y terminando en el `seq` que la respuesta devuelve, de
modo que el cliente puede aplicar la respuesta y descartar el eco en cualquier orden (ADR-0019).

Coste asumido, deliberado: con `allowPartial` en cierto y `expectedTotal` presente, una carrera perdida
rechaza la peticion entera en lugar de comprar menos. El campo declara que el jugador acepto una cifra
concreta, y comprar por otra cifra sin decirselo es justo lo que el campo prohibe.

Segundo coste: el tope de seleccion se aplica en dos capas y solo una es alcanzable por HTTP. El esquema
del contrato acota el array en 2.000 elementos y `normaliseSelection` vuelve a comprobarlo, de modo que un
cliente que se pase recibe `VALIDATION_FAILED` y no `SELECTION_TOO_LARGE`. Los dos son 400 y el cliente no
puede llegar ahi porque aplica el mismo tope al arrastrar, pero una prueba que espere el segundo codigo
desde HTTP fallara. `normaliseSelection` cubre ademas el limite de `MAX_ABSOLUTE_CELL_COORDINATE` que
`cellKey` impone y que el esquema no comprueba, de modo que una coordenada enorme es un 400 y no un 500;
cualquier modulo que reciba una seleccion del cliente tiene el mismo hueco y conviene que lo cierre igual.

Divergencia registrada con el servidor simulado del cliente: `frontend/app/mock/handlers.ts` recorre las
celdas sin deduplicar, de modo que una celda enviada dos veces se presupuesta al doble. Contra el servidor
real `purchasedCount + skippedCount` es el numero de celdas distintas y contra el simulado es el numero de
celdas enviadas. Afecta a los paneles en cuanto la seleccion contenga solapes, que es lo que produce la
union de rectangulos de la herramienta de seleccion.

### Alternativas descartadas

Bloquear con `SELECT ... FOR UPDATE` las filas de las celdas antes de comprobarlas: no sirve, porque la
mayor parte de las celdas de una compra no tiene fila que bloquear. La insercion que ignora conflictos es
lo unico que serializa a dos compradores de una celda que todavia no existe.

Calcular el precio antes de reclamar, que es el orden natural de escribir: cobra celdas que otro jugador se
llevo en el intervalo. El presupuesto y el cobro son dos operaciones distintas y solo la segunda sabe que
se adquirio.

Comparar `expectedTotal` contra el presupuesto recalculado antes de reclamar: deja sin cubrir precisamente
el caso de la carrera perdida, que es el que el campo existe para atrapar.

Confiar en el presupuesto que el cliente envio: convierte al cliente en autoridad sobre el precio, que es
lo contrario del pilar de servidor autoritativo de §54.

Modelar los fondos insuficientes como restriccion de tabla sobre el saldo: no puede ser, porque el devengo
offline lleva legitimamente el saldo a negativo (§118 y seccion 6.6 del plan). La actualizacion condicional
distingue las dos cosas: el gasto discrecional se bloquea, el paso del tiempo no.

Deduplicar en el cliente y dar por buena la lista recibida: la unicidad de la celda hace que la segunda
copia no adquiera nada, de modo que un total que la hubiera valorado dos veces no podria cobrarse nunca y el
panel mostraria una cifra que la compra contradice.

Escribir un asiento de importe cero cuando no se adquiere nada, por uniformidad: rompe la lectura del libro
como historia de lo que ocurrio y anade filas que ninguna consulta quiere.

---

## ADR-0027 — Regla de resolucion de la fusion de campos

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

La seccion 22 del GDD admite fusionar dos campos adyacentes, exige validar "contiguidad, compatibilidad,
propiedad y estado agricola" y anade que la fusion "no deberia destruir progreso agricola sin razon
explicita". No dice que hacer cuando las partes difieren, que es el caso interesante y el unico que hay
que decidir: dos campos con distinta fertilidad, distinto nivel de malezas, distinta fase del ciclo o
distinta granja de servicio.

El resto de la geometria esta resuelto en ADR-0025. Lo que falta es la aritmetica y la identidad del
resultado, y las dos tienen consecuencias economicas directas: la fertilidad y las malezas entran en el
rendimiento de §83 por las curvas de §77 y §78, y la linea de tiempo decide en que fase queda el campo
resultante (§76 y §80).

El contrato declara la respuesta como `{ field, removedFieldIds }`, que admite tanto que sobreviva una de
las partes como que se cree una identidad nueva.

### Decision

Seis reglas, y cada una se elige porque es la unica que no destruye ni inventa progreso.

1. Dos campos en fases distintas del ciclo no se fusionan: la peticion se rechaza con
   `FIELD_MERGE_INCOMPATIBLE`. Fusionar un campo `GROWING` con uno `VIRGIN` obligaria a conceder al virgen
   un cultivo que nunca se sembro, lo que crea rendimiento de la nada, o a descartar el que crecia, que es
   la destruccion que §22 prohibe. El rechazo deja siempre un remedio obvio: cosechar o trabajar la otra
   mitad primero.
2. El estado que se compara es el proyectado y no el almacenado. Cada campo se materializa antes de la
   comparacion, dentro de la misma transaccion, de modo que un campo cuyo trabajo de crecimiento todavia no
   ha corrido se compara por lo que realmente es y no por lo que su fila decia (ADR-0028).
3. Compatible significa el mismo estado del ciclo, el mismo cultivo, la misma condicion del suelo y la
   misma granja de servicio. La condicion del suelo forma parte del estado agricola que §22 manda validar,
   y la granja decide a que silo va la cosecha (§31, resuelto en la seccion 2.2 del plan); ninguna de las
   dos se puede elegir al azar entre las partes.
4. Los atributos paralelos del resultado son la media de las partes ponderada por numero de celdas,
   truncada. Fertilidad, malezas y fertilizacion son magnitudes intensivas sobre una superficie, de modo
   que ponderar por superficie es la unica combinacion bajo la cual fusionar y cosechar produce lo que
   habria producido cosechar las partes por separado, salvo el truncamiento de un punto base que ADR-0013
   ya acota.
5. La linea de tiempo de crecimiento del resultado es la mas tardia de las partes. No es una preferencia:
   es la unica eleccion bajo la cual la fase proyectada del campo fusionado sigue siendo la fase comun de
   las partes. Tomar la mas temprana, o la media, podria situar el resultado mas alla de una frontera que
   ninguna parte habia cruzado, que es progreso concedido gratis.
6. Sobrevive el primer campo de la peticion y los demas quedan con borrado logico. Crear una tercera
   identidad, que es como §22 lo dibuja, dejaria huerfana toda referencia que ya apunta a las partes: la
   referencia polimorfica del ledger no tiene clave ajena por diseno (ADR-0009), y el historico de tareas y
   la columna de reserva llevan identificadores de campo.

### Consecuencias

La fusion es una operacion conservadora: nunca aumenta el rendimiento esperado del conjunto ni adelanta una
fase. Es comprobable y esta comprobado en la suite del modulo, que fusiona y compara contra la suma de las
partes.

El rastro contable e historico se conserva sin excepciones. Ninguna consulta que apunte a un campo
absorbido queda colgada, y el borrado logico es la misma politica que ya aplican trabajadores, maquinas y
edificios (seccion 5.3 del plan).

Coste asumido: el campo absorbido conserva su `cellCount`, porque `fields_geometry_check` exige recuento
positivo. Una fila con borrado logico registra lo que la entidad fue; la geometria que posee de verdad es
cero celdas y eso ya lo dice `world_cells`, cuyas filas apuntan al superviviente. No se pide cambiar la
restriccion.

Segundo coste, visible para el jugador: la regla 1 hace que la fusion sea imposible durante buena parte del
ciclo, que es cuando el jugador mas la querria. Es deliberado y es lo que separa esta decision de un
promedio que "casi" funciona: el interfaz debe explicar el rechazo con la lista de estados de las partes,
no ocultarlo.

Tercer coste: al truncar la media ponderada, fusionar y volver a dividir no devuelve exactamente los
atributos originales. La perdida esta acotada en un punto base por atributo y por fusion, y es preferible a
arrastrar decimales en enteros que ADR-0013 declara exactos.

### Alternativas descartadas

Permitir fusionar fases distintas y quedarse con la mas avanzada: concede al campo menos avanzado un
progreso que nunca tuvo, y en el caso extremo un cultivo que nunca se sembro.

Permitirlo y quedarse con la menos avanzada: destruye progreso agricola, que es lo unico que §22 prohibe
expresamente.

Comparar el estado almacenado en lugar del proyectado: dos campos identicos se declararian incompatibles
solo porque el trabajo agendado de uno todavia no habia corrido, es decir por un detalle de puntualidad de
la cola y no por una diferencia de dominio.

Media aritmetica simple de los atributos, sin ponderar: fusionar una celda de fertilidad 100 con
doscientas de fertilidad 50 daria 75, es decir un regalo proporcional a lo desigual que sea la fusion.

Tomar el maximo o el minimo de cada atributo: el maximo crea fertilidad de la nada y el minimo la destruye;
las dos hacen que el resultado dependa de si el jugador fusiona en uno o en dos pasos.

Linea de tiempo mas temprana o media: puede situar el campo resultante mas alla de una frontera de fase que
ninguna parte habia cruzado.

Crear una identidad nueva y borrar las partes: obliga a elegir entre romper el rastro del ledger y prohibir
el borrado. La respuesta del contrato admite las dos formas y la que conserva el rastro es la elegida.

Borrado fisico del campo absorbido: la referencia polimorfica del ledger no tiene clave ajena precisamente
para que un registro contable inmutable no dependa de la vida de la entidad, de modo que un borrado fisico
convertiria el asiento en un puntero a la nada.

---

## ADR-0028 — Atributos perezosos del campo: corte del intervalo por fronteras de fase y una frontera por evento agendado

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

El invariante 5 de la seccion 6.5 del plan dice que la funcion pura es la autoridad y que el trabajo
agendado solo materializa y notifica su resultado, recalculandolo con la misma funcion, y que cada atributo
perezoso lleva su propia marca temporal. El campo es la primera entidad del juego que tiene tres atributos
perezosos a la vez —nivel de malezas (§78), fertilidad en barbecho (§77) y fertilizacion (§79)— y ademas
una fase cronometrada (§76 y §80) que avanza sola con el jugador desconectado (§52).

Los tres atributos y la fase interactuan. Las malezas crecen solo en `GROWING`, `READY_TO_HARVEST` y
`VIRGIN`, segun §78; la fertilidad se regenera solo en barbecho; y la fase cambia por si sola en instantes
que el reloj de juego determina. Es decir, la tasa de un atributo perezoso no es constante a lo largo del
intervalo que hay que liquidar.

La reparticion de fases que la seccion 2.2 del plan fijo es `SEEDED 6 h`, `GERMINATING 12 h` y
`GROWING 78 h`, total 96 h de juego.

### Decision

El intervalo de liquidacion de un atributo perezoso se corta por las fronteras de fase que la linea de
tiempo del campo implica, y cada tramo se acumula con el estado que estuvo en vigor durante el, llamando en
cada tramo a la funcion compartida (`projectWeedLevel` y `projectFallowFertility` de
`shared/rules/yield.ts`). La tasa, la lista de estados en que crece y la saturacion siguen teniendo una
unica implementacion, que es la que tambien ejecuta el cliente.

El manejador de `FIELD_ADVANCE_PHASE` materializa una sola frontera por ejecucion, la vencida, en el
instante en que se cruzo y no en el instante en que el trabajo la noto, y agenda la siguiente al salir. Un
jugador que vuelve tras doscientas horas cruza por tanto las tres fronteras en tres pasadas de la cola,
cada una dejando el historico almacenado donde lo habria dejado una ejecucion puntual.

La proyeccion es la autoridad y la fila almacenada es el historico. El camino de escritura no depende de
que el trabajo haya corrido: `applyFieldOperation` llama primero a `materializeProjectedPhase`, de modo que
una cosecha asignada a un campo cuyo trabajo de crecimiento no ha corrido se acepta y la transicion se
materializa en la misma transaccion.

`expectedYieldLiters` se publica en cualquier estado del campo, que es la lectura literal del contrato: en
un campo sin sembrar es la estimacion de planificacion que la interfaz necesita para comparar dos parcelas,
y el estado viaja al lado para que un panel que no deba mostrarla lo sepa. Un campo sin cultivo asignado se
costea con `FALLOW_RATE_CROP`.

### Consecuencias

Es la pieza del modulo que mas facil habria sido escribir mal sin que se notara, y el corte por fronteras
es lo que la hace correcta. Un campo sembrado y dejado en paz cien horas tiene su marca de malezas en el
instante de la siembra y estado almacenado `SEEDED`, porque ningun trabajo ha corrido todavia: proyectar
todo el intervalo con el estado almacenado no haria crecer ninguna maleza, y proyectarlo con el estado
actual las haria crecer tambien durante las seis horas de `SEEDED` y las doce de `GERMINATING`, donde §78
dice que no crecen. Las dos lecturas se equivocan en decenas de puntos porcentuales del rendimiento de §83
y ninguna se detecta sin hacer la cuenta a mano.

Coste asumido: el truncamiento se aplica una vez por tramo en lugar de una vez por liquidacion, a lo sumo
cuatro puntos base por liquidacion, que es la cota de ADR-0013 multiplicada por el numero de fases de un
ciclo.

Segundo coste: un jugador que vuelve tras un mes de ausencia consume tantas pasadas de la cola como
fronteras haya cruzado en cada campo. Es asumible porque el numero de fronteras de un ciclo es tres y
porque la alternativa aplica efectos mas alla del instante hasta el que se liquidaron los devengos, que es
el error que el orden de `advancePlayer` existe para evitar (ADR-0017).

La metrica `farm_world_scheduled_events_unhandled_total` deja de contar `FIELD_ADVANCE_PHASE`: es el primer
manejador real de los cinco que W3 dejo en andamiaje, y quedan cuatro (`machinery`, `workers`, `tasks` y
`forestry`).

Dos consecuencias que las fases siguientes encontraran al escribir pruebas del mismo estilo, y que costo
diagnosticar: el verificador de tokens lee el reloj inyectado, de modo que avanzar noventa y seis horas de
juego en el arnes caduca una sesion emitida quince minutos antes en su propio marco y hay que renovarla; y
`advancePlayerNow` devuelve `processedEvents` de todos los tipos, incluido el `PLAYER_SETTLE_SWEEP` que
todo jugador recien registrado tiene agendado, de modo que una prueba que quiera contar transiciones de
fase debe afirmar sobre el estado del campo y no sobre el recuento total.

Desviacion numerica registrada, sin ajustar nada: el ejemplo narrativo de §84 dice que el nivel de malezas
subio al 34 % y que la penalizacion fue de "alrededor del 14 %". Con la tasa que §82 publica, 0,6 %/h, y
con las 78 horas de `GROWING`, el nivel es del 46,8 % y la curva de §78 da el 18,72 %. Queda afirmado en
las dos suites del modulo y anadido al apartado 2 de `docs/erratas-gdd-stack.md`. Lo que si reproduce el
ejemplo es el resto del recorrido: `VIRGIN` con fertilidad 100 %, `GERMINATING` a las 6 h,
`READY_TO_HARVEST` a las 96 h y fertilidad al 85 % despues de cosechar.

### Alternativas descartadas

Proyectar el intervalo entero con el estado almacenado del campo: no hace crecer ninguna maleza en un campo
que paso por `GROWING` mientras el jugador estaba fuera, es decir regala el rendimiento completo.

Proyectarlo entero con el estado actual: hace crecer malezas durante `SEEDED` y `GERMINATING`, donde §78
dice que no crecen, es decir castiga al jugador por un tiempo en el que no pasaba nada.

Una marca temporal unica por fila en lugar de una por atributo: liquidar las malezas descartaria el tiempo
transcurrido de la fertilidad. Ya descartado en la seccion 6.5 del plan y confirmado aqui.

Ponerse al dia con todas las fronteras vencidas dentro de un solo manejador: aplica efectos mas alla del
instante hasta el que se liquidaron los devengos y rompe el orden que `advancePlayer` garantiza.

Materializar la frontera en el instante en que el trabajo la noto: hace que el historico dependa de la
puntualidad de la cola, cuando BullMQ es un requisito de puntualidad y no de correccion.

Un tick continuo que actualice los atributos: lo prohibe §53 y lo hace inviable el numero de campos.

Almacenar la fase como unica verdad y rechazar operaciones sobre un campo cuyo trabajo no ha corrido: hace
al jugador rehen de la cola y convierte una incidencia de infraestructura en una regla de juego.

Publicar `expectedYieldLiters` solo en los estados en que hay cosecha pendiente: elimina precisamente el
uso de planificacion, que es comparar dos parcelas antes de sembrar.

---

## ADR-0029 — La granja como unidad contable y el edificio como unidad fisica: precio transaccional y capacidades

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

El GDD declara la granja una entidad fisica que ocupa celdas reales (§23) y describe despues los edificios
uno a uno con su huella, su precio y su capacidad (§25 a §29). El modelo de datos de W2 no da geometria
alguna a la granja y si a los edificios, de modo que la contradiccion estaba latente desde entonces y le
toco resolverla a la implementacion.

La segunda contradiccion es economica y ya estaba diagnosticada. La formula de §116,
`realBuildingCost = purchasePrice + footprint x cellPrice`, aplicada literalmente cobra el suelo dos veces
en el escenario de §117, donde el jugador compra 330 celdas y despues paga solo las estructuras. La seccion
2.2 del plan la resolvio con el parametro `landAlreadyOwned` de `shared/rules/pricing.ts`.

Lo que ninguno de los dos documentos contempla es el caso que el juego produce en cuanto un jugador amplia
su granja: una huella parcialmente poseida, por ejemplo cuarenta y ocho celdas de las que treinta ya son
suyas. `landAlreadyOwned` es un booleano y no expresa eso.

La tercera pieza son las capacidades. ADR-0018 fijo que la restriccion declarativa es la red de seguridad y
nunca el mecanismo, y este es el primer modulo que tiene que aplicarlo sobre contadores mantenidos por
disparador (`machineCount` de §96, `workerCount` de §108) y sobre una capacidad recalculada por disparador
(`capacityWheatLiters` de §27, `capacityWoodDm3` de §136).

### Decision

Lo que ocupa celdas son los edificios; la granja es la unidad que agrupa y la unidad contable.
`POST /api/farms` no cuesta nada, no ocupa nada y no exige clave de idempotencia, y toda la consecuencia
fisica y economica recae en `POST /api/farms/:farmId/buildings`. La afirmacion de §23 se sostiene
igualmente: un garaje son cuarenta y ocho celdas reales que dejan de ser aptas para campo.

Precio transaccional del edificio. El importe del suelo se calcula con `landPurchasePrice` sobre las celdas
que la peticion adquiere realmente, que es la misma regla de §115 que `realBuildingCost` usa por dentro.
`realBuildingCost` se sigue invocando con `landAlreadyOwned` explicito, porque es donde la resolucion de
§116 frente a §117 queda visible en el codigo y porque aporta la cifra de planificacion que el panel
necesita. En los dos extremos, huella entera poseida y huella entera por comprar, las dos cifras coinciden
exactamente. La respuesta desglosa `buildingPaid`, `landPaid` y `totalPaid`, y se escriben dos asientos,
`BUILDING_PURCHASE` y `LAND_PURCHASE`, no uno.

Validacion de la colocacion sin escribir una segunda regla. `canBuildOn` de `shared/rules/selection.ts`
exige que la celda sea del jugador, de modo que aplicada literalmente ningun jugador nuevo podria construir
su primera granja. En lugar de anadir una regla "construible o comprable", que duplicaria en el servidor lo
que el cliente pinta en verde, `projectAfterPurchase` proyecta la huella al estado que tendria una vez
ejecutada la compra —solo propiedad y uso, nunca el terreno ni la presencia de arbol— y la regla compartida
decide sobre esa proyeccion. Despues se valida con `validateSelection(PURCHASE)` el subconjunto que hay que
comprar.

El orden de las dos reglas es deliberado: primero la de edificio y despues la de compra. Una celda de agua
es a la vez incomprable e inconstruible, y `TERRAIN_NOT_BUILDABLE` es la respuesta que dice al panel de
colocacion que se mueva, mientras que `TERRAIN_NOT_PURCHASABLE` lo mandaria a la herramienta de tierra por
una celda que ninguna compra arreglaria. Segunda traduccion, tambien decidida: un `CELL_IN_USE` procedente
de una seleccion de edificio se reporta como `BUILDING_FOOTPRINT_OVERLAPS`, que es el codigo que el
contrato reserva para la exclusividad de §15; los demas codigos por celda conservan su nombre, porque "no
es tu celda" y "hay un edificio ahi" llevan al jugador a acciones distintas.

Reparto entre la aplicacion y las restricciones de la base, en tres partes:

1. El modulo no duplica ningun contador ni ninguna capacidad: los lee. Construir un almacen no escribe la
   capacidad de la granja; la escribe el disparador y el modulo relee la fila para componer la respuesta.
2. Todo rechazo previsible se responde antes del statement y con sus cifras: garaje lleno, vivienda llena,
   taller ausente, edificio no vacio, y en la demolicion de un almacen la comprobacion de que retirar su
   capacidad no deja las existencias por encima de lo que queda.
3. Lo que queda es la carrera real, y para ella `constraints.ts` reconoce `buildings_capacity_check`,
   `farms_stock_check` y `world_cells_use_exclusivity_check` por su nombre en el texto del error y devuelve
   el codigo del contrato. Se reconoce por el nombre y no por la clase de error de Prisma porque las zonas
   de ESLint impiden que un modulo de dominio alcance el cliente generado, restriccion que se conserva. Lo
   que no reconoce se relanza intacto, de modo que una restriccion inesperada sigue siendo un 500 con su
   traza.

La retirada de un edificio es simetrica: borrado logico de la fila (`disposedGameMs`), porque el asiento
que lo pago apunta a su identificador sin clave ajena (ADR-0009), y liberacion real de las celdas, que
vuelven a `OWNED` con `buildingId` nulo. El valor de reventa sale de `buildingResaleValue` de
`shared/rules/pricing.ts` tanto en el modelo de lectura como en el reembolso, de modo que la cifra que el
panel muestra y la que el servidor abona no pueden diferir.

### Consecuencias

El resumen de regreso de §124 puede agregar por concepto sin que un edificio parezca tierra, porque los dos
asientos existen por separado desde el primer dia.

Las capacidades tienen un unico origen. `modules/farms/service.ts` publica la API interna que W5 y W6
consumen —`farmCapacities`, `requireGarageSlot`, `requireHomeSlot`, `requireWorkshop`, `reserveStorage`,
`depositStorage`, `withdrawStorage` y las demas— devolviendo los tipos del contrato sin conversion. Ningun
modulo posterior debe incrementar `machineCount` ni `workerCount`: los mantienen los disparadores dentro de
la misma transaccion y el `CHECK` de la fila resuelve la carrera por la ultima plaza.

Comprobado por HTTP contra la pila real, sin literales: garaje 8.000 (§116) mas 48 x 120 de suelo (§115)
son 13.760 sobre un capital inicial de 160.000 (§117), la reventa al 60 % son 4.800, y un solape responde
`BUILDING_FOOTPRINT_OVERLAPS` mientras que construir fuera del suelo propio responde `CELL_NOT_OWNED`.

Coste asumido: cuando la traduccion de una restriccion se dispara, la transaccion ya esta abortada y no se
puede leer para informar de la ocupacion, de modo que el error lleva el codigo y el identificador pero no
las cifras, que `capacityExceeded` de `shared/api/errors.ts` exige y que se pasan como cero. Las cifras las
lleva siempre el rechazo anticipado, que es el camino normal. Conviene saberlo antes de que un panel las
muestre sin comprobar.

Segundo coste: `realBuildingCost` queda invocado con un booleano que no describe el caso real, y la cifra
que de verdad se cobra la calcula el modulo. Si algun dia se abre `shared/rules/pricing.ts`, la firma
natural es recibir el numero de celdas a comprar en lugar del booleano.

### Alternativas descartadas

Dar geometria a la granja y no al edificio, siguiendo la letra de §23: obliga a inventar la forma de una
granja, que el GDD nunca define, y deja sin sitio la capacidad por edificio que §96 y §108 exigen y que
ADR-0018 resuelve con un contador por fila.

Cobrar `realBuildingCost` literalmente: cobra el suelo dos veces en el escenario de §117, que es el unico
escenario numerico que el GDD publica.

Cobrar la huella entera cuando alguna celda ya es del jugador: cobra dos veces lo ya pagado, que es la
misma contradiccion en su version parcial.

Un unico asiento por el total: impide que el resumen de regreso distinga inversion en estructura de
inversion en suelo, y hace que la venta posterior de un edificio no cuadre con lo que costo.

Escribir en el servidor una regla "construible o comprable": duplica la regla que el cliente usa para
pintar en verde, que es lo que la seccion 8 del plan prohibe expresamente.

Validar primero la compra y despues la construccion: manda al jugador a la herramienta de tierra por una
celda de agua que ninguna compra hara construible.

Mantener los contadores de capacidad desde la aplicacion: son dos fuentes de verdad del mismo hecho, y la
carrera por la ultima plaza volveria a estar abierta entre la lectura y la escritura.

Delegar en la restriccion los rechazos previsibles: una restriccion violada dentro de un trabajo de BullMQ
produce reintentos indefinidos, y ademas la respuesta pierde las cifras que el panel necesita.

Alcanzar el cliente generado de Prisma para distinguir la clase del error en lugar de leer el nombre de la
restriccion: exige romper la zona de ESLint que aisla los modulos de dominio, que se considera correcta.

Borrado fisico del edificio: deja el asiento `BUILDING_PURCHASE` apuntando a una fila que ya no existe,
contra ADR-0009.

---

## ADR-0030 — Reglas de validacion compartidas entre cliente y servidor en la herramienta de seleccion

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

La seccion 8 del plan fija que las reglas puras de `shared/rules/` las importan a la vez el validador del
backend y el cliente, "de modo que la resaltada verde de una seleccion y el error 400 del servidor no
puedan divergir". Es una afirmacion facil de escribir y facil de incumplir sin que se note: basta con que
el lienzo, que trabaja dentro del bucle de arrastre y necesita el veredicto sesenta veces por segundo,
escriba su propia version rapida de la regla.

La herramienta de seleccion es donde eso se decide. El GDD pide formas arbitrarias sin definir la
herramienta (§17 y §19), y la seccion 9.5 del plan la resuelve con rectangulos combinables por union,
resta y conmutacion de celda, con un tope compartido de 2.000 celdas, y con la validez "calculada con las
reglas compartidas y mostrada agregada y accionable, con motivos legibles y salto al primer conflicto".

El adelanto de este trabajo desde W5 a W4 anticipa ademas la entrada que el reparto de la seccion 11 del
plan situaba en la fase siguiente.

### Decision

La herramienta no implementa ninguna regla que las reglas compartidas ya expresen. Siete de sus nueve modos
son una llamada a `validateSelection` o a `validateBuildingFootprint` y nada mas, y el tope de 2.000 celdas
es la misma constante (`MAX_SELECTION_CELLS`) en los dos lados.

El veredicto por celda y el agregado salen de la misma funcion. `cellRuleOf` devuelve la entrada de
`SELECTION_PURPOSE_RULES` que el agregado ejecuta por dentro, de modo que las celdas pintadas de verde y
las contadas como validas no pueden diferir. Por el mismo motivo el contorno de la seleccion usa
`borderSegments` de `shared/rules/geometry.ts` y no un segundo recorrido de bordes.

Cuatro decisiones mas, todas medidas y no supuestas:

1. El tope se aplica mientras se recorre el rectangulo y no despues. Un arrastre de cinco mil por cinco mil
   celdas son veinticinco millones de claves, y construir el conjunto para recortarlo luego es la version
   que congela la pestana. Es la misma decision que `boundedBreadthFirst` ya tomo con su propia cota.
2. La actualizacion al cruzar una frontera de celda es el diseno y no una optimizacion. A dieciseis pixeles
   por celda, un arrastre produce dieciseis veces mas eventos que celdas y cada uno reconstruiria el
   conjunto, lo revalidaria y redibujaria. Medido en el navegador: 321 eventos de raton producen 22
   recalculos.
3. Una celda cuyo chunk todavia no ha llegado es desconocida, no invalida. Se pinta en un tercer color, no
   cuenta como invalida y bloquea la confirmacion, que es la lectura conservadora de la seccion 7 del plan:
   el cliente es una cache y no puede afirmar nada sobre una celda que no tiene.
4. Confirmar no muta nada y ademas se niega cuando el veredicto no es verde. Confirmar publica una
   instantanea; quien la recibe abre el panel y es el panel quien pide al servidor con el presupuesto
   autoritativo.

Las dos excepciones estan documentadas y compuestas, no reinventadas. `SelectionPurpose` de
`shared/rules/selection.ts` tiene seis valores y ninguno sirve para la division de campo (§21) ni para la
tala por area (§135): `canBeFieldCell` rechaza con `CELL_IN_USE` toda celda de una division, porque ya
tiene uso, y `canClearCell` exige que la celda no tenga arbol en pie, que es lo contrario de lo que la tala
selecciona. Las dos se componen en `game/selection/rules.ts` con las mismas primitivas compartidas
(`isContiguous`, `cellKey`, `ValidationCode`, `VALIDATION_MESSAGES`), reflejando sentencia a sentencia lo
que el servidor ya hace: la de division reproduce `splitField` del modulo de campos, y la de tala usa
`TARGET_KIND_MISMATCH` para una celda ajena a la parcela y `NO_FELLABLE_TREES` cuando la seleccion no
contiene ningun arbol en pie.

La herramienta lee el mundo por el mismo puerto que la escena (`WorldSource`, ADR-0024) y publica por un
puerto propio. Ninguna de las dos direcciones pasa por un almacen de Pinia.

### Consecuencias

Las nueve suites de la herramienta, 83 pruebas, corren sin Phaser y sin Pinia, porque lo unico que la
herramienta necesita son funciones puras y dos puertos. Una de ellas cruza la tabla de modos con
`SELECTION_PURPOSE_RULES` y afirma que cada proposito compartido es alcanzable desde exactamente un modo,
lo que convierte el reparto en dato comprobable y no en un parrafo.

Comprobado en el navegador sobre el camino real de datos: un rectangulo de 11 x 7 da 77 celdas con la caja
exacta; union, resta y conmutacion se comportan como el algebra declara; un rectangulo de 101 x 20 a zoom
0,25 se detiene en 2.000 celdas con `capped` en cierto y sin producir `SELECTION_TOO_LARGE`; una seleccion
de 357 celdas invalidas se agrega en `CELL_NOT_OWNED: 309` y `TERRAIN_NOT_ARABLE: 48`; y el salto al primer
conflicto mueve la camara a la celda que el agregado nombra. El coste de dibujo es proporcional a las filas
de la forma y no a sus celdas: 494 celdas producen 19 rectangulos de relleno y 90 segmentos de contorno.

Consecuencia que W6-C debe conocer: cuando el modulo de silvicultura implemente la tala, su validacion
tiene que producir esos mismos dos codigos para esos mismos dos casos, o el cliente y el servidor
discreparan en el unico punto donde este ambito no ha podido apoyarse en una funcion compartida.

Coste asumido: el algebra de conjuntos existe dos veces, en `frontend/app/stores/selection.ts` y en
`game/selection/set.ts`. No es un descuido: la zona de ESLint prohibe que `app/game` importe `app/stores`,
y la herramienta necesita el conjunto dentro del bucle de arrastre, donde una escritura reactiva por cruce
de frontera pagaria el coste de Pinia. Las dos no pueden divergir en lo que importa, porque las dos toman
el tope de `MAX_SELECTION_CELLS` y las dos derivan el veredicto de `validateSelection`; difieren en que la
de la herramienta informa ademas si la operacion llego al tope. El dia que estorbe, la forma de eliminar la
duplicacion es mover el algebra a `shared/rules/selection.ts`, que ya es donde vive el tope.

Segundo coste, de contrato: el puente del cliente no declara ningun evento que signifique "confirmado" y su
`SelectionMode` no distingue la division ni la tala por area, ni puede llevar el campo, la parcela o las
celdas del sujeto. Ambos son ficheros congelados y ambos estan resueltos con un puerto propio
(`SelectionPort.onConfirm`, `setIntent`), con la declaracion exacta propuesta en `NOTES-w4g.md`.

### Alternativas descartadas

Reimplementar en el cliente una version rapida de la validacion, aprovechando que solo tiene que decidir un
color: es exactamente la divergencia que la seccion 8 del plan existe para impedir, y se manifiesta como
celdas verdes que el servidor rechaza, que es el peor error posible en una herramienta de compra.

Calcular el veredicto por celda con un recorrido y el agregado con otro: dos implementaciones del mismo
juicio que se desincronizan en la primera regla que se anada.

Construir el conjunto completo del rectangulo y recortarlo despues al tope: veinticinco millones de claves
en el caso extremo, y la pestana deja de responder.

Recalcular en cada evento de raton: dieciseis veces mas trabajo que celdas seleccionadas, medido.

Pintar en rojo la celda cuyo chunk no ha llegado: es una afirmacion que el cliente no esta en condiciones
de hacer. Pintarla en verde seria peor, porque invita a confirmar.

Permitir confirmar con veredicto rojo y dejar que el servidor rechace: un viaje de ida y vuelta gastado en
aprender lo que el cliente ya sabia no es defensa en profundidad, es latencia. La defensa en profundidad ya
existe y esta en el servidor, que revalida siempre.

Anadir dos propositos nuevos a `shared/rules/selection.ts` para la division y la tala: es un fichero
congelado y el cambio afectaria al backend, al cliente y a la calculadora a la vez, para dos casos que se
expresan con las primitivas que ya existen.

Que la herramienta lea y escriba los almacenes: ademas de estar prohibido por la zona de ESLint, ataria las
suites a Pinia y pondria estado reactivo en el camino caliente del arrastre.

---

## ADR-0031 — Los paneles del mundo consumen los modulos del lienzo: leyenda desde la paleta y minimapa desde la miniatura de chunk

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

ADR-0020 fijo que todo el arte se genera por codigo desde una paleta unica, y que el bloque generado de
`frontend/app/assets/tokens.css` publica esos mismos colores como variables CSS para que el DOM del shell y
el lienzo no discrepen. W3-C aplico esa decision al shell con el patron habitual de Nuxt: cada token se lee
como `var(--fw-x, respaldo)`, con un respaldo escrito a mano para el caso de que la hoja no haya cargado.

Dos paneles de esta fase rompen la premisa de ese patron. La leyenda (§61 pide una interfaz que explique lo
que el jugador ve) tiene que pintar 64 muestras de color que son exactamente las que el generador de
texturas usa para el terreno, el uso del suelo, los ocho estados del ciclo de cultivo (§76) y las cuatro
fases de arbol (§131). El minimapa tiene que pintar una region entera del mundo a escala de un pixel por
celda. En ambos casos el color no es decoracion de interfaz sino afirmacion sobre el contenido del lienzo,
y un respaldo escrito a mano es una segunda paleta esperando el dia en que alguien ajuste la primera.

### Decision

Los dos paneles importan del modulo que genera el pixel, no de la hoja de estilo.

La leyenda importa `PALETTE` y `toCssHex` de `game/textures/palette.ts`. `legend/vocabulary.ts` deriva cada
muestra de la misma entrada de la paleta que la textura correspondiente (`PALETTE.terrain[t].base`,
`PALETTE.crop[s].mark`, `PALETTE.tree[f].canopy`, `PALETTE.use[u]`) y no admite ningun literal de color ni
ninguna variable CSS con respaldo. La prueba de la leyenda compara las 64 muestras con los numeros del
modulo, de modo que una divergencia falla en `make test-unit` y no en el ojo del jugador.

El minimapa es un segundo consumidor de `chunkThumbnailPixels` de `game/world/thumbnail.ts`, que es la
funcion con la que la escena dibuja su nivel de detalle lejano (ADR-0023), sobre la misma cache decodificada
de chunks (ADR-0024). No tiene camino de datos propio: compone la ventana de siete por siete chunks en un
unico `ImageData` de 224 por 224 pixeles y la vuelca con un solo `putImageData`.

`legend/units.ts` sigue el mismo criterio con la escala: la celda de 10 m y el chunk de 320 m de ADR-0012
viven en `shared/config/world.ts` y el panel los convierte a hectareas sin volver a declararlos.

### Consecuencias

No existe forma de que la leyenda y el lienzo discrepen sobre el color de un terreno, ni de que el minimapa
y la escena discrepen sobre el aspecto de una region: en los dos casos hay una sola fuente y una sola
funcion. Comprobado en el navegador: la primera muestra de la leyenda computa `rgb(122, 156, 79)`, que es
`PALETTE.terrain.GRASS.base`.

Coste de rendimiento acotado por construccion. El minimapa paga una escritura de 224 por 224 pixeles por
repintado y ninguna llamada de dibujo por chunk; con un solo chunk cargado de los 49 de la ventana, el
panel lo dice («1 de 49 chunks cargados») en lugar de inventar terreno que no tiene.

Coste asumido: dos paneles de `components/` dependen de `app/game/`, que es una direccion de importacion que
el shell no usaba. Es la direccion correcta —la interfaz depende del render y no al reves— y las zonas de
ESLint la permiten, pero implica que un cambio en la paleta o en la miniatura obliga a ejecutar tambien las
suites de estos dos paneles.

Queda pendiente de vigilar el caso que el minimapa no cubre: no genera localmente el terreno de un chunk que
no ha llegado, aunque `game/world/` sabe hacerlo (ADR-0024). Es deliberado en esta fase, porque generar 49
chunks al abrir un panel compite con el streaming de la escena; esta anotado en `NOTES-w4e.md`, apartado
3.4.

### Alternativas descartadas

Leer los colores de las variables CSS con respaldo escrito a mano, como hace el shell: produce dos paletas,
y la segunda solo se descubre equivocada cuando alguien compara la leyenda con el mapa. El respaldo es
correcto para superficies y texto, donde un color aproximado sigue siendo legible, y es incorrecto para una
muestra cuyo unico contenido informativo es el color exacto.

Duplicar la tabla de nombres y colores en el panel: la leyenda dejaria de ser una lectura de la paleta para
convertirse en una segunda declaracion de lo que el juego dibuja, que es justo lo que ADR-0020 evita.

Dar al minimapa su propio camino de datos, con su propia peticion de chunks y su propio dibujo: dos caminos
para el mismo dato, con dos momentos de llegada y dos representaciones. La ventana del minimapa es ademas
mayor que la del streaming, de modo que la discrepancia seria visible de inmediato.

Dibujar el minimapa con una llamada por chunk sobre un `canvas` escalado: 49 llamadas de dibujo por
repintado frente a una escritura de imagen, y el filtrado del escalado emborrona un mapa cuyo contenido es
un pixel por celda.

---

## ADR-0032 — El panel no decide: el motivo de un control inhabilitado es el codigo con el que el servidor lo rechazaria

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

ADR-0030 fijo esta regla para la herramienta de seleccion, que es donde el veredicto se pinta sobre el
lienzo. Los trece paneles de esta fase la ponen a prueba en el otro extremo: un panel tiene que decidir si
un boton esta activo, y tiene que escribir en castellano por que no lo esta. Es el punto donde reaparece la
tentacion de escribir la regla otra vez, porque la regla del panel parece mas simple que la del servidor: no
tiene que decidir si la operacion procede, solo si el boton se ve gris.

El material de partida lo exige en los dos sentidos. La seccion 8 del plan pide que la resaltada del cliente
y el 400 del servidor sean la misma funcion; el GDD describe operaciones cuya validez depende de tablas que
ya existen en `shared/` (§76 y §90 para las operaciones admisibles de un campo, §96 para las plazas de
garaje, §108 para la vivienda, §115 y §116 para los precios), y la seccion 7 del plan recuerda que el
cliente es una cache y no una autoridad.

### Decision

Ningun panel implementa una regla de dominio. La compra es `canPurchase` y `cellPrice`; la validez de una
seleccion es `validateToolSelection` de W4-G sobre `validateSelection` de `shared/rules`; el rendimiento
esperado es `finalYieldLiters`; las operaciones admisibles de un campo salen de `CROP_CYCLE_TRANSITIONS`; la
contiguidad de una fusion es `isContiguous`; la huella de un edificio es `validateBuildingFootprint`. Todos
los importes se formatean con `Money` a traves de `useFormatting`, y ningun panel divide, redondea ni
concatena un importe por su cuenta.

El motivo que acompana a un control inhabilitado es la entrada de `VALIDATION_MESSAGES` correspondiente al
`ValidationCode` por el que el servidor rechazaria la peticion, y no una frase escrita en el panel. Los
quince ficheros de este ambito que muestran un motivo importan esa tabla; ninguno escribe un texto de error
propio.

Una celda que el cliente no ha resuelto —porque su chunk no ha llegado— no es invalida, es desconocida, y
bloquea el envio sin contarse como error. `SelectionVerdict` lo expresa con un campo distinto de la validez:
`sendable` vale `validation.ok && unresolvedCount === 0 && cells.length > 0`. Los cuatro paneles que envian
una seleccion consultan `sendable` y no `validation.ok`, de modo que la diferencia entre "invalido" y "no
lo se" no se pierde en el camino de la herramienta al panel.

### Consecuencias

El motivo que lee el jugador y el motivo que produciria el servidor son el mismo dato, y cuando el servidor
anada una condicion nueva a una regla compartida los paneles la muestran sin cambio alguno. El caso inverso
tambien vale: un panel no puede inventar una prohibicion que el servidor no aplica, porque no tiene de donde
sacar el texto.

Las 115 pruebas de los catorce ficheros nuevos de paneles se apoyan en ello: comprueban el codigo, no la
frase, de modo que un cambio de redaccion en `VALIDATION_MESSAGES` no rompe catorce suites.

Coste asumido: hay casos donde el codigo mas cercano no es el mas explicativo. El plan de colocacion traduce
`CELL_IN_USE` a `BUILDING_FOOTPRINT_OVERLAPS` porque el primero, correcto para la compra, no dice lo que el
jugador necesita saber al colocar un edificio; la traduccion es la misma que hace
`backend/src/modules/farms/placement.ts` y esta declarada en el modulo espejo (ADR-0033).

Segundo coste, de tipos: `UiButton.reason` es `string` opcional y con `exactOptionalPropertyTypes` activo no
admite que se le enlace `undefined`, de modo que los paneles calculan siempre una cadena, vacia cuando no
hay motivo, o pasan el motivo con `v-bind` de un objeto. Es una friccion recurrente de esta fase y esta
anotada para W7 en `NOTES-w4f.md`, apartado 4.5.

Queda pendiente de vigilar el unico hueco: dos validaciones no tienen funcion compartida —la division de
campo y la tala por area— y estan compuestas con las primitivas de `shared/rules` en `game/selection/rules.ts`
por decision de ADR-0030. Cuando W6-C implemente la tala tiene que producir los mismos dos codigos.

### Alternativas descartadas

Escribir en el panel la condicion que inhabilita el boton, aprovechando que casi siempre es una linea: es la
divergencia de la seccion 8 del plan en su forma mas dificil de detectar, porque un panel demasiado estricto
no produce ningun error visible, solo una funcion del juego que parece rota.

Redactar los mensajes en el panel para que suenen mejor en su contexto: produce dos textos para el mismo
rechazo, y el que el jugador ve por HTTP cuando la validacion local no se ejecuta deja de coincidir con el
que vio antes.

Tratar una celda sin chunk como invalida: el cliente afirmaria algo que no sabe. Tratarla como valida es
peor, porque invita a confirmar una operacion que el servidor rechazara.

Fundir `sendable` y `validation.ok` en un solo booleano: la interfaz perderia la distincion entre "esto no
se puede hacer" y "todavia no lo se", que son dos mensajes distintos para el jugador y dos situaciones
distintas para quien depura.

---

## ADR-0033 — El plan de colocacion de edificio en el cliente como espejo declarado del modulo del servidor

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

ADR-0032 resuelve el caso general: el panel llama a la regla compartida. La colocacion de un edificio es el
caso donde eso no basta, y conviene registrar por que.

Decidir si un edificio puede estar en una posicion no es una llamada a `validateBuildingFootprint`. Hay
cuatro reglas encadenadas con un orden de evaluacion que importa (la huella, la compra del suelo que la
huella exige, el precio con sus dos casos de §116 y §117, y la asequibilidad), una traduccion de codigo
—`CELL_IN_USE` a `BUILDING_FOOTPRINT_OVERLAPS`— y una proyeccion de lo que la peticion va a comprar. Todo
eso lo resolvio W4-B en `backend/src/modules/farms/placement.ts`, que el cliente no puede importar: es
codigo de backend y las zonas de ESLint lo impiden con razon, porque arrastraria Prisma al navegador.

Subir la composicion a `shared/rules/` seria la solucion limpia, y no esta disponible: `shared/` quedo
congelado al cierre de W2 y un cambio ahi afecta a la vez al backend, al cliente y a la calculadora de
balance.

### Decision

`frontend/app/components/panels/building-placement/placementPlan.ts` reproduce `planPlacement` del servidor
sentencia a sentencia, declara en su cabecera que lo hace, y enumera alli las tres diferencias con su
motivo. Las seis funciones que deciden y ponen precio son las compartidas: `validateBuildingFootprint`,
`validateSelection`, `realBuildingCost`, `landPurchasePrice`, `BUILDING_CATALOGUE` y `BUILDABLE_TERRAINS`.
Ninguna regla se reescribe; lo que se duplica es el orden en que se llaman.

Las tres diferencias, todas consecuencia de que el cliente es una cache y no una autoridad:

1. Se informan todos los motivos y no solo el primero. El servidor lanza el primero porque una transaccion
   tiene que detenerse en algun punto; el panel tiene que explicar la huella entera.
2. Una celda cuyo chunk no ha llegado es indecisa, nunca invalida: no cuenta como motivo y bloquea la
   confirmacion, que es la misma lectura de ADR-0030 y de ADR-0032.
3. La asequibilidad se evalua contra el saldo liquidado que el cliente vio por ultima vez. La comprobacion
   autoritativa corre dentro de la transaccion del servidor contra el saldo liquidado alli; esta existe para
   que la negativa se enuncie antes del viaje de ida y vuelta.

Es el mismo patron que ADR-0030 adopto para la division de campo y la tala por area, y se registra aparte
porque aqui lo duplicado no es una composicion de dos primitivas sino un modulo entero del servidor.

### Consecuencias

El fantasma que el jugador arrastra por el lienzo y el 409 del servidor no pueden discrepar sobre si una
huella es admisible, ni sobre cuanto cuesta. Comprobado en el navegador sobre pradera sin propietario en
(157, 149): «Edificio (§116) 8.000,00 · Suelo (48 celdas, §115) 5.760,00 · Coste total 13.760,00 · Saldo
tras la operacion 14.690,00», y tras confirmar, «Total cobrado 13.760,00» con el saldo pasando de 28.450,00
a 14.690,00.

Coste asumido y conocido: si algun dia cambia el orden de evaluacion en el servidor, hay dos sitios que
tocar. La duplicacion esta declarada en la cabecera del modulo espejo precisamente para que quien cambie uno
encuentre el otro, y la suite `placement-plan.test.ts` la ejercita con los mismos casos que las pruebas de
integracion del modulo de granjas.

La forma de eliminar la duplicacion, el dia que estorbe, esta identificada: subir `planPlacement` a
`shared/rules/`, que es donde ya viven las seis funciones que usa. Es un cambio en un fichero congelado y
corresponde a W7.

### Alternativas descartadas

Escribir en el panel una version simplificada de la validez, que solo decida el color del fantasma: la
colocacion es precisamente la operacion donde el jugador arrastra durante segundos sobre una decision que
cuesta miles, y descubrir en el 409 que la posicion no valia es el peor momento posible.

Pedir al servidor una validacion por cada movimiento del fantasma: una peticion por cruce de frontera de
celda, con el fantasma retrasado respecto al cursor por la latencia. El presupuesto autoritativo se pide una
vez, al confirmar, que es lo que ADR-0034 fija.

Importar el modulo del backend desde el cliente: prohibido por las zonas de ESLint y por buenos motivos.

Mover ya `planPlacement` a `shared/rules/`: es un fichero congelado desde W2 y el cambio tocaria backend,
cliente y calculadora de balance en una fase donde tres agentes escriben en paralelo. La duplicacion
declarada tiene un coste conocido y acotado; abrir `shared/` en mitad de la fase, no.

---

## ADR-0034 — Presupuesto local para el arrastre y presupuesto del servidor para cobrar, con `expectedTotal` como contrato de precio

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

La compra de tierra (§115) y la colocacion de un edificio (§116) tienen la misma forma: el jugador mueve una
seleccion por el mapa y necesita ver el importe cambiar con el movimiento, y despues confirma una operacion
que mueve dinero. Las dos rutas correspondientes llevan `expectedTotal` en el cuerpo y la cabecera de
idempotencia, y `POST /api/land/quote` existe en el contrato precisamente para dar un presupuesto
autoritativo sin cobrar.

Dos hechos acotan la decision. El primero es que el cliente no puede saber que otro jugador compro una celda
de la seleccion hace un segundo: la seccion 7 del plan lo declara cache y ADR-0026 resuelve la carrera en el
servidor por actualizacion condicional. El segundo es §116 frente a §117, que la seccion 2.2 del plan y
ADR-0011 ya resolvieron: `realBuildingCost = purchasePrice + huella x cellPrice` es ayuda de planificacion,
y el precio transaccional es `purchasePrice` mas solo las celdas que la peticion compra de verdad.

### Decision

Hay dos presupuestos y manda el del servidor.

Mientras la seleccion se mueve, el panel calcula el desglose localmente con `cellPrice` y `landPurchasePrice`,
sin peticion y sin coste. Cuando el arrastre se asienta, pide `POST /api/land/quote` y muestra esa respuesta.
Al confirmar envia ese total como `expectedTotal`, de modo que un presupuesto caducado se rechaza con un 400
que nombra el campo en lugar de cobrarse en silencio. Los tres paneles que mueven dinero en esta fase
—compra de tierra, inspector de celda y colocacion de edificio— lo hacen igual.

El coste de un edificio se muestra siempre con sus dos casos de propiedad del suelo. El catalogo del paso uno
publica a la vez la cifra de la estructura y la formula literal de §116 con suelo, etiquetada como referencia
de planificacion; el paso tres muestra el desglose real de la ubicacion elegida, con el numero de celdas que
la peticion adquiere. Cuando la huella esta parcialmente poseida se cobran solo las celdas adquiridas, que es
lo que hace el servidor y lo que ninguno de los dos extremos de `realBuildingCost` expresa.

### Consecuencias

El importe se mueve con el cursor sin producir trafico, y el importe que se cobra es el que el servidor
calculo. Un jugador que ve 13.760,00 paga 13.760,00 o recibe un rechazo que nombra el precio; no hay tercer
caso.

Comprobado en el navegador contra el servidor simulado: la tabla de §115 (Pradera 120,00, Bosque 70,00,
Montana y Agua «No comprable»), el catalogo de §116 con sus dos precios por edificio (garaje 8.000,00 y con
suelo 13.760,00; silo 10.000,00 y 11.920,00; vivienda 5.000,00 y 6.920,00; taller 9.000,00 y 12.000,00;
almacen de madera 12.000,00 y 17.760,00), y el desglose de la ubicacion elegida con las 48 celdas de la
huella.

Que se pierde: dos cifras para el mismo concepto en la pantalla del catalogo, que hay que etiquetar bien para
que el jugador no las lea como una contradiccion. La etiqueta es la que resuelve §116 frente a §117 en una
linea de interfaz, y es preferible a esconder una de las dos y que el jugador descubra la diferencia al
pagar.

Que queda pendiente de vigilar: el servidor simulado no deduplica la seleccion antes de presupuestar, de modo
que una celda enviada dos veces se valora al doble frente al simulado y no frente al servidor real
(`erratas-gdd-stack.md`, apartado 5, fila 14). Afecta a cualquier prueba manual con rectangulos solapados y
lo aplica W7-A sobre `frontend/app/mock/handlers.ts`.

### Alternativas descartadas

Pedir presupuesto al servidor en cada movimiento del arrastre: una peticion por cruce de frontera de celda,
con el importe siempre un viaje por detras del cursor. La medicion de ADR-0030 da 22 recalculos por cada 321
eventos de raton; incluso a ese ritmo es trafico que no compra nada.

Confiar en el calculo local tambien para cobrar y no enviar `expectedTotal`: el campo existe en el contrato
justamente para el caso que el cliente no puede detectar, y omitirlo convierte una compra concurrente en un
cobro por un importe que el jugador no vio.

Mostrar solo el precio de la estructura, que es el que el jugador paga cuando ya tiene el suelo: el mismo
edificio costaria distinto en dos partidas sin explicacion visible, que es exactamente la confusion que §116
introduce y que la interfaz tiene que resolver.

Mostrar solo la formula de §116 con suelo: sobrevalora todas las construcciones sobre suelo propio, que es el
caso normal a partir del segundo edificio.

---

## ADR-0035 — El campo se presenta con su estado almacenado y con su proyeccion cuando difieren

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

ADR-0028 fijo que los atributos del campo que evolucionan con el tiempo —fertilidad (§77) y malezas (§82)—
se calculan de forma perezosa con marca por atributo, y que las transiciones de fase del ciclo de cultivo
(§76) son eventos agendados que un trabajo materializa. De ahi se sigue una situacion normal y no
excepcional: un campo cuyo trabajo `FIELD_ADVANCE_PHASE` todavia no ha corrido conserva en la fila su estado
anterior, mientras la proyeccion sobre el reloj de juego ya esta en el siguiente. El servidor valida contra
la proyeccion, que es la que ADR-0028 hace autoritativa.

El inspector de campo tiene que decir cual es el estado del campo y que operaciones admite (§76 y la tabla
de §90). Con dos respuestas posibles, elegir una sola es elegir un error.

### Decision

El panel muestra los dos cuando difieren, con la proyeccion como estado principal y el almacenado como linea
explicita («Estado almacenado ...; la proyeccion ya esta en ...»). Las operaciones que ofrece se evaluan
sobre la proyeccion, no sobre el almacenado, porque la proyeccion es lo que el servidor validara.

Todos los numeros del panel se proyectan localmente con las reglas compartidas y no se leen de la respuesta
sola: fertilidad, malezas, progreso de fase y rendimiento esperado se recalculan sobre el reloj del cliente
con las mismas funciones (`finalYieldLiters` y las curvas de `shared/rules`) que el servidor usa al liquidar.

### Consecuencias

El panel no parece equivocado a quien lo compare con la base de datos, porque dice literalmente lo que hay en
la fila; y no niega una operacion que el servidor acepta, porque ofrece lo que la proyeccion admite. Los dos
modos de fallo de la solucion simple quedan cerrados a la vez.

Comprobado en el navegador: los ocho estados del ciclo recorridos, Fertilidad 82,0 %, Malezas 36,0 %, Progreso
62,6 % y rendimiento esperado 16.964 L con su desglose por factores.

Coste asumido: es informacion adicional que solo tiene sentido para quien conoce el modelo, y aparece en la
interfaz de un juego. Se muestra como una linea secundaria y solo cuando los dos valores difieren, de modo que
en el caso normal no ocupa nada.

Segundo coste: la union de operaciones que el panel lista es la de las que admite la proyeccion mas las que
declara la respuesta del servidor, y las que solo estan en la segunda se muestran inhabilitadas con su motivo.
Es deliberado: ocultarlas haria desaparecer un boton entre dos repintados.

### Alternativas descartadas

Mostrar solo el estado almacenado, que es el dato que el servidor envio: el panel negaria operaciones que el
servidor acepta, y el jugador veria un campo detenido en una fase que el reloj ya dejo atras.

Mostrar solo la proyeccion: el panel afirmaria un estado que no esta en ninguna fila, y cualquier
comparacion con la base de datos o con un registro de eventos parece un defecto del cliente.

Forzar la materializacion pidiendo al servidor que avance el campo antes de pintar: convierte una lectura en
una escritura, y contradice el diseno sin tick continuo de §53 y ADR-0028, donde el trabajo agendado es quien
materializa.

Leer los numeros de la respuesta sin proyectarlos: quedarian congelados en el instante de la peticion, y
malezas y fertilidad se mueven de forma continua por definicion.

---

## ADR-0036 — Capacidad por catalogo, contenido por granja y ocupantes por edificio

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

La seccion 5.4 del plan establece una asimetria que ADR-0029 llevo al modelo: lo fungible se agrega por
granja y lo contado se comprueba por edificio. El grano almacenado (§27, §83) y la madera (§136) son
existencias de la granja frente a la capacidad sumada de sus almacenes; las maquinas de un garaje (§96) y los
trabajadores de una vivienda (§108) se cuentan contra la capacidad del edificio concreto, que es donde vive
la restriccion dura de ADR-0018.

Es una asimetria facil de romper en la interfaz, donde lo natural es dibujar «lo que hay dentro de este
edificio» para los cinco tipos por igual. Hacerlo obligaria a inventar un reparto de existencias por
edificio que el servidor no guarda, y ese reparto inventado seria lo que el jugador leeria antes de decidir
si demuele un silo.

### Decision

Tres preguntas distintas y tres fuentes distintas, sin excepcion.

La capacidad se lee del catalogo por `capacityKind` (`MACHINES`, `WORKERS`, `STORAGE`, `NONE`), nunca con un
`switch` por tipo de edificio, de modo que anadir un edificio a `shared/config/buildings.ts` no obliga a
tocar ningun panel. El contenido de un almacen se muestra como existencias de la granja y el panel lo dice
con esas palabras. Los ocupantes se listan por edificio, que es donde el servidor comprueba la capacidad y
donde nace el rechazo.

El inspector reproduce las dos negativas previsibles de la demolicion con el codigo del contrato,
`BUILDING_NOT_EMPTY` en los dos casos y en el mismo orden en que el servidor las evalua: edificio con
ocupantes, y almacen cuya retirada dejaria las existencias de la granja sin sitio.

Consecuencia de interfaz de ADR-0029 que se registra aqui porque es donde se ve: fundar una granja no es una
operacion fisica. El formulario de fundacion es un nombre y un boton, sin coste, sin huella y sin clave de
idempotencia, y el panel lo dice en una linea junto al formulario. Lo que ocupa celdas y cuesta dinero es
cada edificio.

### Consecuencias

El panel no afirma nada que el modelo no sepa. Comprobado en el navegador: `GARAJE 4/4` y `VIVIENDA 2/4` como
ocupacion contada por edificio, `Silo (§27) 18.400 L de 100.000 L` y `Almacen de madera (§136) Sin almacen
construido` como existencias de la granja frente a capacidad sumada, y el taller mostrando su funcion —da
acceso a la reparacion de maquinaria (§29)— en lugar del cero sin significado que informa su columna de
capacidad.

El inspector queda mas estricto que el servidor simulado y coincide con el servidor real: el simulado solo
rechaza la demolicion por ocupantes, mientras que el backend rechaza ademas cuando retirar un almacen dejaria
las existencias por encima de la capacidad restante. Es la direccion correcta de la diferencia —el cliente
niega lo que el servidor negaria— y conviene saberla antes de interpretar una prueba manual contra el
simulado.

Coste asumido: un jugador que abre un silo no ve «lo que hay en este silo», que es lo que su intuicion pide.
Ve las existencias de su granja y la aportacion de este edificio a la capacidad. Es lo que el modelo sabe y
lo que la demolicion evalua.

### Alternativas descartadas

Repartir las existencias entre los almacenes para pintarlas por edificio: un dato inventado en la capa de
presentacion, que ademas cambiaria al demoler un edificio distinto del que lo muestra.

Un `switch` por tipo de edificio en el panel para decidir que capacidad enseñar: cada edificio nuevo del
catalogo obligaria a tocar tres paneles, y el catalogo de §116 es precisamente el sitio pensado para crecer.

Leer la capacidad de la columna `capacity` del DTO: el taller informa cero, que no significa «no caben
maquinas» sino «este edificio no tiene capacidad contada». La columna sirve para la ocupacion y el catalogo
para la capacidad.

Ocultar la segunda negativa de la demolicion porque el servidor simulado no la produce: el jugador
descubriria la regla con un 409 despues de haber decidido demoler.

---

## ADR-0037 — Organizacion de la capa de paneles: preferencias fuera de Pinia, piezas compartidas en el directorio de su materia y un componente para dos superficies

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

Trece paneles escritos por dos agentes en paralelo obligaron a fijar tres cuestiones de estructura que la
seccion 9.6 del plan no resuelve y que, resueltas mal, producen trabajo perdido en la fase siguiente.

La primera: donde vive el estado de interfaz que no viene del servidor. W3-C escribio dieciocho almacenes de
Pinia alimentados por el reductor de tramas, y `useShellUi` ya habia dejado fuera su propio estado por el
mismo motivo por el que aqui se plantea. Los ajustes del cliente —rejilla, contornos, umbral de nivel de
detalle, sensibilidad del zoom y movimiento reducido— no se reducen de ninguna trama y no son autoritativos
para nadie.

La segunda: donde vive el codigo que comparten varios paneles. Cada agente posee directorios de panel y
ninguno por encima de ellos, de modo que un directorio nuevo bajo `components/panels/` seria una ruta que la
tabla de propiedad no atribuye a nadie, que es la situacion que la regla 1 de la seccion 11 del plan existe
para evitar.

La tercera: el flujo de construccion en tres pasos vive dentro del panel de granja y a la vez el registro
declara `building-placement` como panel propio, porque el modo de colocacion del lienzo tiene que abrir algo.

### Decision

Las preferencias del cliente no van a Pinia. Viven en `settings/preferences.ts`, se persisten bajo una unica
clave de `localStorage` y se leen de forma defensiva: `normalisePreferences` es total sobre `unknown`, de
modo que una clave ilegible toma su valor por omision en lugar de tirar las otras cuatro. Meterlas en un
almacen invitaria al reductor a escribirlas.

Las piezas compartidas entre paneles viven en el directorio de la materia a la que pertenecen y no en un
directorio nuevo: el vocabulario y la escala junto a la leyenda, que es donde se publican al jugador; el
acceso al mundo (`panelCellReader`, `ensureChunksFor`, `ensureFieldGeometry`, `startSelectionMode`,
`judgeSelection`, `reasonLines`) junto al inspector de celda, que es el panel que responde «que es esta
celda»; el plan de colocacion junto al panel de colocacion.

Un componente puede servir dos superficies. `BuildingPlacementPanel` acepta `embedded` y el panel de granja
lo monta como paso tres; el registro lo carga como panel propio para el camino que llega desde el lienzo.
Escribir dos veces el desglose de coste habria producido dos verdades sobre el mismo importe, que es el
defecto que ADR-0034 existe para evitar.

### Consecuencias

Ningun directorio del arbol queda sin propietario, y el reparto de `docs/ownership.md` sigue siendo cierto
fichero a fichero despues de trece paneles escritos en paralelo. Las marcas de tiempo confirman que los dos
agentes de esta fase escribieron en directorios disjuntos y que ningun fichero tuvo dos escritores.

Las preferencias sobreviven a una recarga sin ampliar la superficie de estado sincronizado, y su suite corre
sin Pinia y sin transporte.

Coste asumido: `legend/` y `cell-inspector/` son a la vez paneles y modulos de servicio de otros paneles, que
es una asimetria que hay que conocer para no borrarlos al reescribir su panel. Esta declarada en la cabecera
de cada fichero compartido y en el apartado 2 de `NOTES-w4e.md`. La forma natural de deshacerla, si W5 o W6
necesitan mas piezas comunes, es crear `components/panels/shared/` con una fila propia en la tabla de
propiedad y un unico agente responsable.

Segundo coste, ya conocido: `building-placement` esta declarado `MODAL` en el registro, y con un modal
abierto el arbitraje de entrada de `useShellUi` deshabilita el lienzo (`worldInputEnabled = modals.length === 0`),
de modo que el fantasma no seguiria al cursor. Deberia ser `SIDE`. El registro esta congelado; en esta fase se
mitiga embebiendo el panel en el lateral de granja, y el cambio queda anotado para W7 en `NOTES-w4f.md`,
apartado 2.2.

### Alternativas descartadas

Un almacen de Pinia para las preferencias: nada de eso se reduce de una trama ni es autoritativo, y el
reductor es un escritor que no deberia poder tocarlas. `useShellUi` ya tomo la misma decision para su estado
por el mismo motivo.

Persistir cada preferencia en su propia clave: multiplica los puntos de fallo de la lectura sin ganar nada;
la lectura defensiva sobre un unico objeto ya aisla una clave corrupta.

Un directorio `components/panels/shared/` creado por un agente que no lo posee: la tabla de propiedad no lo
atribuiria a nadie y el siguiente agente que necesitase escribir alli no sabria si puede.

Duplicar el desglose de coste entre el panel de granja y el panel de colocacion: dos verdades sobre el mismo
importe, que es exactamente lo que el modulo de plan de ADR-0033 existe para impedir.

---

## ADR-0038 — La lista de lo que sigue siendo andamiaje se deriva del registro y no se mantiene a mano

Fase: W4 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

La regla 3 de la seccion 11 del plan —registro con stubs, nunca registro por anadido— hace que cada ruta del
contrato exista desde W3 con su ruta y su firma definitivas, respondiendo 501 con `NOT_IMPLEMENTED` hasta que
el agente de su modulo sustituye el andamiaje. W3-A escribio la prueba que sostiene esa promesa,
`backend/src/__tests__/app.int.test.ts`, con una lista literal de las rutas ya implementadas y la afirmacion
de que todas las demas responden 501.

La lista tiene un defecto estructural: convierte «este modulo ya esta implementado» en un fallo de compilacion
en un fichero de otro agente. Ocurrio dos veces. Al cierre de W3, cuando el modulo de mundo empezo a servir sus
dos rutas; y otra vez al cierre de W4, cuando los tres modulos de dominio de la fase sirvieron doce, dejando
cuatro pruebas en rojo de 182. En ambos casos el fichero era el punto de encuentro de tres agentes que
trabajaban en paralelo, ninguno podia editarlo sin borrar a los otros dos, y los tres se abstuvieron
deliberadamente y dejaron el cambio en su nota de traspaso, que es el comportamiento correcto bajo la regla 1.

El mismo defecto existe hoy en el cliente:
`frontend/app/components/panels/__tests__/registry.test.ts` exige de los veintitres paneles el texto «No
implementado», y falla en cuanto uno deja de ser andamiaje.

### Decision

La lista de andamiajes se deriva del propio registro. `backend/src/plugins/routes.ts` acumula en
`registeredStubKeys` toda clave registrada por `defineStubRoute` y la publica con `stubRouteKeys()`;
`app.int.test.ts` la consume y afirma, para cada clave que sigue en esa lista, que la ruta responde 501 con
`NOT_IMPLEMENTED`. No hay ningun literal que mantener: sustituir un andamiaje por su implementacion retira la
ruta de la lista en la misma linea en que se retira la llamada a `defineStubRoute`.

Lo que la prueba afirma sobre el conjunto cambia en consecuencia: no un recuento exacto, que es un numero
pensado para bajar en cada fase, sino que los andamiajes son un subconjunto propio del contrato y que al menos
una ruta ya se sirve. El recuento total de rutas del contrato si se afirma —55—, porque ese no debe cambiar sin
que alguien lo decida.

El principio general que esto fija: una prueba que afirma el estado de avance del proyecto lo deriva del
artefacto que ese estado produce, nunca de una copia. Una lista escrita a mano de lo que falta es una segunda
declaracion de la verdad, y quien la incumple no es quien la escribio.

### Consecuencias

`make test-int` queda en verde —16 ficheros y 142 pruebas— y deja de romperse en cada fase que implementa un
modulo. La invariante que W3-A queria proteger sigue intacta y ademas se mantiene sola: hoy son 28 andamiajes
de 55 rutas, en seis areas (`economy`, `forestry`, `machinery`, `tasks`, `workers` y `state`), y cuando W5 y W6
sustituyan los suyos ningun fichero de otro agente tendra que cambiar.

La cobertura completa del contrato sigue comprobada en el arranque y no por una lista: `src/app.ts` recoge lo
registrado por el hook `onRoute` y lanza `IncompleteRouteRegistryError` si falta alguna ruta, de modo que llegar
a ejecutar las pruebas ya es la afirmacion.

Queda pendiente aplicar el mismo tratamiento al registro de paneles, que es el unico rojo que W4 deja. El cambio
esta escrito en `NOTES-w4e.md` apartado 1.1 y en `NOTES-w4f.md` apartado 2.1: montar los veintitres, exigir el
marcador «No implementado» solo a los que siguen montando `UiPendingPanel`, y seguir exigiendo a todos que
monten sin error de consola. `registry.test.ts` es de W3-C y esta congelado; lo aplica W7-A.

Coste asumido: `stubRouteKeys()` es estado de modulo poblado como efecto lateral del registro, y solo es
correcto despues de construir la aplicacion. Es aceptable porque el unico consumidor es una prueba de
integracion que ya construye la aplicacion en su `beforeAll`, pero no debe convertirse en una consulta de
tiempo de ejecucion.

### Alternativas descartadas

Mantener la lista literal y aplicarla en la ventana de parcheo de cada fase: ya se hizo dos veces y volvio a
romperse las dos. Una invariante que exige intervencion manual en cada fase no es una invariante.

Que cada agente de modulo edite el literal al implementar su modulo: es lo que la regla 1 prohibe, porque tres
agentes en paralelo sobre el mismo fichero significan que el ultimo en escribir borra a los otros dos.

Afirmar el recuento exacto de andamiajes: el numero esta pensado para bajar en cada fase, y afirmarlo convierte
cada avance en un fallo.

Eliminar la prueba y confiar en que el 501 esta bien: es la unica comprobacion de que el cliente puede
distinguir «esto no esta construido todavia» de «esta ruta no existe», que es la razon por la que el andamiaje
responde 501 y no 404.

---

## ADR-0039 — Deuda, interes de descubierto y liquidacion forzosa

Fase: W5 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

El GDD no define la quiebra. Define el capital inicial (§117), los costes continuos de posesion y de
operacion (§107, §114), el ingreso de la primera cosecha (§119) y el punto de equilibrio (§121), y en §119
anticipa que el primer ciclo no sera rentable, pero no dice que ocurre cuando el saldo cruza el cero.

Con los valores del catalogo sin ajustar, ese cruce no es un caso limite sino el estado esperado. El
informe de balance que esta fase genera lo mide: 25.688,78 $ de coste de posesion por ciclo frente a
2.475,00 $ de ingreso, margen de -23.213,78 $ y ratio ingreso/coste de 0,096 frente al objetivo de 1,3 a
1,8 que fija §125. La deuda esta por tanto en el camino critico del diseno y no en su periferia.

Dos restricciones acotan la respuesta. La primera es la invariante de la seccion 6.2 del plan: el saldo
solo puede volverse negativo por el devengo del paso del tiempo, nunca por una adquisicion, porque toda
adquisicion compara contra el saldo ya liquidado dentro de la misma transaccion. La segunda es que el
juego es asincrono (§52): lo que se decida ocurre mientras el jugador esta desconectado y debe poder
explicarse al regreso.

### Decision

Cuatro partes.

1. `IN_DEBT` es un estado derivado del saldo liquidado y de nada mas. No es una columna, no se escribe y no
   puede desincronizarse. Bloquea el gasto discrecional —comprar tierra, edificios y maquinaria, y
   comprometer un salario nuevo— y no bloquea vender ni asignar tareas. La asimetria no es una concesion:
   vender es la unica via de ingreso, y bloquearla convertiria la deuda en un bloqueo permanente. El
   codigo del rechazo es `SPENDING_BLOCKED_IN_DEBT` con 402 y no `INSUFFICIENT_FUNDS`, porque no hay
   importe requerido que comparar y porque nombrar el estado senala la salida.

2. El interes de descubierto existe como cuarto tipo de devengo, junto a salarios, mantenimiento y
   operacion, con tasa cero. Esta implementado de extremo a extremo y desactivado por el valor de la
   constante, no por una rama de codigo. Es una palanca de balance disponible sin migracion; cobrarlo hoy
   solo profundizaria un deficit que el propio GDD documenta.

3. La liquidacion forzosa se dispara cuando la deuda supera una fraccion del valor liquidable, no una
   cifra absoluta, de modo que el umbral escala con el jugador. Recorre `LIQUIDATION_STEPS` de
   `shared/config/economy.ts` en su orden publicado —inventario, maquinas ociosas, tareas canceladas,
   trabajadores, edificios y tierra sin campo— y se detiene en cuanto el saldo deja de ser negativo:
   vender mas de lo que la deuda necesita seria confiscacion y no liquidacion. Dentro del paso de
   inventario se venden solo las unidades necesarias, redondeadas al alza.

4. La dispara el barrido periodico y no el login. Una liquidacion que apareciera al volver se leeria como
   un castigo por haberse ausentado, y ausentarse es legitimo en un juego asincrono.

El rastro contable es un asiento por activo vendido, con su tipo de venta propio, `refType` y `refId`
apuntando al activo y el paso en `meta`, mas un unico asiento agregado de tipo `LIQUIDATION` e importe
cero que lleva en `meta` la deuda previa, el valor liquidable, el umbral, lo recaudado y la lista de
activos y de pasos. El agregado vale cero porque el dinero ya se movio en los asientos por activo, y
contarlo dos veces romperia la auditoria de ADR-0009, que exige que la suma de los asientos sea el saldo.
Un trabajador no se vende: se despide, lo que detiene el devengo salarial, y el despido queda registrado
donde queda cualquier otro, en `Worker.terminatedGameMs`.

`BANKRUPT` sigue en el enumerado y no se produce nunca. Terminar la partida de alguien que estaba
desconectado no es aceptable en un juego asincrono, y el escalon 3 ya es consecuencia suficiente.

### Consecuencias

El saldo negativo deja de ser un fallo y pasa a ser un estado con nombre, con efectos acotados y con una
salida. El resumen de regreso de §124 puede explicar que se vendio, por que y en que orden, porque cada
venta forzosa dejo su asiento y el agregado lleva la explicacion completa.

Alcance real de la liquidacion al cierre de esta fase, que el informe de balance declara para no prometer
mas de lo que el codigo hace: de los seis pasos del orden publicado estan activos inventario, maquinas
ociosas y trabajadores. Los otros tres estan declarados y sin estrategia porque su semantica pertenece a
modulos que aun no existen o que pertenecen a otra fase: `CANCEL_TASKS` a `modules/tasks` (W6-A),
`BUILDINGS` a `modules/farms` y `UNUSED_LAND` a `modules/world`. El motor recorre el orden completo y el
asiento agregado registra los pasos que ejecuto y los que no, de modo que anadir una estrategia no cambia
el motor.

Coste asumido y pendiente de vigilar: `registerSettleSweepHook` no tiene punto de registro en el proceso
`worker`, porque `src/worker.ts` no construye la aplicacion Fastify. Hoy solo el servidor aplica la
liquidacion, lo que significa que un jugador cuyo barrido corre exclusivamente en el proceso de la cola
acumula deuda sin liquidar hasta su siguiente peticion. El parche son dos lineas en `handlers.ts`, esta
escrito en `NOTES-w5c.md` apartado 2.1 y lo aplica W7-A.

La guarda de gasto discrecional queda ademas sin consumir por los dos modulos hermanos de la fase, que no
pueden importarla por la regla 4 del plan. La contratacion la reproduce por su cuenta, con el mismo codigo
de rechazo; la compra de maquinaria compara contra el saldo liquidado, que es la otra mitad de la misma
politica.

### Alternativas descartadas

Prohibir el saldo negativo con una restriccion de tabla: rechazaria el propio devengo, que es legitimo y
es la unica causa admitida de deuda. La restriccion abortaria la transaccion que cobra los salarios, no la
que gasta.

Bloquear tambien la venta y la asignacion de tareas mientras hay deuda: coherente en apariencia y un
bloqueo permanente en la practica. Un jugador endeudado sin forma de ingresar no tiene partida.

Activar el interes de descubierto con una tasa distinta de cero: profundiza un deficit ya documentado y
convierte una desviacion de balance del GDD en una espiral. La constante existe para que el dia que el
balance se ajuste, la palanca este.

Umbral de liquidacion como cifra absoluta: no escala. Diez mil de deuda son irrelevantes para quien tiene
un parque de maquinaria y terminales para quien empieza.

Un unico asiento de liquidacion por el importe total: pierde que se vendio. El resumen de regreso solo
podria decir que se recaudo una cantidad, que es exactamente la informacion que el jugador ausente no
tiene.

Disparar la liquidacion en el login: es lo mas facil de implementar, porque el login ya avanza al jugador,
y es lo peor de leer. Convierte volver en el hecho que provoca la perdida.

---

## ADR-0040 — La tarea como unico vinculo entre trabajador y maquina, y el desgaste por horas trabajadas

Fase: W5 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

El GDD propone en §98 y §101 dos punteros cruzados, `Machine.currentTaskId` y `Worker.currentTaskId`, y en
§111 describe la tarea como la entidad que ata trabajador, maquinaria y campo. Son dos declaraciones del
mismo hecho, y dos declaraciones del mismo hecho se desincronizan. La seccion 5.2 del plan ya lo resolvio a
favor de la tarea, y `schema.prisma` lo implementa: `Task.workerId` mas la tabla `TaskMachine`.

Esta fase es la primera que tiene que sostener esa decision con codigo, porque escribe las dos entidades
que la tarea ata sin escribir todavia el motor de tareas, que es de W6-A. Aparecen entonces dos preguntas
que el reparto obliga a contestar ahora: como comprueba un modulo que un recurso esta libre sin poder
importar el modulo hermano que lo posee, y quien aplica el desgaste de §93 cuando la tarea que lo genero
la cierra otro modulo de otra fase.

A ellas se suma un caso concreto que la venta de maquinaria plantea. Vender una maquina reservada por una
tarea en curso dejaria la tarea apuntando a una fila con borrado logico, y el estado de la maquina, la
columna de reserva y el enlace `task_machines` son tres sitios distintos donde ese hecho es visible.

### Decision

La tarea es el unico vinculo autoritativo. Los modulos de maquinaria y de trabajadores no escriben ese
vinculo: publican las funciones con las que el motor de tareas de W6-A lo escribira, y las usan ellos
mismos para negarse cuando el recurso ya esta comprometido.

`modules/machinery` publica `requireAssignableMachines(db, playerId, ids, minConditionBp)` y
`applyMachineWear(tx, ids, horas, atGameMs)`, con su variante por intervalo. `modules/workers` publica
`requireIdleWorker`, `requireWorkerOfFarm`, `reserveWorkerForTask`, `releaseWorkerFromTask`,
`applyTaskCompletion` y `accruedWages`. Ninguna de las dos superficies importa a la otra: son modulos
hermanos de la misma fase y la regla 4 del plan lo prohibe, comprobado por las zonas de
`eslint.config.js`.

El desgaste se pasa en horas y no en instantes. El motivo es §106: la cancelacion prorratea el desgaste
sobre las horas realmente trabajadas, que el motor de tareas ya calcula, y pasarle un intervalo obligaria
a recalcularlas dos veces con dos aritmeticas distintas. La variante por intervalo existe porque
`[startGameMs, endedGameMs)` es exactamente el intervalo sobre el que `lib/accrual.ts` integra el coste de
operacion, de modo que las horas que desgastan y las horas que se facturan son las mismas por
construccion y no por coincidencia.

Tres propiedades de las que el llamante depende y que la superficie garantiza: cero o menos horas no
escriben nada, porque una tarea cancelada en el instante en que empezo trabajo nada; la marca de condicion
no retrocede, de modo que una segunda entrega del mismo cierre de tarea es inocua, que es lo que BullMQ
exige; y no existe degradacion por inactividad, conforme a §93 y §99, que es la razon de que la marca solo
se mueva cuando hay horas contabilizadas.

`MACHINE_NOT_IDLE` cubre las tres capas del mismo hecho. La venta comprueba el estado de la maquina, la
columna de reserva `currentTaskId` y el enlace `task_machines` con una tarea `IN_PROGRESS`. El contrato no
tiene un codigo distinto para "reservada por una tarea", y no hace falta: lo que el panel necesita saber
es que no esta disponible.

### Consecuencias

El estado de un recurso se deriva y no se declara. Un trabajador esta ocupado si existe una tarea suya en
curso, y una maquina lo mismo; no hay ningun camino en el que una de las dos columnas quede colgada
apuntando a una tarea que ya termino.

W6-A recibe una superficie ya ejercitada en lugar de una especificacion. Las funciones existen, tienen
pruebas de integracion y las usan sus propios modulos, de modo que el motor de tareas no las estrena.

Coste asumido: la comprobacion de disponibilidad se escribe dos veces, una en cada modulo, porque los
hermanos no pueden compartirla. Es el precio de la regla 4 y es deliberado; lo que no se duplica es la
verdad, que sigue estando en la tabla de tareas.

Pendiente de vigilar: `applyMachineWear` y `reserveWorkerForTask` no tienen hoy mas llamante que las
pruebas y el propio modulo. El primer consumidor real es W6-A, y es ahi donde se comprobara que el
intervalo que factura y el que desgasta coinciden en un cierre real y en una cancelacion real.

### Alternativas descartadas

Mantener los dos punteros cruzados de §98 y §101 como fuente de verdad: son dos escrituras que hay que
mantener coherentes en cada transicion, y basta una cancelacion que falle a medias para dejar una maquina
marcada como ocupada sin tarea que la ocupe. La columna se conserva como reserva y se comprueba, pero no
es la autoridad.

Que `modules/tasks` escriba directamente en las tablas de maquinaria y de trabajadores: rompe la propiedad
por modulo, y ademas duplica en W6 el conocimiento de que significa que una maquina este disponible, que
es de W5.

Aplicar el desgaste dentro del propio modulo de tareas con la formula copiada: es la misma duplicacion que
ADR-0033 ya documento en el cliente, y aqui no hay ninguna razon de zona que la obligue.

Pasar el desgaste como intervalo y calcular las horas dentro: obliga a que la funcion sepa como se
descuentan las pausas y las cancelaciones, que es conocimiento del motor de tareas y no de la maquinaria.

Anadir un codigo de error propio para "reservada por una tarea": es una adicion a `shared/api/errors.ts`,
que esta congelado, para distinguir tres casos que el jugador vive como uno solo.

---

## ADR-0041 — La reparacion como evento agendado cuya duracion codifica los puntos comprados

Fase: W5 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

El GDD describe la reparacion en §93 como una operacion con coste proporcional a los puntos de condicion
que faltan, exige un taller en §29 y §95, y no le asigna duracion. `IN_REPAIR` figura ademas en §95 como
estado reservado que nadie produce. La seccion 2.2 del plan resuelve las tres cosas a la vez: la
reparacion es un evento agendado con duracion proporcional a los puntos a restaurar, exige taller y activa
`IN_REPAIR`, sin consumir trabajador.

Implementarlo choca con dos invariantes ya fijadas. La primera, del plan 6.4 y de ADR-0016: un
`ScheduledEvent` transporta identificadores, `dueGameMs` y `epoch`, y nunca cantidades, precisamente
porque una cantidad se habria calculado en el pasado y el manejador debe recalcular con la funcion pura
que es la autoridad. La segunda, del plan 6.5 y de ADR-0028: cada atributo perezoso lleva su propia marca
temporal y el trabajo agendado solo materializa lo que la funcion pura ya dice.

Queda entonces una pregunta concreta: donde vive la condicion objetivo de una reparacion parcial, que el
contrato admite con `toConditionBp`, si no puede viajar en el evento y `Machine` no tiene columna para
ella.

### Decision

No vive en ninguna parte, porque la longitud de la reparacion es el numero de puntos pagados:

```text
durationGameMs = (objetivoBp - condicionBp) x REPAIR_MS_PER_CONDITION_POINT / 100
restauradoBp   = (repairEndsAtGameMs - conditionUpdatedAtGameMs) x 100 / REPAIR_MS_PER_CONDITION_POINT
```

`conditionUpdatedAtGameMs` se escribe con el instante en que arranca la reparacion, que es cierto en el
sentido estricto que la columna tiene: la condicion quedo liquidada entonces y no puede moverse mientras
la maquina esta en el taller, porque el desgaste solo se aplica a horas trabajadas (§93, ADR-0040) y una
maquina `IN_REPAIR` no puede asignarse a una tarea. El manejador recalcula lo que la peticion compro en
lugar de recordarlo, que es la misma disciplina que `modules/fields` sigue con la fase proyectada. Las dos
conversiones son exactas en enteros: 0,25 h por punto son 900.000 ms, y 9.000 ms por punto basico.

La reparacion parcial se valora con la misma regla compartida evaluada dos veces:
`repairCostBetween(c, t) = repairCost(c) - repairCost(t)`, que por construccion es
`repairCostPerPoint x (t - c) / 100` y coincide exactamente con `repairCost(c)` cuando el objetivo es la
condicion plena de §93. Lo mismo con la duracion. No hay por tanto una segunda formula para el caso
parcial que pueda divergir de la de §93.

Consecuencia declarada del contrato: `pointsRestored` esta tipado como entero positivo mientras que la
restauracion es exacta en puntos basicos. Se informa `Math.ceil((objetivo - condicion) / 100)`, de modo
que una maquina cuya condicion no es un numero entero de puntos informa el punto en el que esta. El
importe cobrado es siempre el exacto.

### Consecuencias

`IN_REPAIR` pasa de estado reservado a estado real, y con el la maquina desaparece del conjunto asignable
durante toda la reparacion, lo que da al taller de §29 una funcion que el GDD enunciaba y no cerraba. La
metrica `farm_world_scheduled_events_unhandled_total` deja de contar `MACHINE_REPAIR_COMPLETE`.

El valor de reventa que el panel muestra es siempre el de la condicion real, porque la condicion no se
mueve hasta que la reparacion termina. Una maquina en el taller no vale lo que valdra.

Coste asumido: la condicion objetivo solo es recuperable mientras el evento existe. Si la fila del evento
se perdiera, la reparacion quedaria sin cierre y la maquina en `IN_REPAIR` indefinidamente. Es aceptable
porque `ScheduledEvent` es la lista autoritativa de ADR-0016 y vive en PostgreSQL, no en Redis, que es
precisamente la razon por la que aquella decision se tomo asi.

Verificado con salida real por HTTP: reparacion de una cosechadora al 50 % con taller, `IN_REPAIR`,
`pointsRestored` 50, importe 2.700,00 y `repairDurationGameHours` 12,5, con la diferencia entre las dos
marcas de juego igual a 45.000.000 ms; venta durante la reparacion rechazada con `MACHINE_NOT_IDLE`; y
reparacion sin taller rechazada con `WORKSHOP_REQUIRED`.

### Alternativas descartadas

Restaurar la condicion al agendar y usar `IN_REPAIR` unicamente como marca de ocupacion: es mas simple y
es mentira. Deja una maquina al 100 % que todavia esta en el taller, y el valor de reventa que el panel
muestra pasa a ser el de una reparacion que no ha ocurrido.

Llevar la condicion objetivo en el `payload` del evento: contradice la invariante 4 del plan por la razon
exacta que esa invariante protege, y ademas duplica una cifra que la duracion ya expresa.

Anadir una columna `repairTargetConditionBp` a `Machine`: exige migracion, anade un estado que solo tiene
sentido durante una ventana temporal y que hay que limpiar despues, y crea la posibilidad de que la
columna y la duracion discrepen.

Una segunda formula para la reparacion parcial: dos formulas para el mismo concepto es exactamente lo que
ADR-0027 y ADR-0030 evitan en otros puntos del sistema, y no hay ninguna razon para hacer aqui la
excepcion.

---

## ADR-0042 — El pool de contratacion: regla procedural determinista, reemplazo integro y listado perezoso

Fase: W5 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

§102 describe el pool de contratacion con una regla procedural —habilidad entre el 30 % y el 90 %, salario
correlacionado con la habilidad mas ruido— y tres candidatos de ejemplo. No declara el tamano del pool, no
da valor ni unidad a `poolRefreshInterval`, y sus tres candidatos no son colineales, de modo que
"correlacionado mas ruido" no determina una recta. La errata 39 ya fijo lo que falta: tamano 3 por
literalidad del ejemplo, intervalo de 48 horas de juego por coherencia con el resto del dominio, y ajuste
por minimos cuadrados sobre los tres candidatos publicados.

§102 anade una frase que si hay que interpretar: al contratar, el candidato se retira y aparece uno nuevo
tras `poolRefreshInterval`. Admite dos lecturas, rellenar la plaza vacia o renovar el pool completo, y hay
que elegir una.

Queda una restriccion de reparto. El jugador lo crea `modules/auth`, que pertenece a una fase congelada y
que no sabe nada de contratacion, de modo que no existe ningun punto de registro donde listar el primer
pool sin reabrir un modulo cerrado.

### Decision

Tres puntos.

El refresco reemplaza el pool entero. Con relleno, los candidatos no contratados permaneceran listados
indefinidamente y el jugador podria reservar al candidato ideal y contratarlo cuando le conviniera, con lo
que el intervalo de §102 no aplicaria a nada y la seccion dejaria de describir una decision. La renovacion
completa satisface ademas la primera lectura, porque la plaza del contratado se rellena en el siguiente
vencimiento. El candidato retirado conserva su fila con `removedGameMs`, que es lo que hace auditable el
refresco e impide contratarlo dos veces.

El pool se lista de forma perezosa en la primera lectura, con el mismo patron que el ciclo de cultivo: el
estado se deriva del reloj y se materializa cuando alguien mira. La consecuencia declarada es que una ruta
GET escribe. Se acota a un unico caso —ausencia de evento de refresco pendiente, que solo puede darse
antes del primer listado, porque el manejador agenda siempre el siguiente—, la escritura toma el cerrojo
de la fila del jugador para que dos primeras peticiones concurrentes no dejen seis candidatos, y no emite
ningun marco, porque el contrato no declara `emits` para esa ruta y la respuesta ya lleva el pool.

El refresco salta intervalos enteros en lugar de reproducirlos. `advancePlayer` lee su lote de eventos
vencidos antes de ejecutar los manejadores, de modo que un manejador que agende el siguiente vencimiento
en el pasado no lo aplica en la misma pasada. El ciclo de cultivo acepta ese coste porque cada frontera de
fase deja historia en la fila; el pool no la deja: solo se puede contratar del pool listado ahora, y
ninguna de las renovaciones que un jugador desconectado nunca vio cambia el ledger ni ninguna otra fila.
`poolCatchUp` calcula por tanto la ultima frontera anterior o igual al instante actual y agenda la
siguiente, de modo que una ausencia de tres semanas de juego se resuelve con un refresco y no con
doscientas idas y vueltas de la cola, sin salirse de la reticula de 48 horas y sin deriva.

La generacion reutiliza `hashGrid` de `shared/world/terrain.ts`, que es el finalizador de avalancha de 32
bits ya auditado y con pruebas de determinismo, con sus cinco ranuras llevando semilla del mundo,
jugador, generacion, ranura del pool y atributo. El mismo mundo, jugador e instante reconstruyen el mismo
pool.

Por ultimo, "validar dinero" de §102 se lee como la politica de deuda de ADR-0039 y no como una tasa de
contratacion: ni el catalogo define coste de contratacion ni §109 define indemnizacion. Comprometer un
salario es gasto discrecional, y un saldo liquidado negativo lo bloquea con
`SPENDING_BLOCKED_IN_DEBT` (402). Contratar y despedir no mueven dinero, no escriben asiento y no llevan
clave de idempotencia; lo que protege una contratacion de un doble envio es que el candidato sale del
pool, con `CANDIDATE_NOT_AVAILABLE`.

### Consecuencias

El pool es reproducible en una prueba: se puede afirmar algo sobre un candidato concreto sin fijarlo en un
fixture, que es lo que hace exigible la banda de §102 en lugar de meramente enunciarla.

`WORKER_POOL_REFRESH` deja de ser un evento sin manejador y la metrica
`farm_world_scheduled_events_unhandled_total` deja de contarlo.

De los seis estados de `WorkerStatus`, se escriben dos: `IDLE` y `WORKING`. `TRAVELING`, `UNAVAILABLE`,
`RESTING` e `INJURED` quedan declarados como vocabulario en el servicio, sin ninguna ruta que los
produzca, conforme a §35, §101 y §112 y a la politica de reserva agresiva de enumerados de ADR-0013.

Desviacion medida y aceptada: los tres salarios del ejemplo de §102 no son exactamente reproducibles con
la recta ajustada —11,50, 19,15 y 30,85 frente a 12, 18 y 31—, y caen dentro de la banda de ruido del
12 % que el propio §102 declara. Es lo unico que una regla procedural puede sostener, y ajustar la recta a
uno de los tres desajustaria los otros dos.

Coste asumido: la suite unitaria del pool, `pool.test.ts`, no entra en ninguna puerta, porque
`make test-unit` no recorre el backend. Se mitiga comprobando la banda de §102 una segunda vez en
`hiring.int.test.ts`, que si entra en `make test-int`. El defecto de la puerta esta registrado desde W4 con
propietario W7-A.

### Alternativas descartadas

Rellenar la plaza vacia en lugar de renovar el pool: convierte el intervalo de §102 en una formalidad y
permite reservar al mejor candidato indefinidamente.

Listar el primer pool al registrar al jugador: exige reabrir `modules/auth`, que esta congelado, y le
anade conocimiento de un dominio que no es el suyo.

Reproducir cada refresco vencido: doscientas idas y vueltas de la cola para reconstruir un estado que no
deja historia y del que solo el ultimo valor es observable.

Un pool global compartido entre jugadores: introduce contencion entre jugadores que el MVP evita
explicitamente, conforme a la seccion 5.2 del plan. El campo `region` queda reservado para el dia que se
quiera.

Un segundo mezclador de hash propio del modulo: una segunda funcion de aleatoriedad determinista que
mantener y que auditar, cuando la existente ya tiene pruebas de determinismo sobre mil chunks.

Cobrar una tasa de contratacion para dar contenido a "validar dinero": es inventar un numero de balance
sin respaldo en el catalogo, que es exactamente lo que ADR-0014 delimita.

---

## ADR-0043 — Mercado e historico: precio del catalogo, unidad almacenada como unidad de calculo y paginacion por secuencia

Fase: W5 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

§123 fija el precio de venta sin fluctuacion y §133 publica el precio de la madera por metro cubico,
mientras que las existencias se guardan en la unidad entera del recurso —litros de grano y decimetros
cubicos de madera— por la decision de cantidades fungibles enteras de ADR-0013. Hay por tanto dos
unidades en juego, la que el jugador lee y la que el servidor almacena, y una de las dos tiene que ser la
unidad de calculo.

Del lado del historico, `GET /api/economy/ledger` es la primera ruta paginada del contrato. El ledger es
ademas la unica tabla del sistema que crece sin techo y sobre la que se escribe mientras se lee: el
devengo continuo de ADR-0024 inserta asientos en cualquier momento, incluido el momento en el que un
jugador esta paginando su historico.

### Decision

El precio es dato del catalogo y viaja por su propia ruta. `GET /api/market/prices` existe para que el
cliente no reescriba 0,22 y 45, y publica dos cifras por recurso, la de la unidad almacenada y la de la
unidad mostrada, junto con el divisor entre ambas.

El servidor calcula siempre sobre la unidad almacenada y con las reglas compartidas `cropSaleRevenue` y
`woodSaleRevenue`, que multiplican primero y dividen una sola vez. El precio por unidad almacenada es
exacto con el catalogo actual y la suite lo comprueba; si un precio futuro hiciera divergir las dos vias,
la regla compartida es la autoridad y el precio por unidad pasa a ser una cifra de presentacion.

En la venta, la retirada de existencias precede al abono y va detras de la comprobacion de la clave de
idempotencia. La guarda HTTP de `plugins/auth.ts` reproduce la respuesta almacenada, y la comprobacion de
idempotencia del ledger es la segunda defensa: colapsa el asiento, no la retirada que ocurrio antes de el.

El historico se pagina por `seq`, en orden descendente, y no por desplazamiento. `seq` es unico y monotono
por jugador y esta indexado con el (ADR-0009). Un desplazamiento relee las filas que salta y, sobre todo,
se mueve bajo el lector: un jugador al que se le esta liquidando el devengo mientras pagina veria un
asiento dos veces o perderia otro. El cursor es opaco en el contrato, que es lo que permite que hoy sea la
secuencia y manana sea otra cosa sin tocar el cliente. El `balance` de la respuesta es el saldo liquidado,
que es exactamente el `balanceAfter` del asiento mas reciente, de modo que el cliente puede auditar la
pagina que acaba de recibir sin pedir nada mas.

### Consecuencias

La cifra que el panel previsualiza y la cifra que el ledger registra son la misma por construccion y no
por coincidencia aritmetica, porque las dos salen de la misma funcion compartida. El almacen de mercado
del cliente publica las dos vias de forma explicita, `valueOf` multiplicando el precio cotizado y
`revenueOf` llamando a la regla, y los paneles usan la segunda.

El historico es estable bajo escritura concurrente, que es la propiedad que importa en un sistema donde el
devengo escribe sin que el jugador haga nada.

Discrepancia registrada y no resuelta: `ledgerQuerySchema`, en `shared/api/schemas/economy.ts`, no declara
filtro por tipo de asiento ni por intervalo, que es lo que el resumen de regreso de §124 necesitara.
`queryLedger` y `sumLedger` los implementan y los tienen probados, pero son inalcanzables por HTTP porque
el esquema es un objeto estricto y esta congelado. La ampliacion exacta esta en `NOTES-w5c.md` apartado
2.3 y la aplica W7-A.

Coste asumido: dos cifras de precio por recurso en la respuesta son dos cifras que pueden desalinearse el
dia que un precio no sea exacto en la unidad almacenada. La suite lo comprueba hoy y la regla compartida
queda declarada como autoridad, de modo que la desalineacion seria de presentacion y nunca de importe
cobrado.

### Alternativas descartadas

Calcular sobre la unidad mostrada y convertir al final: introduce una division por recurso vendido, y
dividir antes de multiplicar es exactamente lo que ADR-0008 evita para que el importe no dependa del orden
de las operaciones.

Que el cliente conozca los precios por constante compartida y no por ruta: funciona hasta que el precio
deja de ser fijo, y §123 lo declara fijo "por ahora". La ruta hace que ese dia no sea un cambio de
cliente.

Paginar por desplazamiento: es lo mas corriente y es incorrecto sobre una tabla a la que se le insertan
filas por debajo mientras se lee.

Cursor no opaco, con la secuencia visible en el contrato: fija la implementacion de la paginacion en el
cliente y obliga a cambiarlo el dia que el criterio cambie.

Abonar antes de retirar las existencias: deja una ventana en la que el saldo ya subio y el inventario
todavia no bajo, que es la ventana en la que un fallo crea dinero.

---

## ADR-0044 — El informe de balance como entregable determinista y no como puerta

Fase: W5 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

§127 pide convertir §117 a §121 en una hoja de calculo fuera del GDD, y §125 enumera seis KPI que hay que
vigilar. La seccion 1 del plan decide implementar el balance del GDD sin modificarlo y documentar la
desviacion, y ADR-0011 y ADR-0014 ya fijaron que los catalogos son constantes compartidas y que los
huecos numericos se rellenan con valores inventados y justificados.

Falta decidir que es exactamente el informe. Hay dos formas de entenderlo. Una es una puerta: la
herramienta calcula los KPI, los compara con el objetivo de §125 —ratio ingreso/coste entre 1,3 y 1,8— y
termina en error si no se cumple. La otra es un entregable: la herramienta calcula, publica y explica, y
termina en cero aunque el margen sea negativo.

Con los valores del GDD sin ajustar, la eleccion no es teorica. El ratio medido es 0,096 y el punto de
equilibrio de §121 no existe, de modo que la primera lectura dejaria `make balance` en rojo de forma
permanente y por diseno.

### Decision

El informe es un entregable. `make balance` termina en cero aunque el margen sea negativo, porque el
informe documenta la desviacion en lugar de exigir que se corrija; corregirla seria ajustar el balance,
que es exactamente lo que la seccion 1 del plan decidio no hacer.

Tres propiedades lo sostienen.

Ninguna cifra esta escrita en la herramienta. `tools/balance/` importa las mismas constantes que el juego
desde `shared/config/` y las mismas reglas puras desde `shared/rules/`: el coste de posesion se obtiene
con la misma integral de solapes que el servidor liquida y el rendimiento con la misma formula de §83 que
aplica la cosecha. Si se retoca una constante, el informe se mueve con ella, y no puede divergir del juego
porque no tiene numeros propios de los que divergir.

El informe no lleva marca de tiempo. Dos ejecuciones sobre el mismo catalogo producen ficheros identicos
byte a byte, comprobado con `diff`. La unica razon por la que `docs/balance/informe-balance.md` cambia es
que ha cambiado una constante, que es lo que lo hace util en revision: un diff senala un cambio de balance
y nunca la hora a la que se genero.

Cuando el informe cita el valor que una palanca deberia tener para que el ciclo cerrara en positivo, lo
marca como informativo y declara expresamente que no se aplica. Es el caso de la tasa de malezas, de la
que el informe calcula que tendria que ser 0,0813 %/h en lugar de los 0,6 %/h de §82 para producir el
20 % que §119 supone.

Se emiten dos ficheros, `informe-balance.md` para leer y `kpis.json` para consumir, de modo que una
comprobacion futura pueda apoyarse en el segundo sin analizar el primero.

### Consecuencias

La desviacion del balance queda medida, publicada y localizada, y deja de ser una afirmacion del plan para
ser una tabla con cifras: 15 de las 24 cifras publicadas que la calculadora comprueba se reproducen desde
el catalogo y 9 no.

Un hallazgo nuevo que el informe produce y que el plan no anticipaba: `CULTIVATE` no evita la saturacion
de malezas en un campo de 250 celdas. La seccion 2.2 del plan preveia que implementar la tasa literal daria
a esa operacion, opcional para el trigo segun §82, un uso estrategico real. La calculadora mide el
supuesto y no se sostiene: aunque el jugador cultive justo antes de sembrar, quedan 176,04 h de
crecimiento de malezas hasta la cosecha, por encima de las 166,67 h que la tasa de §82 necesita para
saturar, de modo que la penalizacion final sigue siendo el 50 %. La palanca real es el tamano del campo:
por debajo de unas 130 celdas el nivel no satura, y un campo de 120 celdas termina en 95,20 %.

Coste asumido: un informe que nunca falla no protege de una regresion de balance. Lo que si la detecta es
el diff del fichero generado, y por eso el determinismo byte a byte no es una comodidad sino el mecanismo
que sustituye a la puerta. Queda pendiente para W7 decidir si `make verify` compara el informe
regenerado con el versionado.

Discrepancia de propiedad registrada: `docs/ownership.md` atribuia `tools/balance/` y `docs/balance/` a
W6-E, y el reparto real las ha escrito en W5-C. La tabla se ha cuadrado en este cierre.

Discrepancia de contenido pendiente: el informe cita como volumen de la primera tala 383,5 m3 y su ingreso
en 17.257,50 $, que corresponden al volumen medio del arbolado incluidos los plantones. La errata 40 fija
que la cifra que la regla usa y que el informe debe citar es la produccion de una tala, 382,5 m3 y
17.212,50 $. Ambas quedan dentro del 1 % de las ~382 m3 que §138 publica, de modo que la clasificacion del
informe no cambia; la cifra si. Propietario W5-C, a aplicar por W7-D al cerrar el informe.

### Alternativas descartadas

El informe como puerta que exige el objetivo de §125: dejaria `make balance` en rojo permanente con los
valores del GDD sin ajustar, y la unica forma de ponerlo en verde seria ajustarlos, que es lo que la
decision del usuario prohibe. Una puerta que solo puede pasarse violando una decision no es una puerta.

Copiar los numeros de §117 a §121 a la herramienta y comprobarlos contra el juego: dos declaraciones del
mismo balance que se desincronizan al primer cambio de constante, que es el defecto que ADR-0011 evita.

Marca de tiempo en el informe: convierte cada regeneracion en un diff, con lo que el diff deja de
significar nada.

Ajustar la tasa de malezas para que el ciclo cierre: es la decision que el usuario tomo en contra durante
la planificacion. La cifra se publica precisamente para que el dia que se quiera ajustar, este calculada.

---

## ADR-0045 — Movimiento de maquinaria y trabajadores cosmetico y derivado en el cliente

Fase: W5 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

§92 autoriza de forma explicita que el movimiento visual de una maquina entre celdas sea cosmetico y sin
efecto en la simulacion: la tarea se ata al campo completo, no a una posicion. El servidor no dice nunca
donde esta un tractor, y la seccion 9.5 del plan pide que el cliente lo responda sintetizando un recorrido
determinista sobre las celdas del campo, con la posicion como funcion del progreso temporal.

La alternativa evidente —transmitir la posicion— tiene tres costes que en un juego idle importan mas de lo
habitual: consume trafico continuo para informacion sin efecto, se pierde al recargar la pagina, y dos
pestanas del mismo jugador mostrarian dos posiciones distintas.

### Decision

El movimiento se deriva por completo en el cliente y no se transmite nunca.

La forma del recorrido es una serpentina, que es como se trabaja un campo de verdad, y el identificador de
la tarea elige cual de ocho orientaciones se usa. Ocho y no una, porque dos campos trabajados a la vez en
paralelo se leerian como una sola maquina reflejada; ocho y no infinitas, porque cada una de las ocho es
un recorrido que un agricultor conduciria.

El recorrido es funcion del conjunto de celdas y no del orden en que llegan. Las celdas de un campo llegan
como la pagina de una respuesta de API, y dos clientes que las recibieron en otro orden tienen que dibujar
el mismo recorrido. Se garantiza ordenando explicitamente en lugar de dejarlo a la iteracion de un mapa, y
se comprueba con una prueba que baraja la entrada.

La posicion se parametriza por indice de celda y no por longitud de arco. Las dos difieren solo en el giro
de final de banda, donde un paso diagonal es mas largo que uno recto, y pagar una tabla de longitudes
acumuladas por tarea para eliminar una variacion de velocidad apenas visible en la cabecera seria la
eleccion equivocada: una maquina real tambien afloja ahi.

La cancelacion detiene el recorrido donde se detuvo. `endedGameMs` acota el progreso, porque una tarea
cancelada no es una tarea completada (§106): no se reembolsa nada y el desgaste se prorratea, de modo que
la maquina no puede seguir avanzando hacia un final previsto que ya no va a ocurrir.

El reloj es un parametro y nunca `Date.now`. El tiempo de juego es una extrapolacion desde un ancla con
multiplicador racional (ADR-0007), y un renderizador que leyera el reloj de pared se separaria de toda
cuenta atras de la interfaz al minuto de cambiar el multiplicador.

Lo que no esta en una tarea tambien tiene sitio determinista: una maquina ociosa se aparca dentro de su
garaje y un trabajador ocioso descansa junto a su vivienda, calculado con la misma disciplina y sin
aleatoriedad.

### Consecuencias

Tres propiedades que un paseo aleatorio en el cliente no tendria: no consume trafico, sobrevive a una
recarga y es identico en dos pestanas del mismo jugador. Las tres son la razon por la que el plan lo pide
asi y las tres estan comprobadas.

La posicion de una maquina es una asercion de prueba unitaria y no una captura de pantalla, porque toda la
decision es una funcion pura del conjunto de celdas, el identificador de la tarea y el reloj.

Coste asumido: el recorrido no coincide con ningun recorrido almacenado en el servidor, porque no hay
ninguno. Si algun dia una regla de dominio dependiera de por donde va la maquina —un consumo por
kilometro, una colision, un aviso de paso— habria que promover el recorrido a dato del servidor, y ese dia
esta decision se sustituye. §92 dice explicitamente que ese dia no es este.

### Alternativas descartadas

Transmitir la posicion por WebSocket: trafico continuo para informacion sin efecto de simulacion, que
ademas se pierde al recargar y obliga a interpolar en el cliente de todas formas.

Un paseo aleatorio o una animacion sin relacion con la tarea: es lo mas barato y rompe la unica propiedad
util del movimiento, que es que el jugador vea que la maquina esta haciendo lo que pidio y cuanto le
queda.

Una unica orientacion de serpentina para todas las tareas: dos campos trabajados a la vez producen un
efecto de espejo que se lee como un fallo de renderizado.

Parametrizar por longitud de arco: una tabla de longitudes acumuladas por tarea, recalculada cuando cambia
la geometria del campo, para corregir una variacion de velocidad que el propio movimiento real tiene.

Dejar que la posicion avance hasta el final previsto tras una cancelacion: contradice §106 y hace que la
interfaz afirme un trabajo que no se hizo ni se cobro.

---

## ADR-0046 — La capa de entidades: decision pura, dos frecuencias, escritura diferencial y reciclado acotado

Fase: W5 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

ADR-0023 fijo dos niveles de detalle para el terreno y un presupuesto exigible de unas 110 llamadas de
dibujo y 8.000 cuadrilateros a zoom 1. Las entidades —edificios, maquinaria, trabajadores y arboles— se
dibujan encima de ese terreno y tienen un caso de carga propio que el terreno no tiene: §130 admite un
arbol por celda, de modo que un bosque visible son decenas de miles de sprites potenciales, mientras que
las maquinas y los trabajadores son pocos pero se mueven cada fotograma.

El banco de medida de esta fase usa 200 maquinas y 2.000 arboles, con 42 edificios, 32 trabajadores y 6
tareas, que es un orden de magnitud por encima de lo que el MVP produce y por debajo de lo que un bosque
grande produciria.

### Decision

Cuatro reglas.

Toda decision es pura y esta separada del motor. `planEntities` toma el modelo de lectura, el rectangulo
visible, el zoom y el reloj y devuelve una lista de colocaciones; `EntityLayer` se limita a aplicarla
sobre Phaser. Lo que se gana no es elegancia: es que "que se ve", "donde aparca una maquina", "que se
dibuja delante de que" y "donde esta una maquina en este instante" son aserciones de una prueba unitaria y
no capturas de pantalla.

Dos frecuencias y una sola verdad. La pasada estructural corre diez veces por segundo y decide que
entidades existen; la pasada de fotograma mueve unicamente lo que una tarea esta moviendo. Las dos derivan
la pose de la misma funcion, `taskPoses`, de modo que no pueden discrepar. Medido: 2,7 ms la estructural
con 2.302 sprites y 0,1 ms la de fotograma.

Se escribe solo lo que cambia. La primera version reasignaba las siete propiedades de los 2.302 sprites en
cada pasada estructural y media 10 ms; comparar contra el estado vivo lo baja a 2,7 ms, porque 2.000 de
ellos son arboles y un arbol no se mueve. La comparacion no es una optimizacion anadida despues: es la
razon por la que la capa mantiene un indice de lo que ya esta en pantalla.

Dos niveles de detalle tambien para las entidades, por el mismo motivo que para el terreno. Por debajo de
zoom 0,6 los arboles no se dibujan uno a uno: la capa de uso y la miniatura de chunk ya dicen que una
celda lleva un arbol en pie, que es todo lo que una celda de cuatro pixeles puede decir. Medido: 2.000
sprites a zoom 0,7 y ninguno a zoom 0,5, con el mismo dato de origen.

Dos decisiones menores que se derivan de las anteriores. El reciclado tiene dos techos porque hay dos
modos de fallo distintos: el del grupo acota lo que un chunk puede costar, y es el invariante de un arbol
por celda de §130 hecho exigible; el del almacen acota lo que una sesion larga puede costar, y sin el,
recorrer un bosque dejaria caliente en memoria cada sprite jamas creado, con lo que el reciclado se habria
convertido en una fuga con mejor nombre. Y la profundidad es una clave escalar y no un comparador —la `y`
de mundo mas un dieciseisavo de pixel por rango de tipo— con ordenacion estable, porque con una ordenacion
inestable una hilera de arboles a la misma `y` parpadea entre dos fotogramas. La unica excepcion es la
maquina aparcada, que se ordena por el borde sur del edificio que la contiene, porque la regla general la
esconderia bajo un tejado opaco.

### Consecuencias

El presupuesto de ADR-0023 se mantiene con la capa activa: 1,48 ms de coste medio por fotograma con 2.302
sprites, cero sprites rechazados por grupo lleno, y un barrido de 40 pasos de camara con vuelta al origen
que devuelve exactamente los mismos 2.302 sprites y los mismos 10 grupos. Las cifras del banco de `/perf`
para el resto de la escena no se mueven al adjuntar la capa: carga de chunk 0,07 a 0,05 ms, tick lejano
8,01 a 6,66 ms, parcheo 1,16 a 0,13 ms.

El reciclado es comprobable y no una promesa: al bajar del umbral de zoom se retienen 1.024 sprites y se
destruyen 976, que es exactamente cuatro claves de textura por el techo de 256 del almacen.

Advertencia obligada sobre la medida, que se registra para que nadie la cite como lo que no es: en la
maquina de desarrollo Chrome sin cabeza cae al `CanvasRenderer` de Phaser y Chrome con ventana no recibe
`requestAnimationFrame`, de modo que las cifras de fotogramas y de llamadas de dibujo describen el
rasterizador y no el diseno. La unica lectura obtenida sobre WebGL fue una llamada de dibujo sin la capa y
dos con los 2.302 sprites, frente a un presupuesto de 130, y se publica como observacion y no como medida.

Coste asumido: la capa no se crea todavia en la pagina de juego. `pages/game.vue` monta el lienzo y no
adjunta `EntityLayer`, de modo que las entidades se ven hoy en la ruta de medicion y no en `/game`. La
costura esta escrita en `NOTES-w5d.md` apartado 5.1 y la aplica W6 o W7-A.

### Alternativas descartadas

Reasignar todas las propiedades de todos los sprites en cada pasada: es lo que hacia la primera version y
cuesta 10 ms con 2.302 sprites, que es la mitad del presupuesto de fotograma para no mover nada.

Una unica frecuencia de actualizacion: a 60 Hz la pasada estructural cuesta lo que no vale, y a 10 Hz el
movimiento de una maquina se ve a saltos.

Dibujar los arboles uno a uno a cualquier zoom: a zoom 0,25 son decenas de miles de sprites de cuatro
pixeles que la miniatura de chunk ya representa mejor y en un solo cuadrilatero.

Reciclado con un unico techo: los dos modos de fallo son distintos y un solo numero no puede acotar los
dos. Un techo por grupo no impide que una sesion larga acumule; un techo global no impide que un chunk
concreto reviente el presupuesto.

Ordenar por comparador en lugar de por clave: cuesta mas y, sin garantia de estabilidad, produce parpadeo
en el caso mas frecuente, que es una hilera de arboles alineados.

Poner la logica de colocacion dentro de la escena de Phaser: convierte cada regla de colocacion en algo
que solo se puede comprobar arrancando un motor grafico.

---

## ADR-0047 — La costura del lienzo vive en la pagina y el arbitraje de entrada tiene un unico dueno

Fase: W5 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

La seccion 9 del plan traza una linea: Phaser posee unicamente el lienzo del mundo, todos los paneles son
componentes Vue, y Pinia guarda el estado recibido del servidor sin que Phaser lo modifique. Las zonas de
`eslint.config.js` la hacen exigible: `app/game` no puede importar `app/stores`.

Al cierre de W4 la escena del mundo, la herramienta de seleccion y trece paneles estaban escritos y
`frontend/app/pages/game.vue` no llamaba a `createGame`, de modo que el lienzo solo se veia en la ruta de
medicion. Quedaban ademas tres huecos declarados en las erratas: el puente no tenia evento para las
preferencias de renderizado, el arbitraje de entrada no deshabilitaba el lienzo con el foco en un campo de
texto, y Escape tenia dos duenos, cancelar la seleccion y plegar el panel lateral.

Los tres son el mismo problema visto tres veces: el lienzo y el shell tienen que hablarse y ninguno de los
dos puede importar al otro.

### Decision

La costura vive en la pagina, y es la unica que hay. `pages/game.vue` es el unico fichero del cliente que
conoce a la vez el almacen y la escena, y ata ahi los cuatro puertos: origen de datos del mundo,
seleccion, preferencias de renderizado y teclado. Eso es exactamente lo que la regla de zona busca, y no
un efecto colateral suyo.

Las preferencias de renderizado viajan como evento con carga util retenida y no como recarga. El panel
persiste, la pagina traduce y la escena aplica. `world:reload` significa "vuelve a dibujarlo todo" e
invalida todos los chunks; usarlo para apagar una rejilla es correcto y es caro. Retener la ultima carga
util es lo que hace irrelevante el orden entre montar el lienzo y publicar las preferencias, que no es
controlable porque las escenas de arranque generan antes todas las texturas.

Escape tiene un unico dueno, resuelto invirtiendo el arbitraje. El shell pregunta al lienzo si la
pulsacion es suya y se aparta cuando lo es, con la escalera modal, lienzo, bandeja, panel lateral. La
alternativa —que la herramienta pidiese permiso al shell— exige que una escena de Phaser importe el shell,
que es la linea que el plan dibuja.

El lienzo pierde la entrada con el foco en un campo de texto. La camara vincula WASD y la herramienta
Enter y Escape sobre el documento, de modo que escribir el nombre de una parcela movia la camara y
confirmaba la seleccion. El predicado de entrada sigue siendo uno solo,
`modals.length === 0 && !textEntryFocused`; perder el arrastre mientras se escribe no cuesta nada, porque
quien escribe no arrastra.

La superficie de un panel es dato del registro y el punto de llamada la lee. `building-placement` pasa de
modal a lateral porque un modal deshabilita la entrada del lienzo y ese panel acompana a un modo donde la
huella tiene que seguir al cursor y el clic tiene que colocar: declarado modal, el panel deshabilitaba el
gesto que existe para explicar.

La correspondencia entre modo de seleccion y panel es exhaustiva por tipo: un `Record` sobre los nueve
modos, de modo que un modo sin panel es un error de compilacion. Confirmar una seleccion no muta nada:
publica una instantanea y el panel nombrado es quien pide al servidor con el presupuesto autoritativo,
conforme a ADR-0034.

### Consecuencias

`/game` muestra el mundo. Verificado en el navegador sin ningun error de consola: el terreno, la granja,
los campos y los contornos se pintan; el arrastre con boton central y las teclas mueven la camara; el zoom
por rueda conserva los 49 chunks; una seleccion por arrastre informa 77 celdas, 1.680,00 $ y 63 no
validas; un arrastre valido de 24 celdas mas Enter abre la compra de tierra con presupuesto local
2.580,00 igual al del servidor; el primer Escape cancela el modo sin plegar el panel lateral y el segundo
lo pliega; apagar rejilla y contornos se refleja en el lienzo y persiste; y con el foco en un campo de
texto el visor lleva `fw-input-blocked` y las teclas no mueven la camara.

Cuatro de los diez puntos abiertos que el README declaraba al cierre de W4 quedan cerrados con esto: la
costura del lienzo, la pestana inicial del panel lateral, el evento de preferencias y el arbitraje de
entrada con Escape. La superficie de `building-placement` tambien.

Coste asumido: la pagina crece y concentra conocimiento de las dos mitades. Es deliberado y es preferible
a la alternativa, que es repartir ese conocimiento entre la escena y el shell y perder la propiedad de la
linea. Lo que la pagina no hace es decidir: traduce.

Pendiente declarado: la capa de entidades de ADR-0046 no se adjunta todavia en esta costura, y el puente
sigue sin declarar un evento de confirmacion de seleccion propiamente dicho, que se resuelve con un puerto
en lugar de con el puente.

### Alternativas descartadas

Montar el lienzo desde un componente o desde un plugin de Nuxt: el punto de montaje tiene que conocer los
almacenes para atar los puertos, y cualquier sitio dentro de `app/game` que lo hiciera violaria la zona.

Inyectar los almacenes en la escena: es la misma violacion con otro nombre, y ademas convierte a Phaser en
un consumidor de Pinia, que es lo que la seccion 9 del plan prohibe explicitamente.

`world:reload` para las preferencias: correcto y caro. Invalidar todos los chunks para cambiar el color de
una rejilla es tres ordenes de magnitud mas trabajo del necesario.

Publicar las preferencias sin retener la carga util: hace que el resultado dependa de si la escena ya se
suscribio, y el orden no es controlable porque las escenas de arranque generan las texturas primero.

Que el shell decida sobre Escape y avise al lienzo: obliga a la escena a importar el shell.

Dejar `building-placement` como modal y compensar en el panel: es la mitigacion que W4 aplico embebiendo
el componente, y funciona, pero deja declarado en el registro algo que contradice el arbitraje de entrada.

---

## ADR-0048 — El orden de evaluacion del servidor como motivo del control inhabilitado

Fase: W5 · Fecha: 2026-08-12

### Estado

Aceptada.

### Contexto

ADR-0030 fijo que la validacion es codigo compartido entre cliente y servidor, y ADR-0032 que el motivo de
un control inhabilitado es el `ValidationCode` con el que el servidor rechazaria la peticion, no una frase
escrita en el panel. Los trece paneles del primer grupo lo aplicaron sobre reglas donde solo hay una razon
posible de rechazo.

Los cinco paneles de esta fase trabajan sobre reglas donde hay varias, y muy a menudo son ciertas a la
vez. Comprar una maquina con el garaje lleno y el saldo corto es el caso corriente y no el excepcional:
con un colchon de 13.900,00 $ tras el setup de §117 y un garaje de cuatro plazas, las dos condiciones
coinciden en cuanto el jugador se acerca a cualquiera de los dos limites.

El servidor responde siempre una sola de ellas, la primera de su secuencia. Si el panel elige la otra, el
jugador lee un motivo, resuelve exactamente eso, vuelve a pulsar y sigue bloqueado.

### Decision

La negativa de un control es el orden de evaluacion del servidor y no solo su codigo. Las funciones de
presentacion de esta fase reproducen la secuencia de comprobaciones modulo a modulo, la declaran en su
comentario con la referencia al fichero del servidor que reproducen, y las pruebas construyen a proposito
las situaciones en las que dos motivos son ciertos a la vez para fijar cual gana.

De ahi se derivan tres reglas mas, todas de la misma naturaleza: preferir el dato que ya viaja al dato que
habria que inventar.

La ocupacion se cuenta sobre la entidad que lleva su ubicacion y no sobre el contador del edificio. El
contador es la autoridad y es lo que defiende el `CHECK` de ADR-0018, pero solo llega al cliente por
trama; `Machine.garageId` y `Worker.homeId` viajan en la respuesta de la mutacion y son el mismo hecho.
Contar sobre ellos hace que la plaza liberada por una venta o un despido se vea sin socket vivo, y sin que
ningun panel escriba en un almacen.

La guia de arranque no transcribe §117 a §120: los recalcula. El presupuesto sale de `setupCost`, el
instante en que cada maquina hace falta sale de `cyclePhases`, y el ahorro de la compra escalonada de
`balanceKpis` sobre el mismo escenario con los dos modos de propiedad. Las 146.100,00 y el colchon de
13.900,00 coinciden con el GDD, y las "unas 230 h" de §120 salen 227,3 h. El valor no es la exactitud: es
que el dia que cambie una velocidad de trabajo o una duracion de fase, la guia se mueva con el balance en
lugar de mentir con conviccion.

La secuencia de arranque no tiene estado propio. Cada paso se comprueba contra los almacenes —hay granja,
hay garaje, hay campo, hay tractor— y la frontera entre "ahora" y "todavia no" es el estado proyectado del
campo cruzado con `fromCropStates` de la tabla de §90. No hay marca de progreso que guardar, que
reiniciar ni que sincronizar, y un jugador que compro el silo en otra sesion lo encuentra marcado.

Dos precisiones que completan el criterio. Contratar y despedir no pasan por el almacen de operaciones
optimistas: no mueven dinero, no llevan clave de idempotencia y por tanto `stores/pending` nunca tendra
una entrada suya; lo que protege la contratacion de un doble envio es que el candidato sale del pool. Y la
previsualizacion de un ingreso usa `cropSaleRevenue` y `woodSaleRevenue`, que son las funciones con las
que el servidor escribe el asiento, y no el precio cotizado multiplicado en el panel.

### Consecuencias

El jugador que lee un motivo y lo resuelve avanza. Es la unica propiedad que importa de un control
inhabilitado, y sin fijar el orden no se cumple aunque todos los codigos sean correctos.

Verificado en el navegador contra el servidor simulado: ocho compras de maquinaria bloqueadas con el
motivo de garaje lleno cuando la plaza es la primera comprobacion, despido bloqueado por trabajador no
disponible, contratacion real que baja el pool de tres a dos candidatos y sube la plantilla de dos a tres
con el coste horario pasando de 38,75 a 44,75, y venta de 5.000 L por 1.100,00 reflejada a la vez en el
panel y en la barra superior.

Coste asumido: el orden de evaluacion del servidor queda duplicado en el cliente, con el mismo caracter
que ADR-0033 documento para el plan de colocacion de edificio. Es duplicacion declarada, con la referencia
al fichero espejo en el comentario y con pruebas que fijan los empates; no es duplicacion silenciosa. La
alternativa seria que el servidor publicase su secuencia, que es un cambio en `shared/`, congelado.

Pendientes que esto deja abiertos y que no son de la capa de paneles: `stores/sync.ts` no aplica
`garageSlotsUsed` ni `homeSlotsUsed` y ninguna de las cuatro rutas del area emite `FARM_UPSERTED`, de modo
que la mitigacion anterior es tambien lo que hace que el garaje no siga lleno tras vender; contratar y
despedir no emiten `PLAYER_UPSERTED`, con lo que el consumo por hora de la barra superior se queda atras;
y el servidor simulado ignora `expectedTotal` en compra y reparacion de maquinaria. Los tres estan en
`NOTES-w5f.md` con propietario.

### Alternativas descartadas

Mostrar todos los motivos ciertos a la vez: es honesto y es inutil. El jugador no puede saber cual tiene
que resolver primero, y resolver el que no es no desbloquea nada.

Elegir el motivo mas grave o el mas informativo: cualquier criterio que no sea el del servidor produce
exactamente el caso que esta decision evita.

Contar la ocupacion sobre el contador del edificio: es la autoridad y llega tarde. Sin socket vivo, el
garaje seguiria lleno despues de vender una maquina.

Transcribir las cifras de §117 a §120 a la guia: es la duplicacion que ADR-0011 evita en el catalogo,
aplicada al peor sitio posible, que es el texto que un jugador nuevo lee como verdad.

Un contador de onboarding persistido: estado que puede discrepar del mundo y que no aporta nada que el
mundo no diga ya, y que ademas habria que reiniciar cuando el jugador deshace un paso.

Previsualizar el ingreso multiplicando el precio en el panel: coincide hoy con lo que el ledger registra y
deja de coincidir el dia que la regla compartida cambie de redondeo.

---

## ADR-0049 — El arbol no almacena nada y el hito de crecimiento se agenda por parcela y por ventana

Fase: W6 · Fecha: 2026-08-13

### Estado

Aceptada.

### Contexto

GDD §130 declara `growthStage` y `woodVolume` como columnas de `Tree` y GDD §140 los describe acto
seguido como derivados de la edad. La resolucion 14 del apartado 2 de `docs/erratas-gdd-stack.md`
opto por derivarlos, y ADR-0013 fijo ya la politica general de no almacenar lo que una funcion pura
reconstruye. Lo que quedaba por decidir es el alcance de esa eleccion cuando aparece el volumen real
de datos: §130 admite un arbol por celda y una parcela admite hasta 2.000 celdas.

Sobre eso se apoya el segundo problema. GDD §131 pide notificar al jugador que su arbolado cambia de
fase, y las fronteras de la resolucion 13 del apartado 2 —240, 480 y 720 horas de juego— caen en
instantes distintos para cada arbol, porque el generador reparte las edades dentro de la ventana de
su fase para que un bosque salvaje no madure entero de golpe. Doscientos cincuenta arboles producen
por tanto doscientos cincuenta instantes de notificacion.

### Decision

`Tree` guarda especie, celda, `plantedAtGameMs`, estado y `felledAtGameMs`, y nada mas. La edad, la
fase y el volumen son evaluaciones de `shared/rules/forestry.ts`, que corren igual en el servidor y
en el cliente. El agregado de una parcela —arboles en pie, volumen talable, histograma de fases— se
recalcula sobre los arboles vivos en cada lectura y no vive en ninguna columna.

El motivo no es la elegancia sino que el numero que habria que mantener cambia sin que nadie escriba:
un arbol que cruza las 480 horas mueve una unidad del histograma y anade volumen talable sin que
ocurra ninguna transaccion. Un contador seria un dato que envejece solo, y ninguna escritura lo
tocaria para corregirlo.

El generador aplica la misma regla en el momento de crear: sortea una fase de la mezcla de
`NATURAL_FOREST`, sortea despues una edad uniforme dentro de la ventana de esa fase y escribe
`plantedAtGameMs = atGameMs - edad`. Leer la fase con `treeStageAt` devuelve la que se sorteo, y sigue
devolviendo la correcta conforme avanza el reloj. El sorteo es determinista desde la semilla y la
coordenada, con el mismo hash entero que clasifica el terreno y sales propias, sin `Math.random`.

`FOREST_NOTIFY_MILESTONE` es por tanto de la parcela y no del arbol, y su vencimiento se cuantiza a
ventanas de veinticuatro horas de juego, que es el dia del contador propio del jugador de GDD §61.
Cada frontera cae en exactamente una ventana, de modo que la notificacion sigue siendo exacta, un
arbol se reporta una vez y solo una, y no hace falta almacenar que arboles ya se avisaron: el
calendario apunta siempre a la ventana mas temprana que aun no ha vencido.

De ahi se deriva una regla que parece menor y no lo es: una fila pendiente se conserva y no se
recalcula. `syncPhaseSchedule` de `modules/fields` cancela y reagenda; aqui hacerlo perderia avisos,
y no en un caso raro sino en el corriente, porque una tala que termina entre el instante en que un
arbol madura y el vencimiento de su ventana es lo normal. Conservarla es seguro en la otra direccion:
la ventana pendiente solo puede ser anterior a la que produzca cualquier arbol posterior, porque un
planton replantado madura cuatrocientas ochenta horas despues de ahora y todo arbol ya presente se
planto no mas tarde que ahora. Una fila obsoleta es, como mucho, una ventana que no reporta nada, y
el manejador responde reagendando.

### Consecuencias

Ninguna de las siete rutas del ciclo forestal escribe una fase, y la prueba "la fase de un arbol
avanza con el reloj" es una lectura antes y otra despues sin ninguna escritura entre medias.

Un evento por parcela en lugar de uno por arbol es la diferencia entre decenas de filas y decenas de
miles en `ScheduledEvent`, que es lo que hace compatible la silvicultura con el horizonte de agendado
acotado de ADR-0016.

El volumen que una tala deposita se recalcula en el instante de la finalizacion y no se lee de la
reserva que la asignacion comprometio. Medido en la verificacion por HTTP de W6-C: en una pasada la
reserva fue de 14.500 dm3 y lo depositado 15.900, porque un arbol joven cruzo a maduro durante las
dieciseis horas que duro la tala. Es la consecuencia directa de que el volumen sea derivado, y es
correcta: el jugador recibe la madera que habia cuando el trabajo termino.

Coste asumido: cada lectura de una parcela recorre sus arboles vivos. Con 236 arboles es
inapreciable; con el tope de 2.000 celdas la lectura crece de forma lineal y no hay ningun indice que
la evite, porque la magnitud que se agrega no esta almacenada. El punto en el que convendria revisarlo
es el mismo en el que convendria paginar las celdas de la instantanea, y esta lejos del caso de
referencia.

### Alternativas descartadas

Almacenar `growthStage` y `woodVolume` como columnas, que es la lectura literal de §130: obliga a un
trabajo agendado por arbol solo para mantenerlas al dia, y §131 es explicito en que no se pierde nada
por no talar a tiempo, de modo que se pagaria un coste permanente por un hecho del que nada depende.

Un evento agendado por arbol: decenas de miles de filas para producir decenas de miles de avisos
consecutivos que el jugador leeria como ruido.

Un unico evento por parcela sin cuantizar: doscientos cincuenta arboles con edades repartidas
producirian doscientos cincuenta notificaciones seguidas, que es el mismo ruido con otra forma.

Almacenar que arboles ya se avisaron: es estado que hay que mantener y que la ventana hace innecesario,
porque el propio calendario ya distingue lo reportado de lo pendiente.

Cancelar y reagendar el hito en cada cambio, como hace el modulo de campos: pierde avisos en el caso
corriente, que es una tala que termina entre la maduracion de un arbol y el vencimiento de su ventana.

Sortear la fase y escribirla, en lugar de sortear la fase y derivar el instante de plantacion: haria
que la fase almacenada y la derivada divergieran a la primera hora de juego.

---

## ADR-0050 — El lote de una tala se recuerda marcando sus arboles, y el desmonte es una operacion sobre la parcela

Fase: W6 · Fecha: 2026-08-13

### Estado

Aceptada.

### Contexto

GDD §132 define la tala en dos pasos, `MARK_FOR_HARVEST(treeId)` y despues `FELL(treeId)`, y GDD §141
declara que el MVP simplifica la interaccion a un area conservando el modelo de datos por arbol. GDD
§10 exige ademas convertir bosque en terreno agricola con coste de maquinaria, y la resolucion 35 del
apartado 2 de `docs/erratas-gdd-stack.md` fijo esa operacion como una tarea de tractor y arado.

Las tres operaciones forestales —tala, replantacion y desmonte— son tareas, y una tarea se completa
cientos de horas de juego despues de asignarse. La finalizacion tiene por tanto que reconstruir sobre
que celdas actuar a partir de algo almacenado, y `Task` no tiene ninguna columna para un conjunto de
celdas: el comentario del propio `schema.prisma` dice que `CLEAR_LAND` "no tiene ninguno de los dos
objetivos, porque apunta a un conjunto de celdas", y la restriccion `tasks_target_check` solo prohibe
llevar los dos a la vez. `shared/` y `schema.prisma` estan congelados desde W2.

### Decision

El lote de una tala se recuerda en los propios arboles. La asignacion marca con `MARKED_FOR_HARVEST`
los arboles vivos del area seleccionada y la finalizacion tala los marcados. Es el modelo que §132 ya
escribio, usado para lo unico que el esquema congelado no puede expresar de otra forma: que arboles
selecciono el jugador.

La marca es interna y no cambia ninguna lectura. Todo agregado de este modulo trata un arbol marcado
como vivo, y el marco que la asignacion emite lleva la parcela y no los arboles, de modo que el
recuento en pie, el histograma y el volumen talable no se mueven mientras la tala corre y el cliente
no ve un estado intermedio que no significa nada para el.

Un desmonte no dispone de esa marca, porque una celda desmontable es por definicion una celda sin
arbol. Su area se reconstruye desde la parcela objetivo como "las celdas que no llevan arbol vivo",
que es justamente el suelo que una tala vacio y justamente lo que §137 ofrece convertir. La peticion
tiene por tanto que nombrar ese conjunto entero: una seleccion que sea un subconjunto estricto se
rechaza en la asignacion con `VALIDATION_FAILED` y los dos recuentos en los detalles, en lugar de
aceptarse y sorprender al jugador con otro subconjunto del mismo tamano trescientas horas de juego
despues. `Task.targetForestPlotId` se escribe en la tarea de desmonte, que es lo que permite
reconstruir el area; la restriccion lo admite, aunque el comentario del esquema no lo anticipaba.

El orden de comprobaciones de las tres operaciones es el de GDD §104, con la misma disciplina que
ADR-0048 exige: objetivo, trabajador, maquinaria, granja del par, trabajo que hacer y, solo para la
tala, capacidad de almacen reservada por adelantado. Las reservas se escriben despues, cada una como
actualizacion condicional cuyo recuento de filas decide (ADR-0018), de modo que un doble envio pierde
la carrera en lugar de crear dos tareas.

### Consecuencias

El ciclo completo del juego funciona: comprar bosque, crear la parcela, talar, vender la madera,
replantar y desmontar a terreno agricola sobre el que se crea un campo. Verificado por HTTP contra la
pila real por W6-C y cubierto por trece pruebas de integracion.

Lo que queda fuera es el desmonte de bosque comprado sobre el que nunca se creo una parcela, porque
el area se reconstruye desde la parcela. No cierra ningun camino del juego —toda celda desmontable es
una celda que una tala vacio, y un arbol solo existe dentro de una parcela— pero si el atajo de
sacrificar arbolado sin cobrarlo.

La restriccion de que la seleccion cubra la parte talada entera es visible para el jugador y es
deliberadamente ruidosa: se rechaza en el momento de asignar, con las dos cifras, y no en silencio al
completar.

Coste asumido y como se levanta: el dia que el esquema vuelva a abrirse, una tabla
`TaskCell (taskId, cellX, cellY)` o una columna `Task.areaCells Json?` hacen que la asignacion guarde
su area y la finalizacion la lea, y las dos limitaciones anteriores desaparecen sin tocar el contrato
de API. Queda anotado en `docs/handoff/NOTES-w6c.md`, apartados 2.4 y 2.5.

`hasStandingTree` del solape de chunk filtra por `status = 'STANDING'` y no cuenta el arbol marcado,
de modo que mientras dura una tala esas celdas viajan al cliente como vacias. Es cosmetico y no abre
ningun camino: `requireCellsWithoutTree` repite la comprobacion sobre todo arbol vivo antes de aceptar
una replantacion o un desmonte, y el `UPDATE` del desmonte excluye la celda con arbol vivo dentro del
propio statement. El arreglo es una palabra en dos consultas de `modules/world`, fichero de una fase
anterior.

### Alternativas descartadas

Guardar la geometria en la fila de la tarea: es lo correcto y no hay columna. `Task.jobId` es texto
sin indice y `ScheduledEvent.dedupeKey` si lo tiene y reventaria con dos mil celdas; usar cualquiera
de las dos seria abusar de una columna con otro significado y dejar el abuso escrito en el esquema.

Recalcular el area de la tala en la finalizacion, como se hace con el desmonte: talaria los arboles
que el jugador no selecciono, o dejaria sin talar los que si, en cuanto la parcela cambiase entre la
asignacion y la finalizacion.

Aceptar un subconjunto en el desmonte y elegir el servidor cuales convertir: el jugador selecciono un
area concreta y recibiria otra del mismo tamano, sin ninguna forma de saber por que.

Exponer `MARK_FOR_HARVEST` y `FELL` como dos rutas separadas, que es la lectura literal de §132: GDD
§141 excluye explicitamente talar arbol a arbol desde la interfaz, y dos rutas obligarian al cliente a
mantener el lote entre ellas, que es exactamente la autoridad que el cliente no tiene.

Un estado nuevo de arbol para el lote: `MARKED_FOR_HARVEST` ya existe en el enumerado desde W2, por la
politica de reserva agresiva de ADR-0013, y no hace falta migracion.

---

## ADR-0051 — La parcela forestal publica su geometria por el marco y por la instantanea, nunca dentro de su DTO

Fase: W6 · Fecha: 2026-08-13

### Estado

Aceptada.

### Contexto

`ForestPlotDto` lleva `cellCount` y no las celdas, y no puede llevarlas: `shared/api/schemas/forestry.ts`
esta congelado desde W2. La fila 50 del apartado 5 de `docs/erratas-gdd-stack.md` recogio la
consecuencia al cierre de W5: la capa de entidades no puede colocar los arboles a partir de la parcela
y los coloca desde `TREES_UPSERTED`, que si lleva celda. Lo que quedaba pendiente, y que aquella fila
dejaba explicitamente a esta fase, es si la parcela publica su geometria por algun otro canal, porque
el contorno de la parcela es otra capa distinta de los arboles y no se puede dibujar sin ella.

El contrato ofrece dos canales que nadie estaba usando: `FOREST_PLOT_UPSERTED` declara `cells`
anulable, con la misma regla que `FIELD_UPSERTED` —las celdas cuando cambian y `null` cuando no—, y
`stateSnapshotReplySchema` declara `forestPlotCells`.

### Decision

La geometria de una parcela viaja por esos dos canales y nunca dentro de `ForestPlotDto`. El modulo la
emite en la creacion, que es cuando la parcela nace, y en la finalizacion de un desmonte, que es la
unica operacion que la reduce; entre esos dos momentos no cambia, de modo que ningun marco intermedio
la repite y `cells` viaja en `null`.

La instantanea la lleva siempre, porque es la reconstruccion completa y no puede depender de haber
visto el marco de creacion. `plotCells(db, forestPlotId)` devuelve las celdas en orden row major y es
la misma funcion que alimenta los dos canales.

El arbolado no viaja por ninguno de los dos. La instantanea lleva la geometria de la parcela y no sus
arboles, que son decenas de miles de filas y se pagan por pagina cuando el jugador mira. La regla que
esto impone al cliente esta en ADR-0055: una lista derivada restando arboles a la geometria solo puede
usarse cuando su cardinalidad coincide con el recuento que el servidor informa.

### Consecuencias

El contorno de una parcela se dibuja con el mismo mecanismo que el de un campo, y la capa de contornos
no necesita un segundo camino de datos.

Un cliente que arranca en frio tiene la geometria de todas sus parcelas y no tiene sus arboles hasta
que pide la pagina. Es la asimetria deliberada, y es visible: el panel de silvicultura sabe cuantas
celdas tiene la parcela y cuantas estan vacias, y no cuales, hasta que lee el arbolado.

Coste asumido: una parcela de dos mil celdas anade su geometria a la instantanea, que es del mismo
orden que un campo del mismo tamano. La medicion de la instantanea con veinte campos de doscientas
cincuenta celdas es de 178.480 bytes contra un techo declarado de 512 KiB, de modo que el margen es de
casi tres veces y el termino que domina son las celdas. El punto en el que convendria paginarlas es el
mismo para campos y para parcelas.

Pendiente que esto deja abierto y que no es de este modulo: `POST /api/forest-plots/:id/replant`
nombra sus celdas una a una (§137) y el cliente las deriva. O la instantanea incluye el arbolado, o
`ForestPlotDto` lleva las coordenadas de las celdas vacias, que son pocas por definicion. Las dos son
cambios en `shared/`, congelado, y estan en `docs/handoff/NOTES-w6t.md` apartado 1.2 con el propietario.

### Alternativas descartadas

Anadir las celdas a `ForestPlotDto`: es la forma natural y exige abrir `shared/`, que solo el agente
de integracion puede hacer y que obligaria a repetir la geometria en cada lectura de la parcela, que
es la mayoria de las lecturas y donde nunca cambia.

Emitir la geometria en todos los marcos de la parcela: repite un dato inmutable en cada tala, cada
replantacion y cada hito de crecimiento, y con dos mil celdas eso es trafico permanente por un dato
que cambia dos veces en la vida de la parcela.

No publicarla y derivar el contorno de los arboles: el contorno de una parcela recien talada no
tendria ningun arbol del que derivarse, que es precisamente el estado en el que el jugador la mira
para decidir si replanta o desmonta.

Incluir el arbolado en la instantanea: decenas de miles de filas en la respuesta que el cliente pide
justo cuando ha perdido su sitio, para dibujar algo que solo se ve con la camara encima.

---

## ADR-0052 — Una sola evaluacion para la prevision y para la asignacion, y la puerta de transicion como unica fuente de idempotencia

Fase: W6 · Fecha: 2026-08-13

### Estado

Aceptada.

### Contexto

GDD §104 fija una secuencia numerada de seis comprobaciones y GDD §90 una tabla de compatibilidad
entre operacion y maquinaria. El contrato pide dos respuestas distintas sobre exactamente las mismas
reglas: `POST /api/tasks/estimate` devuelve una lista de bloqueos, porque el panel de asignacion los
muestra todos a la vez, y `POST /api/tasks` devuelve uno solo, porque una peticion se rechaza una vez
y con un motivo.

ADR-0048 ya fijo que el motivo de un control inhabilitado es el primero de la secuencia del servidor.
Dos implementaciones de esa secuencia harian que el panel habilitara un boton que el servidor rechaza,
que es precisamente lo que aquella decision evita.

Del otro lado, `TASK_COMPLETE` es un evento agendado y BullMQ entrega al menos una vez (plan 6.3): la
finalizacion de una tarea mueve grano, desgasta maquinaria, sube habilidad y transiciona un campo, y
todos esos efectos tienen que ocurrir exactamente una vez aunque el manejador corra dos.

### Decision

Cuatro partes.

Primera. La prevision y la creacion son la misma evaluacion en dos modos. `evaluateAssignment` recorre
la secuencia de §104 acumulando rechazos en el orden en que la seccion los numera; la prevision los
devuelve todos y la creacion lanza el primero. No hay ninguna regla que una de las dos conozca y la
otra no, y la propia lista es la que ordena los motivos.

Segunda. La tabla de §90 se consulta una vez, con `explainIncompatibility` de
`shared/rules/machinery.ts`, y sus codigos se reportan en el orden en que esa funcion los produce, que
es el orden de la tabla: maquina autopropulsada, implemento requerido, implemento sobrante y
requisitos de posesion. Ese orden coincide con el de §104, de modo que no hay que reordenarlo ni
elegir. Dos precisiones que §104 no deletrea y que la implementacion fija: el paso 3 es sobre tipos y
no hay tipo sin fila, de modo que la existencia y la propiedad de las dos maquinas se resuelven antes
de consultar la tabla y la ociosidad del implemento se juzga despues, en el paso 4; y la regla de
granja de §108 —un trabajador de una granja no opera maquinaria de otra— se comprueba tambien en el
paso 4, porque es una propiedad del par y no de ninguno de los dos, con el codigo `WORKER_WRONG_FARM`
y con el disparador `task_machines_farm_guard` como segunda linea de defensa.

Tercera. La idempotencia de cerrar una tarea es la puerta de transicion condicional y nada mas.
`UPDATE tasks SET status = ... WHERE id = ? AND status = 'IN_PROGRESS'` decide por recuento de filas y
todos los efectos viven dentro de la rama que la gano. Las piezas que hay debajo son ademas
idempotentes por su cuenta —`applyMachineWear` no retrocede la marca de condicion, las liberaciones
son condicionales al identificador de la tarea y el asiento del desperdicio lleva `harvest:<taskId>`—
pero eso es defensa en profundidad y no el mecanismo.

Cuarta. Completar y cancelar comparten nucleo. Cerrar una tarea son cinco pasos —reclamar la fila,
liberar el objetivo, devolver la reserva de almacen, aplicar el desgaste de las horas realmente
trabajadas y devolver trabajador y maquinas— y las dos operaciones difieren en tres cosas y en ninguna
mas: el instante al que cierran, si se aplica la transicion del campo y si sube la habilidad. El
prorrateo del desgaste de §106 no tiene por tanto codigo propio: es la misma llamada con otro
instante, y ese instante es el mismo sobre el que `lib/accrual.ts` integra el coste de operacion, de
modo que las horas que desgastan y las que se facturan coinciden por construccion.

Ninguna de las dos rutas mutantes lleva clave de idempotencia, exactamente como el contrato declara:
crear una tarea no cobra nada, porque el coste de operacion de §94 es un devengo continuo sobre el
intervalo en que la tarea corre. Lo que la protege de un doble envio es la reserva condicional del
trabajador y de las maquinas.

### Consecuencias

El panel no puede divergir del servidor ni en el motivo ni en el orden, que es lo que ADR-0048 pedia y
lo que las veinticuatro pruebas de `panels/shared/__tests__/assignment.test.ts` fijan transcribiendo
las dos tablas del GDD.

Una segunda entrega del mismo vencimiento no duplica ningun efecto. La prueba lo comprueba devolviendo
la fila del evento a `PENDING` para llegar al manejador por segunda vez: la puerta exterior de
`advancePlayer` ya no decide nada ahi, y quien decide es la de la tarea. Y una tarea cuyo vencimiento
paso mientras el worker estaba caido produce las mismas filas que una puntual, porque todo se aplica
al instante de vencimiento y nunca al actual.

Consecuencia observable del orden fijado: una peticion que nombra un implemento inexistente recibe
`NOT_FOUND` antes que la incompatibilidad de tipos, y una que nombra un implemento del tipo equivocado
recibe el codigo de la tabla antes que "esta ocupado".

`Task.jobId` queda en nulo por construccion. La columna existe para retirar el trabajo encolado al
cancelar (§106), y el identificador del trabajo lo asigna el despachador despues del commit, de modo
que no puede escribirse en la transaccion que crea la tarea; ya vive ademas en la fila del outbox, que
es la autoritativa, y la cancelacion lo lee de ahi con `cancelScheduledEventsFor`. Una segunda copia
quedaria obsoleta en el primer re-anclaje, que reasigna todos los identificadores con la nueva epoca.

Coste asumido: la evaluacion se ejecuta dos veces cuando el cliente previsualiza y despues asigna, que
son dos lecturas del mismo conjunto de filas. Es deliberado, y la alternativa seria cachear la
prevision y validar contra ella, que es exactamente la clase de cache autoritativa que el pilar de
servidor autoritativo prohibe.

Hueco que esto deja abierto: la reserva y la liberacion de una maquina viven en `modules/tasks` y no
en `modules/machinery`, que publica la comprobacion y el desgaste y no el simetrico de las dos
funciones que `modules/workers` si publica. Escribir solo `task_machines` dejaria
`requireAssignableMachines` ciega a la doble reserva, de modo que las dos actualizaciones condicionales
viven aqui con el mismo codigo de rechazo que la comprobacion habria producido. Cerrarlo es que
`modules/machinery` publique `reserveMachineForTask` y `releaseMachineForTask`; son dos funciones de
cinco lineas y no altera ningun comportamiento.

### Alternativas descartadas

Que la ruta mutante reutilice la lista de bloqueos de una prevision que el cliente adjunte: convierte
al cliente en autoridad sobre su propia validacion.

Que la prevision llame a la creacion en una transaccion que se deshace: escribe filas, consume
identificadores y mueve el contador de secuencia para responder una pregunta.

Marcar la tarea como completada y aplicar los efectos en transacciones separadas: rompe la unica
garantia que hace inocua la doble entrega de BullMQ.

Un desbordamiento de silo como rechazo en lugar de aviso: la resolucion 9 del apartado 2 de las
erratas resuelve §83 y §97 como aviso al asignar, llenado hasta capacidad al completar y desperdicio
del resto con asiento, y rechazar convertiria una cosecha parcialmente aprovechable en tierra sin
cosechar.

Que `modules/tasks` escriba directamente en las tablas de maquinaria y de trabajadores, que ADR-0040
ya descarto: se conserva el descarte, y por eso el trabajador se reserva y se libera con las funciones
que su modulo publica. La excepcion de la maquina esta declarada arriba con su motivo y con su cierre.

---

## ADR-0053 — Los tres caminos por los que un cliente recupera lo que el socket no le entrego

Fase: W6 · Fecha: 2026-08-13

### Estado

Aceptada.

### Contexto

ADR-0019 fijo la escalera de resincronizacion: si la secuencia recibida es la siguiente se aplica, si
hay hueco se pide la reproduccion desde el anillo, y si el anillo ya no cubre se pide la instantanea
completa. GDD §68 y §124 anaden un cuarto camino, que no es de sincronia sino de narracion: el resumen
de lo que ocurrio mientras el jugador estaba desconectado.

Los tres caminos comparten una restriccion que los condiciona: `modules/session` tiene que reportar
entidades cuyos modulos —`tasks` y `forestry`— son hermanos de la misma fase, y la regla 4 del plan
prohibe importarlos.

### Decision

Tres reglas, una por camino.

Primera, el intervalo del resumen es abierto por la izquierda y cerrado por la derecha,
`(lastSummaryGameMs, gameNow]`. Toda otra ventana del sistema es `[a, b)`, y esta es la excepcion. El
motivo es donde una liquidacion escribe su asiento: `settleAccruals` cubre
`[lastAccrualGameMs, toGameMs)` y sella el asiento con `toGameMs`, el final, porque es el instante en
que el coste se hizo exigible. Una ventana cerrada por la izquierda se perderia por tanto la
liquidacion de su propio ultimo tramo —el asiento sellado exactamente en `gameNow`— y devolveria un
resumen vacio a un jugador que llevaba cuatrocientas horas fuera. Cerrar por la derecha lo captura, y
abrir por la izquierda impide que el siguiente resumen lo cuente otra vez: los intervalos consecutivos
siguen particionando la linea temporal sin solape ni hueco. Tiene ademas una consecuencia util, y es
que el capital inicial de §117, sellado en el instante de creacion de la cuenta, no se reporta como
algo ocurrido durante la ausencia.

La marca del resumen es distinta de la de login, de modo que recargar la pagina no borra un resumen
que el jugador no ha leido; solo el acuse la mueve, el acuse toma el instante del cuerpo y no "ahora",
el servidor lo acota por arriba al instante actual y nunca lo retrocede. El resumen se cachea cinco
minutos reales por jugador y ligado al intervalo para el que se construyo, de modo que recargar
devuelve exactamente el mismo objeto.

Los cinco agregados de §124 salen del ledger y no de un recalculo. §124 escribe los tres costes como
una tasa multiplicada por las horas transcurridas y advierte, sobre el de operacion, que "exige
revisar los eventos agendados, no una multiplicacion simple"; la advertencia vale para los tres y el
ledger ya la responde, porque cada asiento de devengo lo escribio `settleAccruals` integrando el
solape de cada fuente con la ventana sobre su propio intervalo de vigencia. Leer el ledger es ademas
lo que hace que el resumen cuadre: `balanceBefore + netChange === balanceAfter` se sostiene porque los
tres vienen de la misma secuencia de solo anadido, mientras que un recalculo podria diferir de lo
realmente cobrado por el redondeo de una categoria. Medido por HTTP contra la pila real: 22,00 x 3 h =
66,00 de coste de operacion sobre las tres horas realmente trabajadas, frente a los 591,05 que habria
dado la multiplicacion ingenua sobre las 26,866 h transcurridas.

Segunda, la reproduccion es una pagina y su techo es el horizonte. `truncated` significa "esta
respuesta no lleva la trama que te falta", no "la reproduccion se quedo a medias". Un hueco mayor que
la pagina pedida se responde con cero tramas y `truncated` en cierto, en lugar de con media
reproduccion: aplicar la mitad de un hueco dejaria al cliente creyendo que avanzo, y reconstruir desde
la instantanea es mas barato que recorrer varios cientos de tramas. Como la capacidad del anillo y el
techo de la pagina son la misma constante, `MAX_EVENT_REPLAY`, "el anillo alcanza" y "el hueco cabe en
una pagina" son la misma frase mientras el anillo este intacto, y el registro autoritativo de
PostgreSQL solo entra cuando el anillo se perdio, que es lo que ADR-0019 llama sobrevivir a la perdida
de Redis. El horizonte es por tanto una propiedad del transporte y no del almacen.

Tercera, la instantanea proyecta las dos entidades de sus modulos hermanos. `tasks` y `forestPlots` se
construyen en `readModel.ts` de este modulo. La alternativa —dejar las dos listas vacias— es peor que
la duplicacion: un cliente que reconstruye su estado tras un hueco perderia en silencio toda tarea en
curso y toda parcela, que es exactamente el fallo que la instantanea existe para reparar. La
duplicacion queda acotada a la proyeccion, no escribe ni reserva nada, y toda cifra derivada pasa por
la regla compartida que el modulo hermano tambien llama, de modo que las dos lecturas no pueden
divergir en aritmetica; lo que si podria divergir es la forma de la fila, y de eso se encarga el
compilador con `select` declarados como interfaces estructurales. Es el mismo criterio que ADR-0033 y
ADR-0048 aplicaron a la duplicacion declarada en el cliente, aplicado aqui al servidor. Las otras
siete entidades de la instantanea vienen del constructor que publica su modulo propietario, que es lo
que impide que la instantanea y la ruta de listado discrepen sobre la misma fila.

La instantanea es consistente en una sola secuencia y en un solo instante de juego: la composicion
entera corre dentro de una transaccion y lee `Player.eventSeq` dentro de ella, de modo que una trama
escrita mientras se construia esta ya dentro o lleva secuencia mayor. Y no lleva ningun chunk: la
rejilla se transmite por coordenada y se cachea con la version en la clave (ADR-0022). Lo que si viaja
son las celdas de cada campo y de cada parcela, que es lo que la capa de contornos necesita y lo que
ninguna peticion de chunk responde sin saber que chunks pedir.

### Consecuencias

Las tres rutas de lectura y el acuse sustituyen los cuatro ultimos andamiajes del area `state`, con lo
que no queda ninguna ruta del contrato respondiendo 501.

La instantanea de un jugador con veinte campos de doscientas cincuenta celdas mide 178.480 bytes
(174,3 KiB) frente a un techo declarado de 512 KiB; sin celdas, un jugador con dos maquinas, un
trabajador y una parcela mide 3.603 bytes. El termino que domina son las cinco mil celdas de
geometria, y la extrapolacion al peor caso admisible —veinte campos de dos mil celdas— es de unos
1,4 MiB. Ese es el punto en el que convendria paginar las celdas, y esta lejos del caso de referencia.

`welcomeBackPending` de la instantanea se decide con dos recuentos baratos, asientos del intervalo y
tareas cerradas en el. Un jugador cuyo unico suceso fuera una transicion automatica de campo, sin
trabajadores ni maquinaria y por tanto sin ningun devengo, tendria contenido en el resumen y la
bandera en falso. No ocurre con una hacienda real, porque cualquier trabajador o cualquier maquina
produce devengo cada hora de juego, y la alternativa seria construir el resumen entero para responder
un booleano en cada instantanea. `GET /api/session/welcome-back` responde siempre, de modo que el
panel se puede abrir a mano.

Limitacion conocida del resumen: `welcomeBackTaskSchema.producedUnits` pide lo que una tarea produjo y
ninguna columna de `Task` lo guarda; hoy se reporta `reservedStorageUnits` cuando sigue presente y
`null` cuando no, que es lo unico honesto. Se cierra con una columna `producedUnits` en `Task` o con
las unidades en el `meta` del asiento de cosecha, y la segunda no exige migracion. Y
`welcomeBackLiquidationSchema` no transporta el campo `detail` que el motor de liquidacion si escribe
en el `meta` del asiento, de modo que el resumen dice el tipo del activo y no su nombre; es un campo
en `shared/`, congelado, y esta en `docs/handoff/NOTES-w6t.md` apartado 1.1.

### Alternativas descartadas

Una tabla de resumen escrita conforme ocurren las cosas: obligaria a todos los modulos de todas las
fases a acordarse de anadir a ella, y el primero que lo olvidase produciria un resumen que
subreporta en silencio sin que nada falle.

Un intervalo `[a, b)` como el resto del sistema: devuelve el resumen vacio al jugador que mas lo
necesita, que es el que lleva mas tiempo fuera.

Recalcular los agregados de §124 con `computeAccrual` en lugar de leer el ledger: la recomputacion
existe y esta probada, y pertenece a la auditoria. Usarla aqui puede diferir de lo realmente cobrado y
romper la conciliacion, que es la unica propiedad que hace creible el resumen.

Reproducir la mitad de un hueco cuando no cabe entero: deja al cliente creyendo que se puso al dia.

Compartir la marca de resumen con la de login: un refresco de pagina borraria el resumen sin que nadie
lo hubiera leido.

Dejar vacias `tasks` y `forestPlots` en la instantanea para no duplicar: convierte la reparacion en
una perdida silenciosa, que es peor que la duplicacion acotada.

Importar los modulos hermanos: lo prohibe la regla 4 del plan y lo comprueba `make lint`, que es lo
que impide que el reparto en paralelo se convierta en trabajo perdido.

---

## ADR-0054 — Dos premisas de orden que resultaron falsas: la escena viva y el dato que solo viaja en la respuesta

Fase: W6 · Fecha: 2026-08-13

### Estado

Aceptada.

### Contexto

La costura del cliente de esta fase tenia dos encargos: adjuntar la capa de entidades de ADR-0046 a la
escena del mundo, que la fila 47 del apartado 5 de `docs/erratas-gdd-stack.md` dejaba abierta desde
W5, y aplicar en el reductor los contadores de plaza de garaje y de vivienda, que es la fila 43 de esa
misma tabla.

Las dos piezas estaban escritas antes de una parada de la fase, con sus pruebas de unidad en verde. El
recorrido en el navegador de la reanudacion encontro que ninguna de las dos funcionaba, y por el mismo
tipo de motivo: cada una descansaba sobre una premisa razonable acerca del orden en que ocurren las
cosas, y las dos premisas son falsas en la ejecucion real.

### Decision

Primera. Toda pieza que vive sobre una escena de Phaser se construye con la escena ya creada, sin
excepciones y aunque la pieza afirme que sabe esperar sola.

`NOTES-w5d.md` 5.1 afirmaba que `EntityLayer` no necesita la espera con plazo que la herramienta de
seleccion necesita, porque comprueba `isReady` en su constructor y, si la escena no ha corrido
`create`, se suscribe a `Phaser.Scenes.Events.CREATE` y se adjunta sola. El respaldo no puede correr
antes del arranque, porque para suscribirse lee `world.events`, y `Scene.events` es justamente la
propiedad que Phaser asigna en `Systems.init`, es decir cuando el gestor de escenas arranca la escena
y no en el constructor. El motivo no es prudencia: es que la propiedad que una pieza necesita para
suscribirse a "la escena ya existe" es de la misma familia que la que todavia no existe.

Consecuencia observada antes del arreglo: `TypeError: Cannot read properties of undefined (reading
'once')` dentro del `onMounted` de la pagina, Nuxt sustituye la pagina por su pagina de error 500, la
pagina se desmonta, `handle.destroy()` destruye el juego a mitad de la generacion de texturas y
`PreloadScene` lanza a su vez `TypeError: Cannot read properties of null (reading 'drawImage')`. Lo
que se veia era una pagina de error del servidor de desarrollo con un mensaje que no menciona ni
Phaser ni la capa. `attachSelectionTool` pasa a llamarse `attachToScene` y construye las dos piezas en
la rama en la que `world.isReady` ya es cierto.

Segunda. Lo que solo viaja en la respuesta de una mutacion no puede aplicarse bajo el veredicto de
secuencia, y necesita marca de monotonia propia declarada en el reductor.

`decideMutationReply` descarta una respuesta cuya secuencia la marca ya alcanzo, y su comentario
explica por que es correcto: "la respuesta lleva la secuencia del ultimo evento que la mutacion
produjo", de modo que toda entidad de `result` viaja tambien en una trama y no se pierde nada. El
argumento vale para todo lo demas y es falso para los contadores de plaza, porque ninguna de las
cuatro rutas de maquinaria y personal emite `FARM_UPSERTED` y los contadores viajan unicamente en la
respuesta. Con socket vivo las tramas de la mutacion llegan antes que la respuesta —que es el orden
corriente y no el excepcional— la marca alcanza la secuencia de la respuesta, la respuesta se descarta
y los contadores se pierden siempre.

El arreglo son tres piezas. `applySlotCounters` se llama antes del veredicto y no despues, que es la
unica asimetria de `applyMutationReply` y esta declarada en su comentario. Los contadores llevan marca
propia, `lastSlotCounterSeq`: describen el estado en la secuencia de su respuesta, de modo que
tomarlos en orden no decreciente de secuencia es exactamente la garantia que hace falta, y una
respuesta atrasada no puede pisar una lectura mas reciente; `applySnapshot` fija esa marca en la
secuencia de la instantanea, porque la instantanea trae `machineSlots` y `workerSlots` de cada granja
y es la lectura mas nueva que hay. Y la granja de una venta se resuelve en tres pasos —la maquina
completa cuando la respuesta la trae, la fila del almacen cuando la respuesta gano la carrera, y
`farmId` de la trama `MACHINE_REMOVED` cuando no la gano—, de modo que no hace falta inventar nada ni
conservar un indice.

### Consecuencias

`/game` muestra maquinaria, trabajadores y arboles, que es lo que la fila 47 de las erratas pedia.
Verificado en el navegador contra el servidor simulado, sin ningun error de consola: dos maquinas
aparcadas en el garaje, un tractor con arado trabajando dentro del campo este, un trabajador junto a
la vivienda con su rotulo, y doscientos treinta y seis arboles dibujados uno a uno en hileras dentro
del contorno de la parcela oeste.

Los contadores de plaza llegan al almacen con socket vivo. Medido sobre Pinia: `machineSlots` pasa de
`{used:4,total:4}` a `{used:3,total:4}` tras vender, `workers.homeSlots` de `null` a
`{used:1,total:4}` tras despedir, y `sync.discardedCount` vale 1 y 2 en esos dos momentos, es decir
las dos respuestas se descartaron y los contadores se aplicaron igualmente. Dos pruebas nuevas lo
fijan: una reproduce el orden real recogiendo las tramas que el servidor simulado empuja y
aplicandolas antes de la respuesta, y la otra comprueba que una respuesta de secuencia anterior no
deshace una lectura posterior.

Esto no sustituye al arreglo del servidor. `NOTES-w5-cierre.md` 2.6 pide que las cuatro rutas emitan
`FARM_UPSERTED`; con el, los contadores de la respuesta pasan a ser redundancia y la marca deja de ser
necesaria. Sin el, es lo unico que hay.

Coste asumido: el reductor tiene ahora dos marcas de monotonia en lugar de una, y la excepcion esta
declarada en el codigo con su motivo. Toda adicion futura que solo viaje en una respuesta tiene que
declarar la suya, y eso es una carga permanente sobre quien anada un campo a una respuesta mutante.

Consecuencia para quien mantenga `game/entities`: el camino diferido del constructor de `EntityLayer`
es hoy codigo inalcanzable desde la pagina de juego, y no es alcanzable de forma segura desde ningun
sitio, porque el unico momento en que `isReady` es falso es tambien el unico en el que `events` no
existe. Lo que procede es que ese constructor use `deps.world.sys.events`, que si existe desde el
constructor de la escena, o que la rama se retire. Es un cambio en un fichero de W5-D, cerrado.

Lo que esta fase deja verificado y no estaba: nueve pestanas responden, el arbitraje de entrada de
ADR-0047 se comporta con el modal de asignacion —`fw-input-blocked` mientras esta abierto, Escape lo
cierra y devuelve la entrada al lienzo—, y el desplazamiento y el zoom mueven el minimapa y el recuento
de chunks cargados.

### Alternativas descartadas

Confiar en el respaldo diferido de `EntityLayer` y arreglarlo dentro de esa clase: es un fichero de
una fase cerrada, y el arreglo correcto ahi —`deps.world.sys.events`— sigue sin ser mejor que
construir la pieza cuando la escena existe, que es lo que la pagina ya sabe hacer y ya hace con la
herramienta de seleccion.

Aplicar los contadores despues del veredicto y aceptar que solo lleguen sin socket vivo: es lo que
habia, pasaba las pruebas de unidad y no funcionaba nunca en ejecucion real. Es el peor de los dos
mundos, porque el fallo solo se ve en el navegador.

Escribir los contadores desde el panel: rompe el aislamiento de ADR-0032, segun el cual el panel lee y
no escribe en un almacen.

Retirar el veredicto de secuencia para las respuestas mutantes: el veredicto es lo que hace converger
la respuesta y el eco por WebSocket sin importar el orden de llegada (ADR-0019), y quitarlo por un
campo seria cambiar una garantia general por una excepcion.

Contar la ocupacion sobre `Machine.garageId` y `Worker.homeId` y no aplicar los contadores, que es la
mitigacion de ADR-0048: sigue vigente y sigue siendo lo que hace que el garaje no se vea lleno tras
vender sin socket vivo, pero el contador del edificio es la autoridad y el panel de granja lo muestra;
dejarlo sin aplicar mantiene dos cifras del mismo hecho discrepando en pantalla.

---

## ADR-0055 — Lo que una prueba de panel afirma, y las tres reglas que las de esta fase destaparon

Fase: W6 · Fecha: 2026-08-13

### Estado

Aceptada.

### Contexto

ADR-0032 fijo que el motivo de un control inhabilitado es el codigo con el que el servidor lo
rechazaria, ADR-0037 la organizacion de la capa de paneles y ADR-0048 que la negativa es ademas el
orden de evaluacion del servidor. Los cinco paneles de esta fase —asignacion de tarea, tareas activas,
silvicultura, parcela forestal y resumen de regreso— se escribieron con esas tres reglas y sin
pruebas, porque la fase se interrumpio antes de escribirlas.

Escribirlas despues destapo cinco defectos reales, ninguno cosmetico, y tres de ellos son casos que
las decisiones anteriores no cubrian. Esta entrada registra el criterio de reparto de las pruebas, que
W4 y W5 ya seguian sin dejarlo escrito, y las tres reglas nuevas.

### Decision

El reparto de una prueba de panel. Las tablas del GDD se transcriben en la prueba y se afirman sobre
el modulo puro, porque un `<select>` renderizado es el peor sitio del que leer una maquina de estados;
sobre el componente se afirma unicamente lo que solo el componente puede equivocar. Las tablas se
transcriben y nunca se derivan del codigo que comprueban, que es lo que hace que la prueba sea una
segunda lectura del GDD y no un espejo del error.

Regla primera: una propiedad de panel no lleva un tipo marcado. El tipo en tiempo de ejecucion de una
propiedad lo deduce el compilador de plantillas del tipo escrito, y un `bigint` marcado es una
interseccion que solo puede deducirse como `Object`. Todo montaje que pasaba el instante de juego
emitia «Invalid prop: type check failed for prop "atGameMs". Expected Object | Null, got BigInt», que
es ruido en la consola de dos paneles cuyo asunto es precisamente el reloj y que rompe cualquier
prueba que exija ausencia de avisos. Los instantes de juego se declaran `bigint | null` en la
propiedad y se marcan con `gameMs()` dentro del componente; el contrato para quien la pasa no cambia.

Regla segunda: un rechazo del cliente tambien lleva frase. ADR-0032 fija que el motivo de un control
inhabilitado es el codigo con el que el servidor lo rechazaria, y hay rechazos que no son del servidor
sino del cliente —"no tengo el dato para componer la peticion"— que no tienen codigo en el contrato.
El patron es el mensaje compartido del codigo cuando lo hay y una frase propia cuando no lo hay; lo
que no puede quedar es un control gris y mudo, que es exactamente lo que ADR-0032 prohibe.

Regla tercera: un recuento que el servidor informa es la comprobacion de coherencia de lo que el
cliente deriva. `ForestPlotDto` informa `emptyCellCount` y no las coordenadas de las celdas vacias, de
modo que el cliente las deriva restando los arboles en pie a la geometria de la parcela. El arbolado
no viaja en la instantanea (ADR-0051), asi que con la pagina de arboles vacia esa resta devuelve
*todas* las celdas: una parcela con tres huecos ofrecia replantar doscientas treinta y seis celdas,
casi todas con un arbol en pie, y el servidor habria respondido `CELL_ALREADY_HAS_TREE`. La lista
derivada solo se usa cuando su cardinalidad coincide con el recuento informado. Es la version de
cliente de la auditabilidad de ADR-0009, y es lo que impide componer una peticion sobre datos
incompletos.

Y una cuarta que no es nueva sino la extension de una anterior: lo que ADR-0039 prohibe en el ledger
esta prohibido tambien en la presentacion. Aquella decision descarto el asiento agregado unico de una
liquidacion forzosa porque "pierde que se vendio"; agrupar la liquidacion en la interfaz —«Maquinaria
ociosa · 2 activos · 13.000,00»— vuelve a perderlo, aunque el ledger lo conserve. El grupo conserva la
lista de activos, hay una linea por activo con su importe, y el nombre se resuelve contra los
almacenes de maquinaria y de plantilla antes de recurrir al tipo mas el identificador.

### Consecuencias

Ciento veintidos pruebas en ocho ficheros, que montan los cinco paneles contra el servidor simulado
con el cliente REST y el reductor reales y con validacion Zod de cada respuesta. El cliente pasa de
522 pruebas en 52 ficheros a 646 en 60.

Los cinco defectos que destaparon, ademas de los tres anteriores: el resumen de regreso inicializaba
`loading` en falso y lo subia dentro de `load()`, que corre en `onMounted`, es decir despues del
primer renderizado, de modo que el modal se abria un fotograma afirmando «Sin resumen · No hay nada
que contar de la ausencia» —exactamente la confusion entre resumen vacio y resumen no cargado que el
panel existe para evitar— y se corregia un tick despues; y en el panel de asignacion una propiedad y
una propiedad computada se llamaban igual, con lo que la computada quedaba oculta en la plantilla y
esta mostraba el valor inicial en lugar del efectivo. Los dos son defectos que ninguna comprobacion de
tipos detecta y que solo una prueba que monta el componente puede ver.

Coste asumido: la prueba de un panel es lenta. Montar los cinco con importacion diferida arrastra
`shared/`, los almacenes y toda la capa de interfaz, que es el mismo coste que ya obligo a que la
suite del registro declare su propio tiempo de espera. La suite completa del cliente tarda unos
treinta segundos.

Limite de lo que se puede afirmar: la frase de un rechazo propio del cliente no esta en
`shared/domain/enums.ts` y no la comparte nadie, de modo que dos paneles que expresen la misma carencia
pueden escribirla distinta. Es aceptable mientras sean carencias del cliente y no rechazos del
servidor; el dia que una de ellas se convierta en un codigo del contrato, el patron ya deja el sitio
donde enchufarlo.

### Alternativas descartadas

Afirmar las tablas del GDD sobre el componente renderizado: obliga a leer una maquina de estados desde
el DOM, y una prueba asi falla por un cambio de maquetacion y pasa por un error de regla.

Derivar la tabla de la prueba del codigo que comprueba: convierte la prueba en un espejo y deja de
detectar el unico error que importa, que es haber transcrito mal el GDD.

Declarar la propiedad como `unknown` y validarla dentro: pierde la comprobacion de tipos en el punto
de llamada, que es donde el error se comete.

Inhabilitar el control sin motivo cuando el rechazo no tiene codigo: es lo que hacia y es lo que
ADR-0032 prohibe; un boton gris y mudo es indistinguible de un fallo.

Confiar en la lista derivada de celdas vacias y dejar que el servidor rechace: el jugador habria
enviado una peticion que no puede prosperar y habria leido un error que no explica que el cliente no
tenia el dato.

Agrupar la liquidacion por paso en la presentacion: es la lectura comoda y es la que ADR-0039 descarto
con nombre y apellidos una capa mas abajo.

---

## ADR-0056 — Estrategia de pruebas: cinco capas y un unico recorrido que ejercita el retardo real de la cola

Fase: W7 · Fecha: 2026-08-13

### Estado

Aceptada.

### Contexto

La seccion 8 del plan enumera la estrategia de prueba en orden de valor —propiedades con fast-check,
prueba dorada de balance, tablas de casos en los nodos de cada curva y determinismo del terreno— y la
seccion 10 anade la integracion contra PostgreSQL y Redis reales, las pruebas de componente de los
paneles y el recorrido de humo con el multiplicador acelerado. La seccion 12 las convierte en criterio
de aceptacion.

Lo que ninguna de las tres secciones fija es el reparto: que afirma cada capa, que no debe afirmar, y
por que el recorrido de humo no es redundante con las 260 pruebas de integracion que ya ejercitan el
mismo dominio contra la misma base de datos. Al cierre del proyecto la pregunta deja de ser teorica,
porque el recorrido encontro un defecto que ninguna de esas 260 encontro (errata 68) y porque tiene un
coste que las demas no tienen: deja rastro en la base de desarrollo.

ADR-0038 y ADR-0055 ya fijaron dos piezas del reparto —la lista de andamiaje se deriva del registro, y
lo que una prueba de panel afirma— y esta entrada cierra las restantes.

### Decision

Cinco capas, cada una con una afirmacion que solo ella puede hacer.

Propiedades sobre `shared/rules/`, con fast-check. Afirman lo que ninguna tabla de casos alcanza:
aditividad exacta del devengo (`settle(a,c) = settle(a,b) + settle(b,c)`), que es lo que hace
irrelevante el orden de liquidacion y por tanto lo que permite el procesamiento fuera de orden de
ADR-0016; monotonia del reloj y ausencia de disparo temprano; idempotencia de la proyeccion de fase; y
conmutatividad y aditividad de `overlap`. Son las propiedades de las que depende la correccion del
motor, no su comportamiento en un caso.

Tablas de casos sobre `shared/`, transcritas del GDD y nunca derivadas del codigo que comprueban, en
los nodos de cada curva y entre nodos. Aqui vive la prueba dorada de balance, que reconstruye §117,
§118 y §119 desde los catalogos y afirma cada cifra con su valor real: los puntos no reproducibles se
afirman como desviacion documentada y no como fallo, que es lo que impide que un ajuste silencioso de
constante pase por correccion.

Unitarias del backend, para lo que es logica de modulo y no necesita ni PostgreSQL ni Redis: la formula
de §78, el recorrido de la maquina de estados de §76, la banda salarial de §102 y el determinismo del
generador de bosque. Estuvieron fuera de toda puerta hasta esta fase (erratas 21 y 66) y hoy las
ejecuta `make test-unit`.

Integracion del backend contra PostgreSQL y Redis reales. Es la unica capa donde se pueden afirmar las
restricciones duras de la seccion 5.4 del plan, porque son garantias de la base de datos y no del
codigo: la compra concurrente de la misma celda, el mismo trabajo ejecutado dos veces, el vaciado de
Redis con reconciliacion posterior y el cambio de multiplicador a mitad de tarea. El aislamiento no es
el que preveia el plan: en lugar de un contenedor por ejecucion, cada ejecucion crea su propia fila de
`World` con semilla negativa aleatoria —`World.seed` es unico, de modo que dos ejecuciones y el mundo
sembrado no pueden colisionar—, su propio prefijo de Redis y de BullMQ con el identificador de la
ejecucion, y un desmontaje que borra exactamente lo que creo. El motivo es la regla 5 de la ejecucion
en paralelo: un agente no crea esquemas ni aplica migraciones, y el aislamiento por mundo es mas fuerte
que un esquema compartido y mas barato que un contenedor. El reloj se inyecta y lo mueve la prueba a
mano, de modo que una ventana de seis horas de juego son seis horas de juego y ninguna afirmacion
depende de lo que la suite tarde.

Pruebas de panel contra el servidor simulado, con el cliente REST y el reductor reales y con validacion
Zod de cada respuesta, en el reparto que fija ADR-0055.

Y sobre todas ellas, un unico recorrido de humo, `make smoke`, con tres propiedades por construccion:

1. El cliente HTTP se deriva de `API_ROUTES`, con el cuerpo tipado como `RouteBody<K>` y la respuesta
   validada con el esquema Zod que la ruta declara, de modo que cada llamada es ademas una prueba de
   contrato. El guion se comprueba con `tsc` antes de ejecutarse, con la severidad del repositorio: una
   afirmacion escrita contra un campo que el contrato ya no declara falla al compilar y no como falso
   negativo en ejecucion.
2. Ninguna cifra se compara contra un literal, sino contra las reglas puras y los catalogos de
   `shared/`. Un cambio de balance en el catalogo arrastra al escenario; un cambio de balance que el
   juego aplique mal lo pone en rojo.
3. Toda espera se resuelve con el multiplicador —360.000 ms de juego por ms real, una hora de juego
   cada diez milisegundos— y se observa como fotograma del WebSocket. Ninguna espera del camino feliz se
   salta con una ruta de desarrollo, de modo que cada finalizacion llega como trabajo retrasado de
   BullMQ y el ciclo de 325 h de §118 se recorre en segundos de reloj real ejercitando el mecanismo y no
   su resultado.

El recorrido de humo no forma parte de `verify`, y desde esta fase por un motivo medido y no por un
fichero que faltara: cada ejecucion registra su propia cuenta y no se limpia a si misma, de modo que una
puerta que lo encadenara acumularia jugadores en la maquina donde se ejecuta y acabaria fallando por
carga —el barrido periodico liquida en cada ciclo a cada jugador en descubierto— y no por el juego. La
integracion continua tampoco invoca `verify`: ejecuta los objetivos uno a uno sobre una base efimera.

### Consecuencias

Al cierre: 425 pruebas de contrato en 23 ficheros sobre `shared/`, 82 unitarias del backend en 6, 649
del cliente en 61, 260 de integracion en 32 contra PostgreSQL y Redis reales, y 187 comprobaciones del
recorrido de humo en dieciseis pasos y 76 peticiones HTTP. `make verify` encadena los ocho pasos del
criterio de aceptacion y devuelve 0.

Lo que justifica la capa que mas cuesta: el recorrido de humo encontro un defecto que las 260 pruebas
de integracion no encontraron —`POST /api/land/clear` sobre una parcela entera no terminaba nunca,
errata 68— porque ninguna de ellas desmontaba una parcela completa, y porque el defecto solo se
manifiesta cuando el manejador corre de verdad dentro del consumidor de la cola y agota sus cinco
reintentos. Es la diferencia entre probar el manejador y probar el mecanismo.

Coste asumido, que conviene tener escrito porque no es obvio: con el multiplicador acelerado, la
latencia de la propia prueba es gasto del jugador. A cien horas de juego por segundo real, doscientas
idas y vueltas HTTP valen miles de horas de juego de salarios y mantenimiento de §107, de modo que la
factura de posesion del recorrido es proporcional a lo que tarde la maquina. El escenario declara por
eso capital de trabajo holgado, en asientos `COMPENSATION` con fila propia en la tabla de variaciones y
nunca plegados dentro de otro paso. Con la aportacion ajustada al ras, una maquina cargada llevaba el
saldo a negativo antes de la cosecha y la liquidacion forzosa vendia el grano antes que el propio
recorrido, que entonces afirmaba sobre la liquidacion y no sobre el mercado. Consecuencia de lectura:
las cifras de saldo del recorrido de humo no son una afirmacion de balance.

Dos huecos que quedan declarados y no cerrados. `testcontainers` sigue como dependencia de desarrollo
del backend y nombrado en el comentario de `vitest.int.config.ts`, sin estar en ningun camino de
codigo: el aislamiento real es el de esta entrada, y el comentario describe el diseno previsto y no el
aplicado. Y `tools/` no tiene ninguna puerta: ningun objetivo de Vitest lo alcanza y es el directorio
que publica las cifras del informe de balance; su unica proteccion es que el informe es determinista y
esta versionado, de modo que `make balance` deja cualquier cambio a la vista.

### Alternativas descartadas

Automatizar el navegador con Playwright, que el documento de stack §9 ofrece como opcional de fase 2:
el valor de la verificacion de extremo a extremo esta en ejercitar el retardo real de la cola y la
sincronizacion por secuencia, no en conducir un navegador. Lo que un navegador anade —que la pagina
monta, que el lienzo dibuja y que el evento llega sin recargar— es el punto 6 del criterio de
aceptacion y se comprueba a mano, con la secuencia que `make smoke-ui` imprime.

Saltar las esperas del recorrido con una ruta de desarrollo que dispare el evento agendado: probaria el
manejador y no el mecanismo. El trabajo retrasado de BullMQ, el horizonte de agendado de ADR-0016 y la
guarda de vencimiento son precisamente lo que puede fallar, y son lo unico que un atajo dejaria sin
cubrir.

Afirmar el recorrido contra literales: un cambio legitimo de catalogo lo pondria en rojo, que es
molesto, y —lo que de verdad lo descarta— un literal copiado de la implementacion haria pasar una
implementacion equivocada. La misma razon por la que ADR-0055 prohibe derivar del codigo la tabla de
una prueba de panel.

Contenedores efimeros con `testcontainers` para la suite de integracion, como preveia la seccion 10 del
plan: arrancar PostgreSQL y aplicar las migraciones por ejecucion cuesta mas que el aislamiento que da,
y la regla 5 prohibe a un agente aplicar migraciones. El aislamiento por mundo, prefijo de Redis y
desmontaje selectivo permite ademas que dos agentes ejecuten sus suites a la vez contra la misma base,
que es lo que la seccion 10 pide de verdad.

Una base de datos por suite o por agente: multiplica el coste de arranque y no aisla mas, porque lo que
se comparte y hay que aislar es la fila del mundo y el espacio de claves de Redis, no el esquema.

Encadenar `smoke` en `verify`: es la lectura comoda y la que el punto 5 del criterio de aceptacion
sugiere, y la desaconseja una medida —el recorrido deja su jugador y la carga acumulada acaba haciendo
fallar por espera finalizaciones correctas. La linea exacta que lo encadenaria esta escrita en el
comentario del objetivo, para el dia que el recorrido limpie lo que crea.

---

## ADR-0057 — Balance del MVP: el catalogo del GDD se implementa sin ajustar y el deficit del primer ciclo es el resultado publicado

Fase: W7 · Fecha: 2026-08-13

### Estado

Aceptada.

### Contexto

La decision de no tocar el balance se tomo durante la planificacion (seccion 1 del plan) y sus dos
consecuencias estructurales ya estan registradas: los catalogos son constantes compartidas y no filas
(ADR-0011), los valores que el GDD no da se inventan y se justifican uno a uno (ADR-0014), y el informe
de `tools/balance/` es un entregable determinista y no una puerta con umbral (ADR-0044).

Lo que queda por decidir al cierre es distinto y solo se puede decidir ahora, con las cifras medidas
delante. §125 recomienda un ratio ingreso/coste entre 1,3 y 1,8 y el medido es 0,0963. §121 declara que
un margen por ciclo negativo significa que no hay punto de equilibrio, y no lo hay. Las dos revisiones
adversariales de esta fase, ademas, entregaron cuatro recomendaciones que piden cambiar un numero: la
tasa de malezas de §82, el mantenimiento de los implementos de §89, las tasas de desgaste inventadas
que hacen inviable el campo grande de §122, y la activacion de `SEED_PURCHASE`.

La pregunta a resolver es donde esta la frontera entre corregir y ajustar, porque las mismas revisiones
entregaron tambien cuatro defectos en la herramienta que publica esas cifras.

### Decision

El catalogo del GDD se implementa literalmente y ninguna constante de balance se ajusta. El deficit del
primer ciclo no es un descuido del calculo: es el resultado que estas constantes producen, y el informe
de `docs/balance/` es el entregable que lo documenta.

La frontera entre corregir y ajustar se fija asi: una cifra publicada que no es la que la regla calcula
es un defecto de la herramienta y se corrige; una cifra que la regla calcula y no gusta es materia de
balance y no se toca. Los cuatro defectos de `tools/balance/` que la revision de formulas encontro
—«1 %» donde van 147,6 %, la frase de asequibilidad del colchon de §117 escrita a mano y falsa en dos
de sus tres afirmaciones, el volumen de la primera tala tomado del arbolado medio en lugar de la regla
de §135, y el KPI 2 rotulado «posesion» cuando incluye operacion— se corrigieron sin que ninguna
constante se moviera. Las cuatro recomendaciones que piden mover un numero quedan registradas en el
apartado 6.2 de las erratas y sin aplicar.

Tres palancas quedan disponibles sin migracion y en su valor neutro, que es lo que permite que un
ajuste futuro sea un cambio de constante y no un cambio de esquema: el interes de descubierto como
cuarto tipo de devengo con tasa cero; `SEED_PURCHASE` reservado en el enumerado de asientos y nunca
escrito, porque activarlo empeoraria un balance ya deficitario; y `fertilization` implementado con
multiplicador fijo en 1,0. La cuarta palanca no es del disenador sino del jugador y es la unica que
funciona con estas constantes: el tamano del campo.

Las cifras que el proyecto publica como su balance, con la compra completa el dia uno de §117:

| KPI de §125 | Valor |
|---|---|
| 1. Coste de setup minimo | 146.100,00 |
| 2. Coste por ciclo, posesion mas operacion | 25.688,78 |
| 3. Ingreso por ciclo | 2.475,00 |
| 4. Ratio ingreso/coste | 0,0963 |
| 5. Horas hasta el equilibrio | No existe: el margen por ciclo es negativo (§121) |
| 6. Colchon tras el setup | 13.900,00 |

De las 24 cifras publicadas del GDD que la calculadora comprueba, 15 se reproducen desde el catalogo y
9 no. La compra escalonada de §120 mejora el ratio a 0,1237 y no lo resuelve: el deficit es de un orden
de magnitud y no de margen.

### Consecuencias

El juego entregado no es economicamente ganable en su primer ciclo, y es el estado que el propio GDD
anticipa en su §119 y pide detectar en diseno y no en produccion. Lo que el sistema hace con ese
deficit esta implementado y probado, no pendiente: saldo negativo permitido porque impedirlo rechazaria
el propio devengo, `IN_DEBT` derivado que bloquea el gasto discrecional y no la venta ni la asignacion
de tareas, y liquidacion forzosa por encima del umbral en el orden publicado (ADR-0039).

El hallazgo principal se sostiene despues de todas las correcciones: la tasa de malezas de §82, 0,6 %/h,
satura al 100 % en 166,67 h y las horas del ciclo en que las malezas crecen son 246,07 h, de modo que
la penalizacion de §78 al cosechar es la maxima, el 50 %, y el rendimiento es 11.250 L frente a los
20.700 L que §119 supone. La prevision del plan de que `CULTIVATE` diera con ello un uso estrategico
real no se sostiene, porque tras cultivar quedan 176,04 h hasta la cosecha y vuelve a saturar; la
calculadora lo mide y la fila 1 de las erratas queda corregida en consecuencia. Desde la ventana de
correccion, ademas, la cosecha ya no reinicia el nivel: el efecto no cambia ninguna cifra publicada
justamente porque satura dentro de un solo ciclo, y aparecera el dia que se toque la tasa.

Recomendacion que el informe recoge y que no se aplica, por ser la unica de las cuatro que afecta a la
jugabilidad y no solo a la caja: con las tasas de desgaste inventadas de ADR-0014, el campo grande que
§122 recomienda no completa un ciclo sin reparacion intermedia. Publicar el tamano por encima del cual
eso ocurre es informacion util para quien retome el balance; bajar las tasas seria ajustarlo.

Coste asumido en la propia herramienta: `tools/` no tiene ninguna puerta de pruebas, y es el directorio
que publica estas cifras. Su unica proteccion es que el informe es determinista —dos ejecuciones
producen ficheros identicos byte a byte— y esta versionado, de modo que cualquier cambio queda a la
vista. Los cuatro defectos que la revision encontro estuvieron publicados hasta esta fase, que es la
demostracion de que la proteccion es insuficiente.

Queda una afirmacion desactualizada en el informe generado y no se corrige aqui: el apartado 9 declara
que de los seis pasos de la liquidacion forzosa solo estan activos `INVENTORY`, `IDLE_MACHINES` y
`WORKERS`, y desde la ventana de integracion `CANCEL_TASKS` tiene estrategia (ADR-0058). La frase esta
escrita a mano en `tools/balance/report.ts`, que es codigo y no documentacion, y corregirla exige abrir
un fichero fuera del alcance de esta ventana. Registrado en el apartado 6.2 de las erratas.

### Alternativas descartadas

Ajustar `weedGrowthRate` a 0,0813 %/h, que es el valor con el que el nivel al cosechar seria el 20 %
que §119 supone: reproduciria §119 al precio de contradecir §82, y las constantes de catalogo son las
autoritativas por decision del usuario. El valor se publica en el informe a titulo informativo,
declarado como no aplicado.

Dar `maintenanceCost` a los implementos para que los ~70 $/h de §118 se reproduzcan: es inventar un
numero de balance sin respaldo en el catalogo, que es exactamente lo que ADR-0014 admite solo cuando no
hay ninguna alternativa. Aqui la hay: el catalogo dice cero y el informe documenta la diferencia.

Activar `SEED_PURCHASE`: el tipo de asiento existe reservado precisamente para que sea una palanca sin
migracion. Activarlo hoy anadiria coste a un ciclo que ya cierra en negativo y no aportaria ninguna
informacion nueva.

Bajar las tasas de desgaste inventadas para que el campo grande de §122 sea viable: es ajustar balance
con la excusa de que la constante es inventada. Que un valor sea inventado lo hace revisable, no
ajustable a conveniencia; lo que procede es publicar la consecuencia medida.

Convertir `make balance` en una puerta con umbral sobre el ratio de §125: quedaria en rojo permanente y
empujaria a ajustar las constantes para ponerla en verde, que es justo lo que la decision prohibe. Es
la razon que ADR-0044 ya dio y que esta entrada confirma con las cifras finales.

Reescribir a mano el informe generado para corregir su apartado 9: destruiria la unica propiedad que lo
hace fiable, que es que ninguna de sus cifras ni de sus frases se escriba fuera de la herramienta.

---

## ADR-0058 — Las costuras entre modulos hermanos como registro en `lib/`, y un unico punto de relleno que los dos procesos invocan

Fase: W7 · Fecha: 2026-08-13

### Estado

Aceptada.

### Contexto

La regla 4 de la seccion 11 del plan prohibe las importaciones entre modulos hermanos de la misma fase,
y `eslint.config.js` la implementa como «un modulo puede importarse a si mismo y a los de fases
estrictamente anteriores» (ADR-0005, y la fila 1 del apartado 5 de las erratas, que ya ajusto la zona a
la letra de la regla). Al cierre quedaban dos dependencias reales que cruzan esa linea, y la cruzan en
direcciones opuestas:

- `modules/economy`, de W5, necesita `cancelTasksForLiquidation` de `modules/tasks`, de W6, para el paso
  `CANCEL_TASKS` de la liquidacion forzosa de la seccion 6.6 del plan. Es una fase posterior, de modo
  que ninguna relajacion de la regla la habria permitido nunca.
- `modules/tasks` necesita `modules/forestry` para deshacer las marcas que deja una tala cancelada, y
  los dos son hermanos de la misma fase, que es exactamente el caso para el que la regla existe.

A ellas se suman dos enganches que se instalaban desde el registro de rutas del modulo que los aportaba
y por tanto solo existian en el proceso que construye la aplicacion Fastify: el de la liquidacion
forzosa sobre el barrido periodico y la contribucion forestal a `TASK_COMPLETE`. El proceso de la cola
corria el barrido sin liquidacion y completaba una tala con el manejador generico (erratas 38 y 57).

`NOTES-w6c` 2.2 ofrece dos salidas y pide que la eleccion la haga la integracion: relajar la zona de
ESLint o declarar un registro en `lib/`.

### Decision

Un registro de estrategias en `backend/src/lib/moduleSeams.ts`, y `backend/src/handlers.ts` como unico
fichero que nombra los dos extremos de cada costura.

Se descarta relajar la zona. Anadir `'./forestry'` al `except` de la zona de `tasks` legitimaria una
dependencia entre hermanos de la misma fase, de forma permanente y para todo el modulo, cuando lo que
hace falta es una funcion; y para la costura de `economy` hacia `tasks` no serviria en ningun caso,
porque la direccion prohibida es hacia una fase posterior. El registro, en cambio, mantiene la direccion
de toda importacion apuntando a `lib/`, que es la que ya siguen `SCHEDULED_EVENT_HANDLERS` y
`registerSettleSweepHook`.

Las formas declaradas en el registro son estructurales y no nombran ningun tipo de ningun modulo, porque
`lib/` tampoco puede importar uno: cada una es la descripcion mas estrecha de lo que el consumidor
necesita.

El punto de relleno es `registerDomainHandlers`, en `handlers.ts`, que `server.ts` y `worker.ts` invocan
por igual. Eso resuelve los dos enganches por construccion y no por parche: lo que se instala en el
proceso servidor se instala en el de la cola, porque los dos pasan por el mismo fichero. Los registros
de los modulos son idempotentes y guardados por bandera, de modo que un modulo puede seguir llamandolos
desde su propio registro sin apilar una segunda copia.

Un paso registrado sin estrategia no se ejecuta a medias ni en silencio: el registro publica un
predicado `available`, y el motor de liquidacion reporta el paso como no ejecutado en el asiento
agregado, que es la semantica que ADR-0039 fijo para los pasos sin implementar.

### Consecuencias

`CANCEL_TASKS` pasa a tener estrategia, con el desgaste prorrateado, la liberacion de la reserva de
silo, la devolucion de trabajador y maquinaria y la retirada del trabajo agendado. La cancelacion de una
tala devuelve a `STANDING` los arboles marcados. El proceso `worker` aplica la liquidacion forzosa y
completa una tala con el manejador correcto. `BUILDINGS` y `UNUSED_LAND` siguen declarados sin
estrategia, porque demoler un edificio y devolver la propiedad de una celda son operaciones que sus
modulos no exponen, y se reportan como no ejecutados.

Una leccion que la aplicacion dejo escrita y que vale mas que la costura misma: un parche redactado en
una nota de traspaso envejece con el codigo contra el que se escribio, y aplicarlo al pie de la letra es
lo que introduce el error silencioso. `NOTES-w6c` 2.2 proponia llamar a `releaseForestryTask` desde
`cancelTask`; esa funcion retiraba el trabajo agendado, liberaba las maquinas y liberaba la reserva de
almacen, y para cuando se aplico el parche `cancelTask` ya hacia las tres para toda operacion que
declare almacen en la tabla de §90, `FELL` incluida. Llamarla tal cual habria descontado
`reservedWoodDm3` dos veces. La funcion se estrecho a lo que solo `forestry` sabe hacer, y la prueba de
integracion que acompana al cambio afirma `reservedWoodDm3 = 0` precisamente por eso.

Coste asumido: el compilador deja de ver el vinculo. Que `modules/economy` llama a `modules/tasks` ya no
se lee en ninguna importacion, sino en un registro que se rellena en tiempo de arranque, de modo que un
olvido en `handlers.ts` no es un error de compilacion sino un paso que se reporta como no ejecutado. El
predicado `available` existe para que ese olvido sea visible en el asiento y no invisible; es una
degradacion declarada, no una garantia estatica.

### Alternativas descartadas

Relajar la zona de ESLint del modulo `tasks` para admitir `./forestry`: resuelve una de las dos costuras
y no la otra, y lo hace legitimando de forma permanente justo la dependencia que la regla 4 existe para
impedir. Una excepcion de zona no se puede acotar a una funcion.

Mover la semantica de la cancelacion forestal a un modulo de `lib/`: `lib/` es infraestructura y no
dominio, y las marcas `MARKED_FOR_HARVEST`, la reserva de madera y el puntero de la parcela son dominio
de `forestry`. Trasladarlas duplicaria la regla en dos sitios, que es lo que la seccion 8 del plan
prohibe para las reglas compartidas y vale igual aqui.

Invertir la dependencia con un evento de dominio interno al que `forestry` se suscribiera: es el mismo
registro con mas maquinaria, y con un modo de fallo peor, porque un evento sin suscriptor se pierde en
silencio mientras que un paso sin estrategia se reporta.

Que `worker.ts` construya la aplicacion Fastify para heredar los enganches que se instalaban desde el
registro de rutas: arrancaria un servidor HTTP en el proceso de la cola para obtener un efecto
secundario del registro, que es exactamente la clase de acoplamiento que ADR-0003 evito al separar los
dos puntos de entrada sobre un solo proyecto.

---

## ADR-0059 — El criterio de cierre frente al GDD: se corrige el codigo, no la constante, y toda correccion llega con la prueba que falla antes

Fase: W7 · Fecha: 2026-08-13

### Estado

Aceptada.

### Contexto

La ultima fase del proyecto encargo dos revisiones adversariales con el mandato explicito de refutar,
no de confirmar: una de formulas y balance contra §77 a §138 (`docs/revision-formulas.md`) y otra de
alcance y validacion autoritativa contra §86, §99, §112, §126 y §141 usadas como lista de comprobacion
(`docs/revision-alcance.md`). El recorrido de humo aporto un hallazgo mas. Entre las tres, diecinueve
hallazgos confirmados por ejecucion y no por lectura: nueve, nueve y uno.

Un proyecto que llega a esta situacion tiene tres formas de resolverla y las tres son defendibles por
separado: corregir el codigo, corregir el documento, o ajustar la constante que produce la discrepancia.
Sin un criterio escrito antes de empezar, la eleccion la acaba tomando la comodidad de cada caso, y el
resultado es un balance retocado a trozos y una trazabilidad perdida.

### Decision

Tres reglas, fijadas antes de aplicar el primer arreglo:

1. Se corrige el codigo que no hace lo que el GDD dice. El GDD y el documento de stack no se modifican,
   que es la decision de la seccion 2 del plan y no se reabre.
2. No se ajusta ninguna constante de balance. Los hallazgos que piden cambiar un numero se registran
   como recomendacion y no se aplican (ADR-0057).
3. Toda correccion lleva su prueba de regresion, y de todas se comprueba que falla antes del arreglo y
   pasa despues, las dos cosas ejecutadas y con su salida anotada.

Y una cuarta que se derivo al aplicarlas: donde el arreglo natural era mover una regla, se mueve la
regla en lugar de duplicarla mejor. La segmentacion por fase de la proyeccion de malezas subio a
`shared/rules/yield.ts` y la llaman el backend y el almacen del cliente, en lugar de arreglar la copia
del cliente para que coincidiera; una sola implementacion es lo que la seccion 8 del plan exige y lo que
impide que las dos vuelvan a separarse.

Dos reglas estructurales quedan escritas por las correcciones que las provocaron, y valen mas alla del
caso concreto:

Una tabla del GDD que asigna papeles se valida por papel y no como multiconjunto. La de §90 se estaba
comprobando como conjunto de tipos, de modo que intercambiar la maquina propulsada y el implemento
producia una tarea aceptada en las cuatro operaciones agricolas y en el desmonte. La comprobacion por
papel precede al recuento y la reciben los tres llamantes.

Las guardas que deciden identidad se ejecutan antes que la validacion de esquema. Estaban registradas
en `preHandler`, que corre despues de que Fastify haya parseado y validado el cuerpo, de modo que un
llamante sin sesion enumeraba el esquema de cuerpo de cualquier ruta leyendo `details.field` de un 400
que nunca deberia haber recibido. La guarda de desarrollo y la de autenticacion pasan a
`onRequest`, que corre antes de parsear el cuerpo; la de idempotencia y la de avance del jugador siguen
en `preHandler`, porque necesitan cuerpo e identidad.

A ellas se suma la confirmacion de una decision anterior que la implementacion contradecia: el punto 3
de ADR-0007 dice que el mundo persistido manda sobre su propio multiplicador, y el arranque de cualquier
proceso lo re-anclaba desde `GAME_RATE_NUM`, de modo que un `dev/retime` no sobrevivia a un reinicio y
dos procesos con entornos distintos se pisaban el reloj. El re-anclaje pasa a exigir
`GAME_RATE_APPLY_ON_BOOT=true`, que solo declara el recorrido de humo, cuyo mundo acelerado es suyo
durante la ejecucion y que lo restituye al terminar.

Y una regla de modelado que el defecto del desmonte dejo clara: cuando una entidad se queda sin la
propiedad que su restriccion exige, se da de baja logicamente en lugar de escribir el valor imposible.
La parcela forestal desmontada por completo se cierra con `disposedGameMs` y emite
`FOREST_PLOT_REMOVED`; `forest_plots_geometry_check` es correcta y no se relaja.

### Consecuencias

Doce correcciones aplicadas, cada una con su prueba, y siete hallazgos registrados sin corregir. La
tabla completa esta en el apartado 6 de `docs/erratas-gdd-stack.md`, con la resolucion de cada uno y el
motivo de cada no-correccion.

Tres correcciones cambian lo que el juego hace, y las tres en la direccion de la letra del GDD. Quien
lea una suite anterior o un informe anterior debe saberlo: la cosecha ya no reinicia el nivel de
malezas, porque §78 enumera una unica via en el MVP y §89 la recoge como efecto exclusivo del
cultivador; una tala por lote ya no destruye los plantones, que §131 declara no talables, de modo que
tras una tala la parcela no queda vacia; y el arranque ya no cambia el multiplicador de un mundo vivo.

Lo que la disciplina de la regla 3 costo: revertir a mano cada arreglo para ver su prueba en rojo. Lo
que compro se puede leer en la salida anotada —`expected 2 to be 1` para el planton, `expected 200 to be
greater than or equal to 400` para los papeles de §90, `/api/farms: expected 400 to be 401` para el
orden de las guardas, `expected true to be false` para el reloj, `malezas a las 18 h: expected 1080 to
be +0` para el cliente—: siete de las doce pruebas afirman algo que ninguna otra prueba del repositorio
afirmaba, y sin verlas fallar no habria constancia de que lo afirman de verdad.

El limite del criterio, que conviene declarar: cuatro de los diecinueve hallazgos estaban en `tools/`, que
no tiene ninguna puerta de pruebas, y su prueba de regresion fue el propio informe regenerado. Es la
excepcion a la regla 3 y esta admitida solo porque el informe es determinista y esta versionado.

### Alternativas descartadas

Corregir sin prueba, apoyandose en que la revision ya ejecuto el caso: la ejecucion de una revision es
un hecho del pasado y no una puerta, y la mitad de estos defectos son de la clase que vuelve en cuanto
alguien reorganiza el fichero.

Corregir el GDD o el documento de stack donde el codigo tenia razon: el material de partida se conserva
tal como se recibio, y para eso existe `docs/erratas-gdd-stack.md`.

Relajar `forest_plots_geometry_check` para admitir `cellCount = 0`: la restriccion expresa una verdad
del modelo —una parcela sin celdas no es una parcela— y relajarla habria convertido un defecto
diagnosticable en un estado invalido persistido.

Dejar la tabla de §90 validada como multiconjunto porque el cliente no ofrece la combinacion
intercambiada: el cliente no es una autoridad, que es el primer pilar de §54 y lo que la revision de
alcance estaba encargada de refutar.

Ajustar las constantes que las revisiones cuestionaron —la tasa de malezas, el mantenimiento de los
implementos, las tasas de desgaste— para que las cifras del GDD se reprodujeran: es la salida que
convierte una desviacion documentada en un balance retocado sin rastro, y esta descartada desde la
planificacion.

---

## ADR-0060 — Un catalogo de sesenta y dos cultivos como linea base por familia mas desviaciones

Fase: W8 · Fecha: 2026-08-26

### Estado

Aceptada.

### Contexto

El MVP se cerro con un solo cultivo, `WHEAT`, y ADR-0011 dejo anotado el momento exacto en que habria
que volver sobre la decision: «queda por vigilar el momento en que aparezca un segundo cultivo». La
peticion que abrio esta fase pedia unos ciento cuarenta, de los que sesenta y dos son anuales de una
cosecha destructiva y encajan en el ciclo de campo tal como esta; el resto exige mecanicas que no
existen y queda fuera de alcance.

Sesenta y dos cultivos por once constantes son casi setecientos numeros. ADR-0014 obliga a justificar
cada valor inventado donde se escribe, y setecientos comentarios no son revisables: un revisor que no
puede leerlos no encontrara el que esta mal. El riesgo no es escribir el catalogo, es que nadie pueda
comprobarlo despues.

### Decision

El catalogo se declara como una linea base por familia mas una desviacion por cultivo.

`shared/config/crops/families.ts` publica diez lineas base, una por familia, cada una justificada una
sola vez: silueta, categoria de almacen, ventana de siembra, si exige labrar, tasa de malezas, desgaste
de fertilidad y estado tras la cosecha. `defineCrop` deriva de ahi todo lo redundante y cada entrada
declara solo lo que la distingue: su ciclo, su rendimiento y su precio.

Dos magnitudes dejan de escribirse a mano y pasan a derivarse, lo que convierte dos invariantes en
verdades por construccion en vez de comprobaciones que hay que ajustar sesenta y dos veces:

1. Las tres fases temporizadas se reparten desde el ciclo con las proporciones del trigo (625, 1 250 y
   8 125 puntos base), y la ultima absorbe el redondeo, de modo que la suma es siempre el total
   publicado.
2. La regeneracion de fertilidad en barbecho es `max(1, floor(desgaste / 300))`. El divisor es 300 y no
   los 325 del ciclo de §118 a proposito: reproduce exactamente los 5 bp/h del trigo y satisface por
   algebra la cota de que un barbecho no restituya mas de lo que un ciclo drena.

El trigo conserva identificador y las cinco cifras que la revision de balance de 2026-08 dejo fijadas.
Es el ancla: el informe de `docs/balance/` y las pruebas doradas estan construidos sobre el, y el
refactor del catalogo no mueve ni un digito suyo.

La coherencia economica del conjunto deja de ser revision manual y pasa a ser prueba ejecutable
(`shared/rules/__tests__/crop-balance.test.ts`): ningun cultivo pierde dinero en el escenario de
referencia, la razon entre el mejor y el peor margen por hora esta acotada, cada estacion tiene
cultivos que merezcan la pena, y las familias que exigen construir un almacen que el jugador no tiene
al empezar pagan mas por hora que las que van al silo que ya posee.

Y se responde al punto que ADR-0011 dejo abierto: el catalogo sigue siendo constantes de TypeScript y
no una tabla, porque el jugador no desbloquea cultivos. Sigue siendo configuracion global y no estado
por jugador. Si algun dia los desbloqueara, lo que se anade es una tabla de desbloqueos por jugador, no
una tabla de catalogo.

### Consecuencias

Un revisor comprueba diez lineas base y sesenta y una desviaciones de una linea, no setecientos numeros
sueltos. Anadir un cultivo es una linea y una entrada del enum; cambiar como se comporta una familia
entera es una linea, en un sitio.

El coste es que la linea base es ahora un punto de acoplamiento real: tocar el desgaste de fertilidad de
`CEREAL` mueve diez cultivos a la vez. Es deliberado, y es lo que hace que la familia signifique algo.

Los precios de los sesenta y un cultivos nuevos se fijaron calibrandolos contra el propio motor de
balance para alcanzar un margen por hora objetivo de su familia, no eligiendolos a ojo. La calibracion
es reproducible desde el informe de `make balance`, cuya seccion 9 publica la tabla completa, la
dispersion y los cultivos fuera de banda.

`shared/config/crops.ts` deja de existir como fichero y pasa a ser el directorio
`shared/config/crops/`. Los veintidos importadores apuntan ahora a `crops/index.js`.

### Alternativas descartadas

**Escribir las once constantes de cada cultivo.** Es lo que ADR-0014 pide literalmente y lo que se hizo
con el trigo. Con un cultivo era correcto; con sesenta y dos produce un fichero que nadie revisa, y un
catalogo que no se revisa es un catalogo con un error dentro que nadie ha visto todavia.

**Mover el catalogo a la base de datos.** ADR-0011 ya lo descarto y las razones no han cambiado: seguiria
sin haber panel de administracion, y una tabla poblada por semilla convierte un cambio de balance en una
migracion. El numero de filas nunca fue el argumento.

**Generar el catalogo con un script en tiempo de compilacion.** Quitaria la escritura a mano, pero el
artefacto que gobierna el juego dejaria de ser legible en el repositorio, que es justamente lo que hace
util que los catalogos sean constantes versionadas con el codigo.

---

## ADR-0061 — Las existencias recuerdan su cultivo; la categoria de almacen es solo el cubo de capacidad

Fase: W8 · Fecha: 2026-08-26

### Estado

Aceptada. Enmienda ADR-0036.

### Contexto

Con un cultivo, `WHEAT_LITERS` era a la vez el recurso, el cultivo y el edificio que lo guarda, y las
tres cosas coincidian sin que hiciera falta distinguirlas. El almacen vivia en seis columnas de `farms`
y un CHECK intra-fila las comparaba: `stored + reserved <= capacity`.

Con sesenta y dos cultivos las tres cosas se separan y hay que elegir por cual se indexa el precio. Si
el precio fuera de la categoria, los veintidos cultivos de grano valdrian lo mismo por litro y el
jugador sembraria siempre el de mas litros por hora: sesenta y dos cultivos colapsarian en cuatro
decisiones. El objetivo eran sesenta y dos perfiles de riesgo y retorno, y el perfil lo lleva el precio.

### Decision

El precio es del cultivo. La categoria es el cubo de capacidad, y nada mas.

En consecuencia las existencias dejan de ser un contador por recurso y pasan a ser una pila por bien
fungible, que recuerda de que cultivo vino. Dos tablas, no una:

- `farm_stock (farmId, item)`, una fila por pila, que es lo que se vende y lo que se valora.
- `farm_storage (farmId, category)`, una fila por categoria con la capacidad y el CHECK, mantenida por
  un disparador que la recalcula desde las pilas.

El agregado no es redundancia opcional. Es el punto de serializacion: dos cosechas de dos cultivos
distintos tocan dos filas de `farm_stock` distintas y no competirian por nada, cuando lo que compiten es
por la misma camara fria. Toda escritura toma `FOR UPDATE` sobre la fila de la categoria antes de
decidir, que es lo que la fila unica de granja hacia antes de forma implicita.

La decision se toma en TypeScript contra la fila bloqueada y no como un UPDATE condicional, que es lo
que permite a `depositStorage` acotar lo que acepta en vez de fallar: corre dentro de un job de cola y
una violacion de CHECK ahi se reintentaria para siempre. El CHECK sigue siendo lo que siempre fue, la
red y nunca el mecanismo (ADR-0018).

La relacion entre categoria y edificio se mantiene uno a uno. Un almacen que concediera sitio a dos
categorias tendria que sumar litros de bienes distintos contra un mismo contador, o repartir su
capacidad dos veces. Por eso las cinco categorias traen cinco edificios: silo, henil, camara fria,
almacen y almacen de madera. Es tambien lo que hace que elegir cultivo sea una decision de inversion y
no solo una tabla de precios: no se puede cosechar hortaliza sin construir antes la camara.

Todo lo agricola se cuenta en litros, como ya hacia el trigo. No se introduce el kilogramo: bifurcaria
la formula de rendimiento y el tipo de precio a cambio de cero juego.

Una cosecha no nombra cultivo en su peticion —lo lleva el campo—, asi que `OPERATION_REQUIREMENTS`
responde `FROM_CROP` y un unico resolutor, `storageTargetOf`, traduce ese centinela. La fila de la
tarea guarda ademas el cultivo que el campo tenia al asignarla, para que la reserva, el deposito y la
devolucion nombren la misma pila aunque el campo se haya vuelto a sembrar entretanto.

### Consecuencias

Un jugador con trigo y cebada tiene dos lineas vendibles bajo un unico medidor de grano, cada una a su
precio. El inventario es proporcional a lo que la granja tiene y no al tamanio del catalogo: una pila
vacia no tiene fila.

`STORAGE_COLUMNS` desaparece, y con ella la interpolacion de nombres de columna en SQL crudo: la clave
viaja ahora como parametro.

El contrato cambia en cinco sitios a la vez —`farmDtoSchema`, `marketPriceSchema`, `sellBodySchema`,
`inventoryLineSchema` y los dos codigos de capacidad excedida, fundidos en `STORAGE_CAPACITY_EXCEEDED`—,
asi que backend y frontend tienen que moverse en el mismo cambio.

Toda granja nace con sus cinco filas de agregado, por disparador. No pueden crearse perezosamente por el
escritor que las necesita: dos cosechas concurrentes intentarian insertarla a la vez.

### Alternativas descartadas

**Un recurso de almacen por cultivo.** Sesenta y dos valores de enum en PostgreSQL y sesenta y dos
capacidades de silo por granja, para modelar que el trigo y la cebada no caben en el mismo sitio, que es
falso.

**Un unico stock generico en litros equivalentes.** Simple, pero borra la unica razon por la que un
edificio de almacen es una decision: si todo cabe en el mismo sitio, construir la camara fria no
significa nada.

**Guardar solo el desglose y calcular la capacidad al vuelo.** Pierde el punto de serializacion, y con el
la propiedad de que dos cosechas simultaneas no puedan ver ambas un hueco que solo una tiene.

---

## ADR-0062 — Cuatro estaciones derivadas del reloj, con ventana de siembra por cultivo y sin clima

Fase: W8 · Fecha: 2026-08-26

### Estado

Aceptada. Desviacion consciente de §86, registrada en `docs/erratas-gdd-stack.md`.

### Contexto

§82 lista `season` dentro de los datos del cultivo y lo marca como futuro; §86 pone las estaciones fuera
del MVP estricto, junto con el clima y el riego. El MVP se cerro asi y `shared/config/time.ts` lo dejo
escrito: «no hay estacion».

Con sesenta y dos cultivos esa exclusion deja de ser barata. Sin estaciones, elegir cultivo es leer una
tabla de margen por hora y sembrar siempre el mejor: el catalogo entero se reduce a su primera fila. La
ventana de siembra es lo que convierte sesenta y dos filas en una decision que cambia cada trimestre.

### Decision

Se anaden las cuatro estaciones, y solo eso.

La estacion es una derivacion pura del reloj del mundo: `seasonAtGameMs(gameMs)`, sin ninguna columna en
ninguna tabla. Es el mismo trato que recibe la etapa de crecimiento de un arbol, que tampoco se almacena
y siempre es funcion del instante de plantacion, y por la misma razon: lo que no se guarda no puede
desincronizarse.

Es del mundo y no del jugador. Se calcula sobre el `gameMs` absoluto y no sobre el `startedAtGameMs` del
jugador, porque derivarla del jugador pondria a dos habitantes del mismo mundo en estaciones distintas
en el mismo instante.

Una estacion son treinta dias de juego, 720 horas: caben dos ciclos completos de los 325 h de §118, de
modo que la ventana es una decision de planificacion y no un cierre. El anio son 2 880 horas, que al
multiplicador por defecto son cinco dias reales, con lo que el ciclo estacional se observa en una semana
de juego en vez de ser algo de lo que se habla y no se ve. Se ancla en `INITIAL_ANCHOR_GAME_MS` y no en
cero, porque el mundo tampoco empieza en cero: anclarlo en otro sitio arrancaria cada mundo a mitad de
estacion.

**Solo se comprueba la estacion en el instante de sembrar.** Un ciclo que se pasa del final de su
ventana no se penaliza. El interes esta en la planificacion —un ciclo largo sembrado tarde bloquea el
campo durante la ventana siguiente—, no en un castigo aplicado mientras el jugador esta desconectado.
Es el mismo argumento por el que la liquidacion forzosa la dispara el barrido y no el login.

No hay clima dinamico, ni regiones, ni temperatura, ni lluvia, ni riego. El motivo que §86 da para la
exclusion es el alcance, y una derivacion pura sin estado ni modificador de rendimiento no lo amplia.

El rechazo lleva la estacion vigente, las que el cultivo admite y el instante en que se abre la
siguiente, de modo que el panel puede responder «el maiz se siembra en primavera, dentro de tres dias»
en vez de solo decir que no. Lo comprueba el servidor en los dos sitios de siempre —la prevalidacion de
la asignacion y la aplicacion autoritativa—, porque un codigo que solo comprobara el panel seria el
panel decidiendo (ADR-0032).

La estacion no viaja por la API. El cliente ya lleva `gameMs` y el ancla con la que extrapola, y deriva
la estacion con la misma funcion pura de `shared/`. Cero contrato nuevo.

### Consecuencias

`shared/config/time.ts` deja de afirmar que no hay estaciones. Una afirmacion en el codigo que deja de
ser cierta es exactamente la deriva que `docs/erratas-gdd-stack.md` existe para cazar, y por eso el
cambio va acompanado de su fila alli.

La cobertura estacional pasa a ser una propiedad comprobable del catalogo: la union de las ventanas
cubre las cuatro estaciones y ninguna se queda sin cultivos que merezcan la pena. El informe de
`make balance` publica la tabla en su seccion 9.4.

Un cultivo mal colocado en el calendario ya no es un detalle de sabor: si una estacion se queda sin
nada viable, es un trimestre muerto, y la suite lo dice.

### Alternativas descartadas

**Estaciones mas regiones climaticas.** Daria sentido al cafe y al manzano a la vez, pero toca el
generador de mundo y la compra de tierra, y ninguno de los dos cultivos entra en esta fase.

**Penalizar el rendimiento de un ciclo que cruza el fin de su estacion.** Exige un multiplicador nuevo en
`finalYieldLiters` y una tabla estacion por cultivo, y no aporta ninguna decision que la ocupacion del
campo no aporte ya. Queda registrada como descartada, no como olvidada.

**No anadir estaciones.** Es lo que §86 dice, y es lo que deja el catalogo reducido a su primera fila.

---

## ADR-0063 — Render por silueta de familia y tinte por cultivo: cuarenta casillas de atlas, no quinientas

Fase: W8 · Fecha: 2026-08-26

### Estado

Aceptada. Enmienda ADR-0020 y ADR-0023.

### Contexto

El atlas de uso tenia quince casillas indexadas por el estado del ciclo, y `paintEars` dibujaba
literalmente una espiga de trigo. Con un cultivo era exacto. Con sesenta y dos, los sesenta y dos se
verian identicos sobre el mapa: el jugador no podria distinguir su trigal de su patatal sin abrir un
panel, que es justo lo que §60 pide evitar.

Sesenta y dos cultivos por ocho fases son cuatrocientas noventa y seis casillas, que no caben en un
atlas extruido y serian cuatrocientas noventa y seis rutinas de dibujo escritas a mano.

### Decision

No hacen falta, porque **solo cuatro de las ocho fases muestran planta**. Barbecho, arado, labrado y
sembrado son suelo, y una semilla no se distingue a dieciseis pixeles: esas cuatro siguen siendo una
casilla cada una. Germinando, creciendo, listo y cosechado si dependen del cultivo, y ahi es donde el
atlas se multiplica.

Se multiplica por **silueta y no por cultivo**. Siete siluetas —espiga, vaina, capitulo, tuberculo,
roseta, mata y flor— que son deliberadamente mas gruesas que la familia, porque lo que el lienzo tiene
que transmitir a dieciseis pixeles es la forma de la planta, no su especie. El cultivo se distingue por
el tinte, que ya viaja por celda.

La aritmetica: las quince casillas actuales se conservan **sin repintar un pixel** y pasan a ser la
silueta de espiga; las otras seis anaden cuatro cada una. Treinta y nueve casillas en cuarenta huecos,
144 x 90 pixeles, frente a los 72 x 72 de hoy. Las casillas nuevas van al final del orden, de modo que
ningun indice existente se mueve y el contrato de indices que la cabecera del fichero documenta se
preserva.

`growthTint` conserva firma y rampa, y se le anade un hermano por cultivo. `CROP_TINTS.WHEAT` se fija a
proposito al final de la rampa, de modo que el trigo se dibuja exactamente como antes y las pruebas
doradas del atlas y de las casillas sobreviven intactas.

Los tokens CSS siguen siendo ocho, uno por fase, y no sesenta y dos. Emitir sesenta y dos seria publicar
un contrato que nadie lee; el color por cultivo se sirve en linea con un helper, como ya se hace con el
color del terreno.

El `cropId` cruza a la escena por `FieldRenderState`, que es la costura que ya existia. La escena sigue
sin importar ningun store, que es la regla de zona que ESLint impone.

### Consecuencias

El atlas pasa de 20,7 KB a 51,8 KB de RGBA. Es dos veces y media, y sigue siendo una fraccion de lo que
costaria cualquiera de las alternativas.

El trabajo de arte genuinamente nuevo son seis rutinas de dibujo de unas veinte lineas cada una. Es
acotado, pero es trabajo de pixel a dieciseis por dieciseis y no sale bien a la primera.

El minimapa mezcla el tinte en las fases con planta, de modo que tambien distingue cultivos.

### Alternativas descartadas

**Un atlas por cultivo, cargado bajo demanda.** Sesenta y dos atlas de 51,8 KB son 3,3 MB y sesenta y dos
pasadas de generacion en el arranque, contra lo que ADR-0023 decidio sobre el coste del arranque.

**Una casilla por cultivo y fase.** Cuatrocientas noventa y seis casillas y otras tantas rutinas de
dibujo. El coste no es el tamanio del atlas, es que nadie las escribiria bien.

**Solo tinte, sin siluetas nuevas.** Seria lo mas barato y es lo que hace ilegible el mapa para quien no
distingue dos verdes: §60 pide que el patron lleve el significado y el color solo lo refuerce, que es la
razon por la que las ocho fases se dibujan con patrones distintos y no con ocho tonos.
