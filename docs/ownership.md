# Propiedad de directorios y reglas de trabajo en paralelo

Estado: vigente desde la ventana de correccion de W7. El apartado 4 recoge todas las diferencias frente
al arbol previsto en la seccion 4 del plan, y el apartado 5 los ficheros que la correccion de W7 abrio,
uno a uno y con su motivo. El cuerpo de la tabla de propiedad es el que dejo el cierre de W6, el que
implemento el motor de tareas, la sesion con instantanea y resumen de regreso, la silvicultura completa,
la costura del cliente de esas tres materias y el tercer y ultimo grupo de paneles.

El arbol real son 548 ficheros, contados con `find` excluyendo `.git/`, `node_modules/`,
`frontend/.nuxt/`, las dos copias generadas de `shared/`, `backend/src/generated/` y los `*.tsbuildinfo`.
La cuenta cuadra asi: 502 declarados en el cierre anterior mas los 46 ficheros nuevos de W6 que el
apartado 4.8 reparte uno a uno. Los cinco `.vue` de panel de esta fase no son ficheros nuevos: sustituyen
en su sitio al andamiaje que W3-C dejo, que es lo que la regla 3 pide. Todos ellos estan atribuidos en el
apartado 3. El primer cierre de W4 cuadro la tabla con `git ls-files` y
`git status --porcelain --untracked-files=all`; los tres siguientes, este incluido, lo han hecho con
`find` y con las marcas de tiempo del sistema de ficheros, porque la regla 5 prohibe ejecutar `git` a los
agentes de fase.

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
| W2.5 Ventana de parcheo | Aplicacion de las notas de traspaso de W2 sobre ficheros congelados, instalacion de dependencias, migracion y semilla | 1 |
| W3 Esqueletos y primitivas | Esqueleto de Fastify y del worker, `lib/`, autenticacion, stubs de modulos, modulo de mundo, esqueleto de Nuxt y fabrica de texturas | 5 |
| W4 Dominio 1 y render del mundo | Tierra, granjas y edificios, campos, escena del mundo, primer grupo de paneles | 5 |
| W5 Dominio 2 e interaccion | Maquinaria, trabajadores, economia, entidades y rotulos, herramienta de seleccion, segundo grupo de paneles | 6 |
| W6 Tareas, sesion y silvicultura | Motor de tareas, sesion e instantanea con resumen de regreso, silvicultura completa, costura del cliente y tercer grupo de paneles con sus pruebas | 6 |
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
tres dependen en un unico sentido. El coste real de la division aparecio en `shared/index.ts`, que es el
unico fichero que los cuatro tenian que tocar y que ninguno toco: sus cuatro reexportaciones quedaron
comentadas y las habilito la ventana de parcheo W2.5, que es tambien la que aplico las notas de traspaso
sobre ficheros congelados (`docs/handoff/NOTES-w2-5-parcheo.md`).

La fase W3 se ejecuto con cuatro agentes de implementacion mas un agente de cierre documental:

| Agente | Ambito escrito | Fichero de traspaso |
|---|---|---|
| W3-A | `backend/src/app.ts`, `server.ts`, `worker.ts`, `handlers.ts`, `plugins/`, `lib/`, `modules/auth/`, los andamiajes de los diez modulos restantes y las pruebas de raiz de `backend/src/__tests__/` | `docs/handoff/NOTES-w3a.md` |
| W3-B | `backend/src/modules/world/` y `backend/src/__tests__/world/` | No lo dejo (apartado 4.4) |
| W3-C | `frontend/app/` salvo `game/` y `pages/texture-lab.vue`: red, almacenes, composables, shell, paginas, capa de interfaz de `assets/`, registro de paneles con sus 23 stubs y servidor simulado | `docs/handoff/NOTES-w3c.md` |
| W3-D | `frontend/app/game/index.ts`, `game/boot/`, `game/textures/`, `pages/texture-lab.vue` y el bloque generado de `assets/tokens.css` | `docs/handoff/NOTES-w3d.md` |
| W3-E | `docs/adr.md`, `docs/erratas-gdd-stack.md`, `docs/ownership.md`, `README.md` | `docs/handoff/NOTES-w3-cierre.md` |

La fase W4 se planifico con cinco agentes de implementacion mas uno de cierre documental y se ejecuto en
dos tandas. En la primera, los dos agentes de paneles murieron por perdida de conexion sin escribir nada
y en su lugar se adelanto desde W5 la herramienta de seleccion; en la segunda se relanzaron los dos
agentes de paneles y un segundo agente de cierre documental.

| Agente | Ambito escrito | Fichero de traspaso |
|---|---|---|
| W4-A | `backend/src/modules/land/` y `backend/src/__tests__/land/` | `docs/handoff/NOTES-w4a.md` |
| W4-B | `backend/src/modules/farms/` y `backend/src/__tests__/farms/` | `docs/handoff/NOTES-w4b.md` |
| W4-C | `backend/src/modules/fields/` y `backend/src/__tests__/fields/` | `docs/handoff/NOTES-w4c.md` |
| W4-D | `frontend/app/game/world/`, `frontend/app/game/overlay/` y `frontend/app/pages/perf.vue` | `docs/handoff/NOTES-w4d.md` |
| W4-G | `frontend/app/game/selection/` | `docs/handoff/NOTES-w4g.md` |
| W4-cierre | `docs/adr.md` (0023-0030), `docs/erratas-gdd-stack.md`, `docs/ownership.md`, `README.md` | `docs/handoff/NOTES-w4-cierre.md` |
| W4-E | Diez paneles: `cell-inspector`, `land-purchase`, `field-list`, `field-inspector`, `field-create`, `field-edit`, `legend`, `minimap`, `notices` y `settings` | `docs/handoff/NOTES-w4e.md` |
| W4-F | Tres paneles de granja: `farm-overview`, `building-placement` y `building-inspector` | `docs/handoff/NOTES-w4f.md` |
| W4-cierre-2 | `docs/adr.md` (0031-0038), `docs/erratas-gdd-stack.md`, `docs/ownership.md`, `README.md` | `docs/handoff/NOTES-w4-cierre-2.md` |

Consecuencias del reparto real sobre la tabla del apartado 3, que son dos. La primera, de la primera
tanda: los tres directorios que W4-D y W4-G escribieron figuraban atribuidos a la fase W5, y el apartado
4.5 explica cada caso. La segunda, de la segunda: el primer grupo de paneles no son once sino trece, no
los escribe un unico agente, y dos de ellos —`notices` y `settings`— pertenecen segun el registro a los
lotes de W6-D y de W5-F. El apartado 3.6 recoge el reparto real panel a panel y el 4.6 lo explica.

La fase W5 se ejecuto con seis agentes de implementacion mas uno de cierre documental. Dos de ellos no
figuraban en el reparto del plan: la calculadora de balance se adelanto desde W6-E al agente de economia,
que es quien tiene las reglas de coste, y se anadio un agente de costura del cliente con mandato explicito
sobre los ficheros del cliente que W3-C y W4-D dejaron congelados, que es la unica forma de aplicar las
notas de traspaso de aquellas fases sin abrir el fichero a seis agentes a la vez.

| Agente | Ambito escrito | Fichero de traspaso |
|---|---|---|
| W5-A | `backend/src/modules/machinery/` y `backend/src/__tests__/machinery/` | `docs/handoff/NOTES-w5a.md` |
| W5-B | `backend/src/modules/workers/` y `backend/src/__tests__/workers/` | `docs/handoff/NOTES-w5b.md` |
| W5-C | `backend/src/modules/economy/`, `backend/src/__tests__/economy/`, `tools/balance/` y `docs/balance/` | `docs/handoff/NOTES-w5c.md` |
| W5-D | `frontend/app/game/entities/` | `docs/handoff/NOTES-w5d.md` |
| W5-F | Cinco paneles: `machinery`, `workers`, `labor-pool`, `market` y `starting-guide` | `docs/handoff/NOTES-w5f.md` |
| W5-W | Costura del cliente: `pages/game.vue`, `composables/`, `mock/`, `game/world/`, `components/panels/registry.ts`, `components/ui/UiButton.vue` y `app/__tests__/mock-server.test.ts` | `docs/handoff/NOTES-w5w.md` |
| W5-cierre | `docs/adr.md` (0039-0048), `docs/erratas-gdd-stack.md`, `docs/ownership.md`, `README.md` | `docs/handoff/NOTES-w5-cierre.md` |

Consecuencias del reparto real de W5 sobre la tabla del apartado 3, que son tres. Primera: `tools/balance/`
y `docs/balance/` figuraban como propiedad de W6-E y las escribio W5-C; el apartado 3.7 y el 4.7 lo
recogen. Segunda: el agente de costura es el unico de la fase con mandato sobre ficheros congelados de
fases anteriores, y las filas del apartado 3.6 pasan a llevar su nombre en las rutas afectadas. Tercera:
no hubo agente `W5-E`; la herramienta de seleccion que el plan le atribuia la escribio W4-G en la fase
anterior, segun el apartado 4.5.

La fase W6 se planifico con cinco agentes y se ejecuto en dos tandas, porque una parada solicitada por el
usuario la interrumpio despues de los tres modulos de dominio y de los cinco paneles. En la primera tanda
entregaron los tres agentes de backend y el agente de paneles; en la segunda, tras reanudar, el agente de
costura del cliente y un agente de pruebas de esos cinco paneles que el reparto original no preveia, mas
este agente de cierre documental.

| Agente | Ambito escrito | Fichero de traspaso |
|---|---|---|
| W6-A | `backend/src/modules/tasks/` y `backend/src/__tests__/tasks/` | `docs/handoff/NOTES-w6a.md` |
| W6-B | `backend/src/modules/session/` y `backend/src/__tests__/session/` | `docs/handoff/NOTES-w6b.md` |
| W6-C | `backend/src/modules/forestry/` y `backend/src/__tests__/forestry/` | `docs/handoff/NOTES-w6c.md` |
| W6-D | Cinco paneles: `task-assign`, `task-list`, `forestry`, `forest-plot` y `welcome-back`, mas `components/panels/shared/` | No lo dejo (apartado 4.8) |
| W6-W | Costura del cliente: `pages/game.vue`, `composables/useGameBridge.ts`, `stores/` y `stores/__tests__/` | `docs/handoff/NOTES-w6w.md` |
| W6-T | Los `__tests__/` de los cinco paneles y de `components/panels/shared/`, mas cinco correcciones dentro del codigo de esos paneles | `docs/handoff/NOTES-w6t.md` |
| W6-cierre | `docs/adr.md` (0049-0055), `docs/erratas-gdd-stack.md`, `docs/ownership.md`, `README.md` | `docs/handoff/NOTES-w6-cierre.md` |

Consecuencias del reparto real de W6 sobre la tabla del apartado 3, que son tres. Primera:
`frontend/app/components/panels/shared/` existe, con tres modulos y su directorio de pruebas, y es la
fila que ADR-0037 dejaba prevista y que hasta ahora ninguna tabla declaraba; se anade en el apartado 3.6
con dos propietarios, W6-D el codigo y W6-T las pruebas. Segunda: W6-T escribio dentro del codigo de los
cinco paneles, que es ambito de W6-D, y no hubo dos escritores porque W6-D habia cerrado; el apartado 4.8
lo detalla. Tercera: W6-D no dejo fichero de traspaso, por la misma razon por la que W3-B no lo dejo —la
parada le llego antes—, de modo que sus decisiones estan documentadas leyendo su codigo y las notas de
W6-T y W6-W, que es el procedimiento que el apartado 3.3 ya preveia.

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
| `README.md` | W2-E redacta, W7-A actualiza el estado, W7-F lo reescribe como documento de entrada al cierre | W2-W7 | — |
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
| `scripts/smoke/` | W7-B escribe los ocho ficheros; W7-E aplica sobre ellos las correcciones de su ventana | W7 | — |

### 3.3 Documentacion

| Ruta | Propietario | Fase | Congelado tras |
|---|---|---|---|
| `docs/GDD_Farming_Management_Simulator_Online_v0.4.md` | — | — | intocable |
| `docs/stack.md` | — | — | intocable |
| `docs/ownership.md` | W1 crea; el agente de cierre de cada fase lo cuadra con el arbol real | W1-W7 | — |
| `docs/erratas-gdd-stack.md` | W1 crea; el agente de cierre de cada fase anade lo detectado al implementar | W1-W7 | — |
| `docs/adr.md` | un agente designado por fase, siempre via `scripts/adr-append.mjs` | W1-W7 | — |
| `docs/handoff/README.md` | W1 | W1 | W1 |
| `docs/handoff/NOTES-<agente>.md` | el agente homonimo | la suya | — |
| `docs/revision-formulas.md` | W7-C | W7 | — |
| `docs/revision-alcance.md` | W7-D | W7 | — |
| `docs/balance/` | Generado por `make balance` desde `tools/balance/` (W5-C). W7-F lo regenera y comprueba su determinismo al cierre | W5-W7 | — |

Reparto de la escritura de `docs/adr.md`, con la numeracion real y no la prevista por la seccion 11 del
plan: W1 escribe 0001-0005; W2-E, 0006-0014; W3-E, 0015-0022; el cierre de W4, 0023-0030; su segundo
cierre, 0031-0038; el cierre de W5, 0039-0048; y el cierre de W6, 0049-0055. Cada fase ha anadido mas entradas de las previstas, por el mismo motivo en todos los
casos: el reparto por temas del plan no cubria todo lo que la implementacion obligo a decidir. W3 anadio
dos (ADR-0021 y ADR-0022) y W4 doce sobre las cuatro previstas:

| Numero | Tema | Origen |
|---|---|---|
| 0023 | Dos niveles de detalle en el renderizado | Reparto del plan para W4 |
| 0024 | Cache de chunks con la version en la clave, parte de cliente | Reparto del plan para W4 |
| 0025 | Geometria de campos y contiguidad por recorrido en anchura | Reparto del plan para W4 |
| 0026 | Compra de tierra: reclamacion por actualizacion condicional | Adicion: el reparto no cubria la compra de tierra |
| 0027 | Regla de resolucion de la fusion de campos | Adicion: pedida expresamente al cierre |
| 0028 | Atributos perezosos del campo y transiciones agendadas | Adelantada de W5, donde el plan la situaba |
| 0029 | Granja contable, edificio fisico, precio y capacidades | Adicion: el reparto no cubria granjas ni edificios |
| 0030 | Reglas de validacion compartidas cliente-servidor | Adelantada de W5, con la herramienta de seleccion |
| 0031 | Leyenda desde la paleta y minimapa desde la miniatura de chunk | Adicion: el reparto no cubria los paneles |
| 0032 | El panel no decide: motivo de bloqueo por codigo de validacion | Adicion: mitad de cliente de ADR-0030 |
| 0033 | El plan de colocacion del cliente como espejo del servidor | Adicion: duplicacion declarada y su coste |
| 0034 | Presupuesto local frente a presupuesto del servidor, `expectedTotal` | Adicion: el reparto no cubria el precio en la interfaz |
| 0035 | Estado almacenado frente a proyeccion en el inspector de campo | Adicion: consecuencia de interfaz de ADR-0028 |
| 0036 | Capacidad por catalogo, contenido por granja, ocupantes por edificio | Adicion: consecuencia de interfaz de ADR-0029 |
| 0037 | Organizacion de la capa de paneles | Adicion: estructura obligada por el trabajo en paralelo |
| 0038 | La lista de andamiajes derivada del registro | Adicion: pedida expresamente al cierre |

W5 escribio diez entradas donde el reparto le reservaba tres, por el mismo motivo que en las fases
anteriores: el reparto por temas del plan no cubria todo lo que la implementacion obligo a decidir. Tres de
las diez son temas que el plan situaba en fases posteriores y que esta fase implemento, de modo que se
escriben donde se tomo la decision y no donde el reparto las esperaba:

| Numero | Tema | Origen |
|---|---|---|
| 0039 | Deuda, interes de descubierto y liquidacion forzosa | Reparto del plan para W5 |
| 0040 | La tarea como unico vinculo entre trabajador y maquina, y el desgaste por horas trabajadas | Reparto del plan para W5 |
| 0041 | La reparacion como evento agendado cuya duracion codifica los puntos comprados | Adelantada de W6, donde el plan la situaba |
| 0042 | El pool de contratacion: regla procedural, reemplazo integro y listado perezoso | Adicion: el reparto no cubria la contratacion |
| 0043 | Mercado e historico: precio del catalogo, unidad de calculo y paginacion por secuencia | Adicion: el reparto no cubria el mercado |
| 0044 | El informe de balance como entregable determinista y no como puerta | Adelantada de W7-D, con la calculadora |
| 0045 | Movimiento de maquinaria y trabajadores cosmetico y derivado en el cliente | Adelantada de W6, donde el plan la situaba |
| 0046 | La capa de entidades: decision pura, dos frecuencias y reciclado acotado | Adicion: el reparto no cubria las entidades |
| 0047 | La costura del lienzo en la pagina y el arbitraje de entrada | Adicion: la costura no estaba prevista como agente |
| 0048 | El orden de evaluacion del servidor como motivo del control inhabilitado | Adicion: consecuencia de interfaz de ADR-0032 |

W6 escribio siete entradas donde el reparto le reservaba tres, por el mismo motivo que en todas las fases
anteriores. Dos de sus cuatro temas previstos ya estaban escritos desde W5 (ADR-0041 y ADR-0045), igual
que ocurrio en W4 con ADR-0028 y ADR-0030:

| Numero | Tema | Origen |
|---|---|---|
| 0049 | El arbol no almacena nada y el hito se agenda por parcela y por ventana | Reparto del plan para W6 |
| 0050 | El lote de una tala se recuerda marcando sus arboles, y el desmonte es una operacion sobre la parcela | Reparto del plan para W6, mitad de desmonte de bosque |
| 0051 | La parcela publica su geometria por el marco y por la instantanea | Adicion: el reparto no cubria el reparto de datos de la parcela |
| 0052 | Una sola evaluacion para la prevision y la asignacion, y la puerta de transicion como idempotencia | Adicion: el reparto no cubria el motor de tareas |
| 0053 | Los tres caminos por los que un cliente recupera lo que el socket no le entrego | Adicion: el reparto no cubria la sesion ni el resumen de regreso |
| 0054 | La escena viva y el dato que solo viaja en la respuesta | Adicion: dos premisas de orden falsas, halladas en el navegador |
| 0055 | Lo que una prueba de panel afirma, y las tres reglas que destaparon | Adicion: el reparto no preveia un agente de pruebas de panel |

La mitad de desbordamiento de silo que el reparto agrupaba con el desmonte no tiene entrada propia: la
resolucion es de la seccion 2.2 del plan y de la fila 9 del apartado 2 de las erratas —aviso al asignar,
llenado hasta capacidad al completar y desperdicio con asiento— y donde se decide algo es en ADR-0052,
que fija por que es un aviso y no un rechazo.

W7 escribe cuatro entradas, 0056 a 0059, y las escribe el agente de cierre W7-F, que es el unico
escritor de `docs/adr.md` en la fase. La tabla atribuia antes 0056 a W7-D, que resulto ser la revision
adversarial de reglas y alcance y no escribe ADR; queda corregido aqui y registrado como fila 82 del
apartado 7 de las erratas. Los dos temas que el plan reservaba a W7 —estrategia de pruebas y balance—
se escriben como 0056 y 0057, y la fase anade dos que el reparto no preveia:

| Numero | Tema | Origen |
|---|---|---|
| 0056 | Estrategia de pruebas: cinco capas y el recorrido de humo con el multiplicador acelerado | Reparto del plan para W7 |
| 0057 | Balance del MVP sin ajustar y el deficit como resultado publicado | Reparto del plan para W7. ADR-0044 ya fijo el informe como entregable; esta cierra el balance con las cifras finales y con el criterio sobre las recomendaciones no aplicadas |
| 0058 | Las costuras entre modulos hermanos como registro en `lib/` y un unico punto de relleno | Adicion: la decision que la ventana de integracion tuvo que tomar y que ninguna fase podia tomar antes |
| 0059 | El criterio de cierre frente al GDD y la disciplina de la prueba que falla antes | Adicion: el criterio con el que se trataron los diecinueve hallazgos de las dos revisiones adversariales y del recorrido de humo |

Quien escriba usa siempre el script, que rechaza numeros repetidos o no consecutivos y actualiza el
indice.

Los agentes que producen decisiones no las escriben: las anotan en el apartado correspondiente de su
propio `docs/handoff/NOTES-<agente>.md` y el agente de cierre de la fase las redacta. Es lo que garantiza
un unico escritor por fase sobre `docs/adr.md`. Cuando un agente termina sin dejar fichero de traspaso, el
agente de cierre documenta sus decisiones leyendo el codigo, que es lo que ocurrio con W3-B.

Los ficheros de `docs/handoff/` que W7 anade son tres y no seis, uno por cada agente que tenia algo que
traspasar: `INTEGRACION.md`, que es el inventario con el que W7-A clasifico el apartado «Pendiente» de
las 34 notas anteriores y que hace de nota de traspaso de esa ventana; `NOTES-w7b.md`, del recorrido de
humo; y `NOTES-w7e.md`, de la ventana de correccion. No existen `NOTES-w7a.md`, `NOTES-w7c.md`,
`NOTES-w7d.md` ni `NOTES-w7f.md`: W7-A uso `INTEGRACION.md` en su lugar, las dos revisiones
adversariales entregaron su documento propio en `docs/`, y el cierre no traspasa nada porque escribe
directamente en los cuatro documentos que posee. El nombre sigue siendo libre mientras sea unico por
agente, que es lo unico que la regla 5 exige.

Los ficheros de `docs/handoff/` que W6 anade son `NOTES-w6a.md`, `NOTES-w6b.md`, `NOTES-w6c.md`,
`NOTES-w6w.md`, `NOTES-w6t.md` y `NOTES-w6-cierre.md` de este cierre. No existe `NOTES-w6d.md`: el
agente de paneles termino con la parada de la fase y no lo escribio, igual que ocurrio con W3-B, y sus
decisiones estan recogidas en ADR-0055 y en las notas de W6-T y W6-W, que trabajaron sobre su codigo.

Los ficheros de `docs/handoff/` existentes al cierre de W5 son `NOTES-W1.md`, `NOTES-W2a.md`,
`NOTES-W2b.md`, `NOTES-W2c.md`, `NOTES-w2d.md`, `NOTES-w2-cierre.md`, `NOTES-w2-5-parcheo.md`,
`NOTES-w3a.md`, `NOTES-w3c.md`, `NOTES-w3d.md`, `NOTES-w3-cierre.md`, `NOTES-w4a.md`, `NOTES-w4b.md`,
`NOTES-w4c.md`, `NOTES-w4d.md`, `NOTES-w4g.md`, `NOTES-w4-cierre.md`, `NOTES-w4e.md`, `NOTES-w4f.md`,
`NOTES-w4-cierre-2.md`, `NOTES-w5a.md`, `NOTES-w5b.md`, `NOTES-w5c.md`, `NOTES-w5d.md`, `NOTES-w5f.md`,
`NOTES-w5w.md` y `NOTES-w5-cierre.md`, mas el `README.md` del propio directorio. No existe `NOTES-w5e.md`,
por la misma razon por la que no hubo agente W5-E. La caja de los sufijos no es
uniforme, porque cada agente nombro el suyo; el nombre es libre siempre que sea unico por agente, que es
lo unico que la regla 5 exige. No existe `NOTES-w3b.md`, aunque el codigo del modulo de mundo lo cita en
cinco puntos (apartado 4.4).

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
| `backend/src/handlers.ts` | W3-A | W3 | W3 |
| `backend/src/plugins/` (incluidos `routes.ts` y `systemRoutes.ts`) | W3-A | W3 | W3 |
| `backend/src/lib/` y `backend/src/lib/__tests__/` | W3-A | W3 | W3 |
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
| `backend/src/modules/<modulo>/jobs.ts` | W3-A crea el andamiaje con su firma definitiva; lo sustituye el agente del modulo | W3-W6 | — |
| `backend/src/__tests__/*.ts` (raiz: `harness.ts`, `app.int.test.ts`, `idempotency.int.test.ts`, `queue.int.test.ts`) | W3-A | W3 | — |
| `backend/src/__tests__/<modulo>/` | el agente de cada modulo, en el subdirectorio de su modulo | W3-W7 | — |
| `backend/src/shared/` | generado por `scripts/sync-shared-types.sh` (`make sync-types`) | — | no editable |
| `backend/src/generated/prisma/` | generado por `prisma generate` (`make generate`) | — | no editable |

W3-A crea los stubs de los once modulos con su ruta y su firma definitivas, mas el registro de rutas
que los importa (regla 3). Los agentes de W4, W5 y W6 sustituyen el contenido del stub de su modulo,
nunca el registro. Sustituir un andamiaje es cambiar `defineStubRoute(app, clave)` por
`defineRoute(app, clave, manejador)` dentro del modulo; `src/app.ts` no se toca.

Convencion de pruebas del backend, que la fila anterior deja explicita porque la de W2 era ambigua: las
pruebas de un modulo viven en `backend/src/__tests__/<modulo>/` y no dentro del modulo. No es una
preferencia: la zona de ESLint impide que un fichero de `backend/src/modules/<x>/` importe cualquier cosa
que no sea su propio directorio, `lib`, `plugins` o `shared`, de modo que una prueba que necesite el arnes
de integracion no puede vivir ahi. Las pruebas de `lib/` y de `plugins/` si viven en el `__tests__/` de su
propio directorio, y las de `lib/` importan el arnes de `backend/src/__tests__/harness.ts` sin problema,
porque la zona de ESLint que restringe las importaciones se aplica a los modulos de dominio y no a `lib`.

### 3.6 frontend/

| Ruta | Propietario | Fase | Congelado tras |
|---|---|---|---|
| `frontend/package.json`, `frontend/package-lock.json` | W1 | W1 | W1 |
| `frontend/nuxt.config.ts` | W1 | W1 | W1 |
| `frontend/tsconfig.json`, `frontend/vitest.config.ts` | W1 | W1 | W1 |
| `frontend/Dockerfile` | W1 | W1 | W1 |
| `frontend/app/app.vue` | W1 crea el stub, W3-C lo sustituye | W1-W3 | W3 |
| `frontend/app/pages/index.vue`, `login.vue` | W1 crea `index.vue` de andamiaje, W3-C lo sustituye y anade `login.vue` | W1-W3 | W3 |
| `frontend/app/pages/game.vue` | W3-C crea la pagina, W5-W la reescribe con la costura del lienzo, W6-W adjunta la capa de entidades | W3-W6 | — |
| `frontend/app/pages/perf.vue` | W3-C crea la ruta, W4-D la reescribe para montar el lienzo y ejecutar el banco | W3-W4 | — |
| `frontend/app/pages/texture-lab.vue` | W3-D | W3 | W3 |
| `frontend/app/layouts/` | W3-C | W3 | W3 |
| `frontend/app/middleware/` | W3-C | W3 | W3 |
| `frontend/app/components/shell/` y su `__tests__/` | W3-C | W3 | W3 |
| `frontend/app/components/ui/` | W3-C; W5-W ajusta la firma de `UiButton.reason` | W3-W5 | — |
| `frontend/app/components/panels/registry.ts` | W3-C; W5-W cambia la superficie de `building-placement` a `SIDE` | W3-W5 | — |
| `frontend/app/components/panels/__tests__/registry.test.ts` | W3-C; la ventana de integracion previa a W5 sustituye la lista literal de andamiajes por la deteccion de `UiPendingPanel`, y la intermedia de W6 aplica el tiempo de espera propio | W3-W6 | — |
| `frontend/app/components/panels/{cell-inspector,land-purchase,field-list,field-inspector,field-create,field-edit,legend,minimap,notices,settings}/` | W4-E | W4 | — |
| `frontend/app/components/panels/{farm-overview,building-placement,building-inspector}/` | W4-F | W4 | — |
| `frontend/app/components/panels/{machinery,workers,labor-pool,market,starting-guide}/` | W5-F | W5 | — |
| `frontend/app/components/panels/{task-assign,task-list,forestry,forest-plot,welcome-back}/`, codigo | W6-D; W6-T corrige cinco defectos destapados por sus pruebas | W6 | — |
| `frontend/app/components/panels/{task-assign,task-list,forestry,forest-plot,welcome-back}/__tests__/` | W6-T | W6 | — |
| `frontend/app/components/panels/shared/` | W6-D | W6 | — |
| `frontend/app/components/panels/shared/__tests__/` | W6-T | W6 | — |
| `frontend/app/stores/` | W3-C crea todos los stores con su forma final; W6-W anade al reductor y a cinco almacenes lo que W6 necesita | W3-W6 | — |
| `frontend/app/stores/__tests__/` | W6-W | W6 | — |
| `frontend/app/composables/` y su `__tests__/` | W3-C; W5-W anade `settings:changed` al puente y reescribe el arbitraje de entrada; W6-W anade el sujeto de un modo a `SelectionMode` | W3-W6 | — |
| `frontend/app/net/` y su `__tests__/` | W3-C | W3 | W3 |
| `frontend/app/mock/` | W3-C; W5-W corrige las cuatro diferencias con el servidor real | W3-W5 | — |
| `frontend/app/assets/tokens.css`, bloque entre `fw-palette:start` y `fw-palette:end` | W1 crea el andamiaje, W3-D lo genera | W1-W3 | W3, generado |
| `frontend/app/assets/tokens.css`, resto del fichero | W3-C | W3 | W3 |
| `frontend/app/assets/shell.css` | W3-C | W3 | W3 |
| `frontend/app/game/index.ts` | W3-D | W3 | W3 |
| `frontend/app/game/boot/` | W3-D | W3 | — |
| `frontend/app/game/textures/` y su `__tests__/` | W3-D | W3 | — |
| `frontend/app/game/world/` y su `__tests__/` | W4-D; W5-W anade los interruptores de rejilla, contornos, umbral de nivel de detalle y sensibilidad de zoom | W4-W5 | — |
| `frontend/app/game/overlay/` y su `__tests__/` | W4-D | W4 | — |
| `frontend/app/game/selection/` y su `__tests__/` | W4-G | W4 | — |
| `frontend/app/game/entities/` | W5-D | W5 | — |
| `frontend/app/__tests__/` | W1 crea un test de andamiaje, W3-C lo sustituye por el del servidor simulado, W5-W ajusta tres afirmaciones al corregir el simulado | W1-W5 | — |
| `frontend/app/shared/` | generado por `scripts/sync-shared-types.sh` (`make sync-types`) | — | no editable |
| `frontend/.nuxt/` | generado por `nuxt prepare`, que invoca `make typecheck` | — | no editable |

El reparto de los tres grupos de paneles se cierra en W3-C al escribir el registro: cada panel existe
como stub en su propio directorio, con su nombre, sus props y su lugar en el indice desde esa fase. El
registro declara ademas el agente responsable de cada panel en el campo `owner`, de modo que el reparto
es dato y no un parrafo.

Con una salvedad que esta tabla resuelve y el registro no puede, por estar congelado: en cinco entradas
el campo `owner` no describe a quien escribio el panel. Los briefs de la segunda tanda de W4 repartieron
`notices` y `settings` —que el registro atribuye a W6-D y a W5-F— al agente de paneles de mundo y campos,
y no incluyeron los tres paneles de granja que el registro atribuye a W4-E, que escribio W4-F. Las filas
anteriores recogen el reparto real, que es el que vale; el registro conserva el declarado. Consecuencia
para las fases siguientes: `settings` sale del lote de W5-F y `notices` del de W6-D, y cada uno de esos
lotes queda en cinco paneles. Apartado 4.6 y `docs/erratas-gdd-stack.md`, apartado 5, fila 26.

Estado de los veintitres paneles al cierre de W6: los veintitres con contenido real y ninguno en
andamiaje. `UiPendingPanel` no lo monta ya ningun panel, comprobado con `grep` sobre
`frontend/app/components/panels/`, de modo que las dos afirmaciones de andamiaje de
`frontend/app/components/panels/__tests__/registry.test.ts` se aplican hoy al conjunto vacio y la suite
sigue siendo util por lo demas que afirma: los veintitres se montan, todos rinden texto y ninguno emite
un error de consola. Esa suite tiene ademas resuelto su tiempo de espera, que la ventana de integracion
intermedia de W6 fijo en 30 segundos para las dos pruebas que montan el conjunto completo; la fila 42 del
apartado 5 de `docs/erratas-gdd-stack.md` queda cerrada en la fila 53 de ese mismo apartado.

Las piezas que varios paneles comparten viven en el directorio del panel de su materia salvo las tres que
W6-D situo en `components/panels/shared/`, que es el directorio con fila propia que ADR-0037 dejaba
previsto para el caso en que una pieza no pertenezca a la materia de ningun panel:
`shared/assignment.ts`, que reproduce la secuencia de §104 para tres paneles, `shared/taskProgress.ts`,
que es la cuenta atras con el reloj como parametro, y `shared/forestPresentation.ts`, que traduce las
cuatro fases de §131 y el volumen de §133. Las demas siguen donde estaban:
`legend/vocabulary.ts`, `legend/units.ts`,
`legend/shortcuts.ts`, `cell-inspector/worldAccess.ts`, `cell-inspector/__tests__/harness.ts`,
`field-list/ordering.ts`, `minimap/compose.ts`, `settings/preferences.ts`,
`building-placement/placementPlan.ts`, `farm-overview/buildingPresentation.ts` y, desde W5,
`machinery/machineryPresentation.ts`, `workers/workerPresentation.ts`, `labor-pool/hiring.ts`,
`market/sale.ts` y `starting-guide/steps.ts`, mas `task-assign/request.ts` y `welcome-back/summary.ts`
de esta fase. La decision y su coste estan en ADR-0037, cuya prevision —"si W5 o W6 necesitan mas piezas
comunes, lo que procede es crear `components/panels/shared/` con fila propia y un unico agente
responsable"— se cumplio en W6 y esta ya recogida en las dos filas de la tabla anterior.

Convencion de pruebas del cliente: un `__tests__/` por subdirectorio, igual que en `shared/`, y no un
unico `frontend/app/__tests__/`. Es lo que permite que dos agentes de la misma fase escriban pruebas sin
compartir directorio. `frontend/vitest.config.ts` incluye `app/**/__tests__/**/*.test.ts`, de modo que el
patron no exige ningun cambio de configuracion.

Las dos rutas que W5 y W6 deben tener presentes para no repetir el solape del apartado 4.4:
`frontend/app/pages/` tiene tres propietarios por fichero y no por directorio, y `assets/tokens.css` tiene
dos propietarios por bloque. En ambos casos la unidad de propiedad es mas fina que el directorio, y quien
escriba tiene que respetarla fichero a fichero. La costura funciono en W4: W4-D reescribio `perf.vue`
entero sin tocar ninguna de las otras tres paginas.

### 3.7 tools/

| Ruta | Propietario | Fase | Congelado tras |
|---|---|---|---|
| `tools/balance/` | W5-C | W5 | — |

La calculadora importa las mismas constantes que el juego desde `shared/config/` y emite el informe en
`docs/balance/`. W7-E corrigio en ella los cuatro defectos que la revision de formulas encontro, y W7-F
regenero el informe al cierre y comprobo que dos ejecuciones producen ficheros identicos. La fila decia
W6-E, que es a quien el plan atribuia la calculadora; la escribio el agente de economia de W5 porque es
quien tiene las reglas de coste y porque ADR-0039 necesitaba cifras medidas y no supuestas. El apartado
4.7 lo explica. Son siete ficheros: `index.ts`, `scenarios.ts`, `weeds.ts`, `deviations.ts`, `report.ts`,
`format.ts` y su `tsconfig.json`, este ultimo necesario porque `make balance` compila la herramienta
aparte de los tres proyectos npm.

---

## 4. Correspondencia con el arbol real

El arbol de la seccion 4 del plan esta cubierto por completo en la tabla anterior, y toda ruta existente
en el arbol real esta atribuida. Comprobado al primer cierre de W4 con `git ls-files` y
`git status --porcelain --untracked-files=all`: 329 rutas versionadas y 74 sin confirmar, 403 en total,
todas ellas con una fila en el apartado 3. Comprobado al segundo cierre con `find`: 432 ficheros, que son
los mismos 403 mas los 29 que aquella cabecera detallaba. Comprobado al cierre de W5, tambien con `find`:
502 ficheros, que son aquellos 432 mas la nota de traspaso del propio cierre de W4, mas los 68 de W5 que
el apartado 4.7 reparte, mas la nota de aquel cierre. Comprobado al cierre de W6, con el mismo
procedimiento: 548 ficheros, que son aquellos 502 mas los 46 que el apartado 4.8 reparte —16 de modulo,
11 de prueba de backend, 13 de la capa de paneles, 1 de prueba de almacen y las 5 notas de traspaso de la
fase—. La nota de traspaso de este cierre, `NOTES-w6-cierre.md`, es el fichero 549 y se escribe despues
del recuento; es el mismo desfase que los dos cierres de W4 y el de W5 observaron con las suyas.

Reparto de las 74 rutas sin confirmar en el primer cierre, que son las que W3 y W4 anadieron:
`docs/handoff/NOTES-w3-cierre.md` (1, de W3-E); `backend/src/modules/land/` y
`backend/src/__tests__/land/` (5, de W4-A); `backend/src/modules/farms/` y `backend/src/__tests__/farms/`
(7, de W4-B); `backend/src/modules/fields/` y `backend/src/__tests__/fields/` (6, de W4-C);
`frontend/app/game/world/` (23) y `frontend/app/game/overlay/` (5), de W4-D;
`frontend/app/game/selection/` (22, de W4-G); y las cinco notas de traspaso de la fase.

Reparto de los 27 ficheros nuevos del segundo cierre, sin contar `.env` ni `NOTES-w4-cierre.md`, que ya
existian: 18 dentro de los diez directorios de panel de W4-E, 7 dentro de los tres de W4-F, y las dos
notas de traspaso. Los trece `.vue` de panel no son ficheros nuevos: sustituyen en su sitio al stub que
W3-C dejo, que es lo que la regla 3 pide.

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

Las dos exclusiones que las filas de `shared/api/README.md` y de `backend/src/generated/prisma/` dejaban
pendientes las aplico la ventana de parcheo W2.5 en `.gitignore` y en `.prettierignore`. `make lint`
devuelve hoy 0.

### 4.3 Diferencias introducidas en W2.5

| Ruta | Situacion |
|---|---|
| `backend/prisma/migrations/20260811215755_ledger_type_starting_capital/` | Segunda migracion, que anade `STARTING_CAPITAL` al enumerado de tipos de asiento. No necesita fila propia: el apartado 3.5 ya prevee que cada fase anada las suyas. |
| `.env` de la maquina de desarrollo | No versionado. Lleva `SEED_DEV_PLAYER=true` y `SHADOW_DATABASE_URL`, de modo que la base contiene el jugador `dev@farm-world.local`. Los puertos publicados no son los canonicos: PostgreSQL en 55432 y Redis en 56379. |

### 4.4 Diferencias introducidas en W3

| Ruta | Situacion |
|---|---|
| `backend/src/handlers.ts` | Adicion de W3-A. El unico fichero que conoce los once modulos: conecta el registro de manejadores de evento agendado y el de trabajos de la cola con el modulo que posee cada uno. Existe para que ni `lib/queue.ts` ni `lib/advancePlayer.ts` importen un modulo, que las zonas de ESLint prohiben. |
| `backend/src/plugins/routes.ts`, `backend/src/plugins/systemRoutes.ts` | Adiciones de W3-A. La primera es `defineRoute` y `defineStubRoute` con las cuatro guardas derivadas de las banderas del contrato; la segunda es el area `system`, que no es un modulo de dominio: `/health` y `/metrics` son propiedades del proceso y las cuatro rutas de desarrollo manejan directamente las piezas de `lib`. |
| `backend/src/modules/<modulo>/jobs.ts` | Andamiajes de W3-A en los cinco modulos que poseen un manejador de evento agendado: `fields`, `machinery`, `workers`, `tasks` y `forestry`. |
| `backend/src/modules/player/` | No existe y no se creara. El brief de W3-A lo pedia junto a una ruta `GET /api/player/state` que el contrato no declara; el modelo de lectura compartido por siete modulos vive en `lib/playerView.ts`. Apartado 5.3 de `docs/erratas-gdd-stack.md`. |
| `frontend/app/components/panels/registry.ts` | El plan y la tabla de W2 lo llamaban `index.ts`. El nombre real es `registry.ts`, que es como lo nombra tres veces el brief de W3-C. |
| `frontend/app/mock/` | El brief de W3-C lo situaba en `frontend/mock/`. Fuera de `srcDir` no lo cubre ningun proyecto de TypeScript de los que genera Nuxt, de modo que `vue-tsc` no lo comprobaria y el patron de inclusion de `vitest.config.ts` no recogeria sus pruebas. La ruta real coincide ademas con el arbol de la seccion 4 del plan. |
| `frontend/app/middleware/`, `frontend/app/components/shell/`, `frontend/app/components/ui/` | Adiciones de W3-C. El plan preveia la rejilla y el arbitraje de entrada sin decir donde viven; el shell y los primitivos de interfaz no son paneles y no pueden estar en el registro. |
| `frontend/app/assets/shell.css` | Adicion de W3-C. Se importa desde `app/app.vue` y no desde `nuxt.config.ts`, que esta congelado y solo lista `tokens.css`. |
| `frontend/app/pages/game.vue`, `login.vue`, `perf.vue` | Adiciones de W3-C. `perf.vue` es la ruta de medicion a la que `make perf-lab` ya apuntaba; los numeros los publica W4-D por el puente, la ruta es de W3-C. |
| `frontend/app/game/index.ts`, `frontend/app/pages/texture-lab.vue` | Adiciones de W3-D, que la tabla de W2 no atribuia. La segunda es la ruta de inspeccion de texturas que su brief pide. |
| `backend/src/__tests__/world/`, `frontend/app/game/textures/__tests__/`, `frontend/app/net/__tests__/`, `frontend/app/composables/__tests__/`, `frontend/app/components/{panels,shell}/__tests__/` | Directorios de prueba por subdirectorio, siguiendo el patron que ya usaba `shared/`. La fila de W2 decia `frontend/app/__tests__/` para todo el cliente, que habria obligado a dos agentes de la misma fase a compartir directorio. |
| `docs/handoff/NOTES-w3b.md` | No existe. El agente del modulo de mundo termino antes de la parada de la fase y no lo escribio, aunque su codigo lo cita en cinco puntos (`generator.ts`, `service.ts`, `spawn.ts` y `cellRepo.ts`). Sus decisiones estan documentadas en ADR-0021, redactado leyendo el codigo, y sus dos pendientes en `docs/handoff/NOTES-w3-cierre.md`. |

Infraccion de propiedad registrada en la fase W3, que W4 no repitio. `frontend/app/pages/` estaba
atribuido por completo a W3-C y W3-D escribio dentro, `pages/texture-lab.vue`. No hubo perdida de trabajo,
porque los ficheros son distintos y ninguno de los dos reescribio el del otro, pero contradice la regla 1
y solo no costo nada por suerte. La tabla del apartado 3.6 se ha ajustado en consecuencia: `pages/` ya no
figura como un unico bloque, sino con una fila por propietario, de modo que un agente de W4 que lea la
tabla sepa que ese directorio tiene la propiedad definida fichero a fichero. El mismo criterio se aplica a
`assets/tokens.css`, cuya propiedad es por bloque delimitado con marcadores; ahi la costura si estaba
disenada de antemano y funciono, con W3-D regenerando su bloque sin tocar el de W3-C, protegida ademas por
una prueba que compara el fichero con la salida del generador.

### 4.5 Diferencias introducidas en la primera tanda de W4

| Ruta | Situacion |
|---|---|
| `eslint.config.js` | Modificado fuera de fase, entre el cierre de W3 y el arranque de W4, por una ventana de parcheo que no dejo fichero de traspaso. Aplica el apartado 2 de `NOTES-w3-cierre.md`: las zonas pasan de prohibir toda importacion entre modulos hermanos a agruparlos por flujo de trabajo (`BACKEND_MODULE_PHASES`), de modo que un modulo puede importar los de fases anteriores y nunca los de la suya. Es lo que permite que `land`, `farms` y `fields` consuman `modules/world/service.ts`. Fichero congelado desde W1; la modificacion es legitima porque solo el agente de integracion tiene mandato sobre el, pero la ausencia de nota deja el cambio sin registro propio. Marcas de tiempo: 09:32, frente a las 10:05 del primer fichero de modulo de W4 |
| `backend/src/__tests__/app.int.test.ts` | Modificado por la misma ventana y a la misma hora, aplicando el apartado 1 de `NOTES-w3-cierre.md`: anade las dos rutas del area `world` a `IMPLEMENTED` y baja el recuento de andamiajes de 42 a 40. No cubre las doce rutas que W4 implemento, de modo que la prueba vuelve a estar en rojo por el mismo motivo. Sigue siendo de W3-A |
| `backend/src/modules/{land,farms,fields}/` | Contenido real, sustituyendo el andamiaje de W3-A. Ninguno toco `src/app.ts` ni `src/handlers.ts`: sustituir un andamiaje es cambiar `defineStubRoute` por `defineRoute` dentro del propio modulo, y la regla 3 se cumplio en los tres casos |
| `backend/src/modules/fields/jobs.ts` | Primer manejador real de evento agendado, `FIELD_ADVANCE_PHASE`, sustituyendo el andamiaje de W3-A en su sitio. Quedan cuatro andamiajes: `machinery`, `workers`, `tasks` y `forestry` |
| `backend/src/__tests__/{land,farms,fields}/` | Pruebas por modulo en su subdirectorio, conforme al apartado 3.5. `farms/terrain.ts` y `land/fixtures.ts` son auxiliares y no suites |
| `frontend/app/game/overlay/` | Escrito por W4-D y no por W5-D, que es a quien lo atribuia la tabla. El brief de W4-D lo asigna de forma explicita, y el motivo es real: el contador de depuracion y el anclaje invariante al zoom son requisitos de esta fase. W5-D extiende la escena con `addLabel` y `addProgress` y no reescribe nada. La fila del apartado 3.6 pasa a tener dos propietarios por fase |
| `frontend/app/game/selection/` | Escrito por W4-G y no por W5-E. El brief de W4-G lo asigna de forma explicita. La fila del apartado 3.6 pasa a W4-G, y con ella se adelanta la entrada de ADR sobre reglas de validacion compartidas |
| `frontend/app/pages/perf.vue` | Reescrito por W4-D, que la tabla atribuia a W3-C. Es coherente con lo que la propia tabla ya decia de esa ruta ("los numeros los publica W4-D por el puente") y no hubo solape: W4-D reescribio el fichero entero y no toco las otras tres paginas. La fila se ha separado |
| `frontend/app/components/panels/` (primer grupo) | Sin escribir en la primera tanda: los once paneles seguian siendo el stub que W3-C creo con el registro, porque los dos agentes previstos no entregaron nada ni dejaron traspaso. Superado por el apartado 4.6, donde la segunda tanda los escribe |
| `docs/handoff/NOTES-w4{a,b,c,d,g}.md` | Un fichero por agente, sin colision. `NOTES-w4e.md` y `NOTES-w4f.md` no existian tras esta tanda, por el mismo motivo por el que no existia el trabajo; los escribio la segunda |

Comprobacion de escritor unico, que es la que la regla 1 exige. Cruzando `git status --porcelain
--untracked-files=all` con el ambito declarado en cada nota de traspaso y con las marcas de tiempo del
sistema de ficheros, ningun fichero de esta fase tuvo dos escritores. Los tres candidatos posibles se
resolvieron asi:

1. `backend/src/__tests__/app.int.test.ts` es el punto de encuentro de los tres agentes de backend y los
   tres se abstuvieron deliberadamente de tocarlo, cada uno dejando el cambio exacto en su nota. Es el
   comportamiento correcto: editarlo a la vez habria hecho que el ultimo en escribir borrase a los otros
   dos, que es la perdida de trabajo que la regla 1 evita. El precio es que la prueba queda en rojo hasta
   que alguien aplique las tres notas de una vez.
2. `frontend/app/game/` lo escribieron W4-D y W4-G en directorios disjuntos (`world/` y `overlay/` frente a
   `selection/`), sin ningun fichero comun. W4-G ejercito su codigo sobre la ruta de W4-D adjuntandose a la
   escena viva desde el protocolo de depuracion, en lugar de escribir en `pages/`, que no es suyo.
3. `eslint.config.js` y `app.int.test.ts` los modifico la ventana de parcheo previa a la fase, no un agente
   de W4, segun las marcas de tiempo y segun lo que las cinco notas declaran no haber tocado.

### 4.6 Diferencias introducidas por la segunda tanda de W4

| Ruta | Situacion |
|---|---|
| `frontend/app/components/panels/{cell-inspector,land-purchase,field-list,field-inspector,field-create,field-edit,legend,minimap,notices,settings}/` | Contenido real de W4-E, sustituyendo el stub de W3-C en su sitio. Cada directorio anade ademas sus pruebas y, cuando procede, su pieza compartida. `registry.ts` no se toco, que es lo que la regla 3 pide |
| `frontend/app/components/panels/{farm-overview,building-placement,building-inspector}/` | Contenido real de W4-F, con el mismo criterio. `building-placement/placementPlan.ts` es el espejo declarado de `backend/src/modules/farms/placement.ts` (ADR-0033) |
| `notices` y `settings` | Escritos por W4-E aunque el registro los atribuye a W6-D y a W5-F. Se siguio el brief, que es la instruccion directa; el apartado 3.6 recoge el reparto real y la fila 26 del apartado 5 de las erratas, la discrepancia |
| `farm-overview`, `building-placement`, `building-inspector` | Escritos por W4-F aunque el registro los atribuye a W4-E. Mismo criterio |
| Piezas compartidas entre paneles | Diez ficheros que no son componentes viven en el directorio del panel de su materia, por no existir ningun directorio superior atribuido a estos agentes. Enumerados en el apartado 3.6 y justificados en ADR-0037 |
| `backend/src/plugins/routes.ts`, `backend/src/__tests__/app.int.test.ts` | Modificados por la ventana de integracion posterior al primer cierre de W4, no por un agente de paneles: marcas de tiempo 13:02 y 13:04, frente a las 13:13 del primer fichero de la segunda tanda. Aplican el punto 1 de `NOTES-w4-cierre.md` sustituyendo la lista literal de rutas implementadas por `stubRouteKeys()`, derivada del propio registro. Los dos siguen siendo de W3-A. ADR-0038 |
| `frontend/app/components/panels/__tests__/registry.test.ts` | Sin tocar, y en rojo. Es de W3-C y es el punto de encuentro de los agentes de paneles de W4, W5 y W6, de modo que los dos de esta tanda se abstuvieron por el mismo motivo por el que los tres agentes de backend se abstuvieron de `app.int.test.ts` |
| `docs/handoff/NOTES-w4e.md`, `docs/handoff/NOTES-w4f.md` | Las dos notas que la primera tanda no dejo, una por agente y sin colision |

Comprobacion de escritor unico, que es la que la regla 1 exige. Cruzando las marcas de tiempo del sistema
de ficheros con el ambito declarado en cada nota de traspaso, ningun fichero de esta tanda tuvo dos
escritores: W4-F escribio entre las 13:13 y las 13:29 en tres directorios, W4-E entre las 13:32 y las
13:46 en diez, y los trece conjuntos son disjuntos. El unico fichero que los dos agentes necesitaban y
ninguno podia escribir es `registry.test.ts`, y ninguno lo escribio. Los dos ficheros del backend que
cambiaron ese mismo dia lo hicieron antes de que empezara la tanda y por mano de la ventana de
integracion.

### 4.7 Diferencias introducidas en W5

| Ruta | Situacion |
|---|---|
| `backend/src/modules/{machinery,workers,economy}/` | Contenido real, sustituyendo el andamiaje de W3-A. Ninguno toco `src/app.ts` ni `src/handlers.ts`: sustituir un andamiaje es cambiar `defineStubRoute` por `defineRoute` dentro del propio modulo, y la regla 3 se cumplio en los tres casos. Catorce ficheros nuevos: cuatro en `machinery` (`record.ts`, `readModel.ts`, `service.ts`, `routes.ts`), tres en `workers` (`pool.ts`, `service.ts`, `routes.ts`) y siete en `economy` (`market.ts`, `readModel.ts`, `ledger.ts`, `debt.ts`, `liquidation.ts`, `routes.ts`, `jobs.ts`) |
| `backend/src/modules/{machinery,workers}/jobs.ts` | Manejadores reales de `MACHINE_REPAIR_COMPLETE` y `WORKER_POOL_REFRESH`, sustituyendo el andamiaje de W3-A en su sitio. De los seis tipos de `ScheduledEventKind` quedan dos con manejador de andamiaje: `TASK_COMPLETE` (W6-A) y `FOREST_NOTIFY_MILESTONE` (W6-C) |
| `backend/src/modules/economy/jobs.ts` | Fichero nuevo, no previsto por W3-A: `economy` no era uno de los cinco modulos con evento agendado propio. No introduce un tipo nuevo, sino que extiende el barrido de liquidacion de `lib/jobs.ts` por el enganche `registerSettleSweepHook`, que es lo que evita que `lib/` importe un modulo de dominio |
| `backend/src/__tests__/{machinery,workers,economy}/` | Doce ficheros, pruebas por modulo en su subdirectorio conforme al apartado 3.5. `fixtures.ts` de los tres son auxiliares y no suites. `workers/pool.test.ts` es unitaria y no de integracion, y no entra en ninguna puerta mientras `make test-unit` no recorra el backend |
| `tools/balance/` | Siete ficheros escritos por W5-C, que la tabla atribuia a W6-E. El apartado 3.7 recoge el motivo. Lleva `tsconfig.json` propio porque `make balance` la compila aparte de los tres proyectos npm |
| `docs/balance/` | Dos ficheros generados, `informe-balance.md` y `kpis.json`. Nadie los edita a mano: la orden que los produce es `make balance` y el resultado es identico byte a byte entre ejecuciones, comprobado con `diff` en este cierre |
| `frontend/app/game/entities/` | Diecisiete ficheros de W5-D, la unica fila que esta fase estrena en el cliente sin compartirla con nadie. `frontend/app/game/overlay/` no se toco, aunque la tabla preveia que W5-D anadiera ahi los rotulos de entidad: la capa los dibuja por su cuenta y la fila del apartado 3.6 se ha corregido |
| `frontend/app/components/panels/{machinery,workers,labor-pool,market,starting-guide}/` | Contenido real de W5-F, sustituyendo el stub de W3-C en su sitio. Diez ficheros nuevos, dos por panel: la pieza compartida de su materia y su suite. `registry.ts` no lo toco este agente |
| `frontend/app/pages/game.vue`, `composables/`, `mock/`, `game/world/`, `components/panels/registry.ts`, `components/ui/UiButton.vue`, `app/__tests__/mock-server.test.ts` | Reescritos o modificados por W5-W, el agente de costura, que es el unico de la fase con mandato sobre ficheros que W3-C y W4-D dejaron congelados. Ningun fichero nuevo: son diez modificaciones en su sitio, todas aplicando notas de traspaso de W4 |
| `frontend/app/components/panels/__tests__/registry.test.ts` | Modificado por la ventana de integracion previa a la fase, no por un agente de W5: marca de tiempo 14:11, frente a las 14:23 del primer fichero de la fase. Aplica el parche de `NOTES-w4e.md` 1.1, que es la version de cliente de ADR-0038. Sigue siendo de W3-C |
| `docs/handoff/NOTES-w5{a,b,c,d,f,w}.md` | Un fichero por agente, sin colision. No existe `NOTES-w5e.md` porque no hubo agente W5-E |

Comprobacion de escritor unico, que es la que la regla 1 exige. Cruzando las marcas de tiempo del sistema
de ficheros con el ambito declarado en cada nota de traspaso, ningun fichero de esta fase tuvo dos
escritores. Los cinco candidatos posibles se resolvieron asi:

1. Los tres agentes de backend escribieron entre las 14:23 y las 15:08 en seis directorios disjuntos, tres
   de modulo y tres de prueba. El unico punto de encuentro posible,
   `backend/src/__tests__/idempotency.int.test.ts`, no lo toco ninguno de los tres, y los tres lo
   declararon en su nota: es el mismo comportamiento correcto que W4 tuvo con `app.int.test.ts` y por la
   misma razon. El precio es que `make test-int` queda con una prueba en rojo.
2. `frontend/app/components/panels/registry.ts` es el punto de encuentro de W5-F y W5-W, y sus ventanas de
   escritura se solapan: W5-W lo modifico a las 15:17 y W5-F escribio sus quince ficheros entre las 15:19
   y las 15:43. No hubo perdida de trabajo porque el reparto era explicito —el registro es del agente de
   costura en esta fase y W5-F declara no haberlo tocado— y porque los conjuntos de ficheros son
   disjuntos. Es el caso que mas cerca estuvo de un solape real de toda la fase.
3. `frontend/app/game/` lo escribieron W5-D y W5-W en directorios disjuntos, `entities/` frente a
   `world/`, con ventanas contiguas: W5-W entre las 15:14 y las 15:16, W5-D entre las 15:16 y las 16:00.
   Ningun fichero comun.
4. `frontend/app/__tests__/mock-server.test.ts` lo modifico W5-W, que declara en su nota que esta fuera de
   su ambito declarado y por que: tres afirmaciones de esa suite fijaban el comportamiento del servidor
   simulado que su propio brief le mandaba corregir. Su propietario original, W3-C, esta cerrado, de modo
   que no habia un segundo escritor posible.
5. `docs/balance/` lo escribio W5-C y lo ha regenerado este cierre al ejecutar `make balance`. No es una
   segunda escritura: es una ruta generada, declarada como tal en el apartado 3.3, y la regeneracion
   produjo los mismos bytes, que es precisamente la propiedad que ADR-0044 exige.

### 4.8 Diferencias introducidas en W6

| Ruta | Situacion |
|---|---|
| `backend/src/modules/{tasks,session,forestry}/` | Contenido real, sustituyendo el andamiaje de W3-A. Ninguno de los tres toco `src/app.ts` ni `src/handlers.ts`: sustituir un andamiaje es cambiar `defineStubRoute` por `defineRoute` dentro del propio modulo, y la regla 3 se cumplio en los tres casos. Dieciseis ficheros nuevos: cuatro en `tasks` (`record.ts`, `assignment.ts`, `service.ts`, `routes.ts`), seis en `session` (`snapshot.ts`, `replay.ts`, `welcomeBack.ts`, `cache.ts`, `readModel.ts`, `routes.ts`) y seis en `forestry` (`generator.ts`, `record.ts`, `readModel.ts`, `service.ts`, `tasks.ts`, `routes.ts`) |
| `backend/src/modules/{tasks,forestry}/jobs.ts` | Manejadores reales de `TASK_COMPLETE` y de `FOREST_NOTIFY_MILESTONE`, sustituyendo el andamiaje de W3-A en su sitio. Con ellos los seis tipos de `ScheduledEventKind` tienen manejador y no queda ninguno de andamiaje. `modules/forestry/jobs.ts` registra ademas la contribucion forestal a `TASK_COMPLETE`, con el mismo patron de enganche que `modules/economy/jobs.ts` estreno en W5 |
| `backend/src/__tests__/{tasks,session,forestry}/` | Once ficheros, pruebas por modulo en su subdirectorio conforme al apartado 3.5. Los tres `fixtures.ts` son auxiliares y no suites. `forestry/generator.test.ts` es unitaria y no de integracion, y no entra en ninguna puerta mientras `make test-unit` no recorra el backend: son quince pruebas mas sobre las 67 que ya estaban fuera |
| `frontend/app/components/panels/shared/` | Directorio nuevo con tres modulos de W6-D y tres suites de W6-T. Es la fila que ADR-0037 dejaba prevista, y hasta este cierre ninguna tabla la declaraba, que es lo que `NOTES-w6t.md` 1.3 reclamaba |
| `frontend/app/components/panels/{task-assign,task-list,forestry,forest-plot,welcome-back}/` | Contenido real de W6-D, sustituyendo el stub de W3-C en su sitio. Cinco `.vue` que no son ficheros nuevos, mas `task-assign/request.ts` y `welcome-back/summary.ts`, mas cinco suites de W6-T. `registry.ts` no lo toco nadie |
| `frontend/app/stores/__tests__/` | Directorio nuevo con una suite, `sync.test.ts`, de W6-W. Es el primer `__tests__/` de los almacenes: hasta W5 el reductor solo se ejercitaba de forma indirecta desde las suites de panel |
| `frontend/app/{pages/game.vue,composables/useGameBridge.ts,stores/*.ts}` | Modificados en su sitio por W6-W, el agente de costura, que es el unico de la fase con mandato sobre ficheros congelados de fases anteriores. Ningun fichero nuevo salvo el `__tests__/` de la fila anterior |
| `backend/src/__tests__/idempotency.int.test.ts` | Modificado por la ventana de integracion previa a la fase, no por un agente de W6: marca de tiempo 16:43 del 12 de agosto, frente a las 16:55 del primer fichero de modulo de la fase. Cierra el unico rojo que `make test-int` arrastraba desde W5. Sigue siendo de W3-A. Fila 52 del apartado 5 de las erratas |
| `frontend/app/components/panels/__tests__/registry.test.ts` | Modificado por la ventana de integracion intermedia de la fase, entre los agentes de backend y el de paneles: marca de tiempo 17:55 del 12 de agosto, frente a las 17:47 del primer fichero de `panels/shared/` y las 09:57 del dia siguiente del primer `.vue`. Aplica el tiempo de espera propio de las dos pruebas que montan los veintitres paneles. Sigue siendo de W3-C. Fila 53 del apartado 5 de las erratas |
| `docs/handoff/NOTES-w6{a,b,c,w,t}.md` | Un fichero por agente, sin colision. No existe `NOTES-w6d.md`, porque el agente de paneles termino con la parada de la fase |

Comprobacion de escritor unico, que es la que la regla 1 exige. Cruzando las marcas de tiempo del sistema
de ficheros con el ambito declarado en cada nota de traspaso, ningun fichero de esta fase tuvo dos
escritores. Los cuatro candidatos posibles se resolvieron asi:

1. Los tres agentes de backend escribieron entre las 16:55 y las 17:28 del 12 de agosto en seis
   directorios disjuntos, tres de modulo y tres de prueba. Sus tres notas declaran ademas no haber tocado
   `src/app.ts`, `src/handlers.ts`, el registro de rutas, `lib/`, `shared/` ni `schema.prisma`, y las
   marcas de tiempo lo confirman: ninguno de esos ficheros cambio durante la fase.
2. `frontend/app/components/panels/{task-assign,task-list,forestry,forest-plot,welcome-back,shared}/` es
   el unico punto donde dos agentes de la fase escribieron el mismo fichero, y no a la vez: W6-D escribio
   entre las 17:47 del 12 de agosto y las 09:57 del 13, y W6-T corrigio cinco defectos dentro de ese
   codigo entre las 10:06 y las 10:23 del 13, con W6-D ya cerrado por la parada. Es el caso que el brief
   de W6-T autorizaba explicitamente, cada correccion esta destapada por una prueba y las cinco estan
   detalladas en `NOTES-w6t.md` apartado 2. No hubo trabajo perdido porque no hubo concurrencia.
3. `frontend/app/stores/` es el punto de encuentro de W6-W con el codigo de los paneles, y no hubo
   solape: W6-W escribio los cinco almacenes y el reductor entre las 17:50 del 12 y las 10:20 del 13, y
   ningun agente de panel escribe en un almacen, que es lo que ADR-0032 exige y lo que las suites de panel
   confirman al montar contra almacenes que ellas mismas preparan.
4. `frontend/app/components/panels/task-assign/TaskAssignPanel.vue` lo toco ademas el integrador al
   reanudar la fase, para renombrar una propiedad computada que colisionaba con una propiedad y quedaba
   oculta en la plantilla. No es un segundo escritor de fase: es la ventana de integracion, con W6-D ya
   cerrado, y esta registrada en la fila 67 del apartado 5 de las erratas.

Los cuatro ficheros que fases anteriores dejaron como punto de encuentro y que ningun agente de esta fase
podia tocar —`src/app.ts`, `src/handlers.ts`, `plugins/routes.ts` y `components/panels/registry.ts`—
siguen intactos. Es la tercera fase consecutiva en la que la regla 3 se sostiene sin excepciones, y es lo
que ha permitido que once modulos y veintitres paneles se escriban en seis tandas sin volver a abrir
ningun indice.

---

## 5. La ventana de correccion de W7-E

W7 se ejecuto con seis agentes: el integrador (W7-A), el recorrido de humo (W7-B), la revision
adversarial de formulas y balance (W7-C), la revision adversarial de reglas y alcance (W7-D), esta
ventana de correccion (W7-E) y el cierre (W7-F), que es el apartado 6. La correccion es la unica que
escribe en todo el arbol, y
puede hacerlo porque a esas alturas no hay ningun agente concurrente: la regla 1 protege del trabajo
perdido entre agentes simultaneos, y sin simultaneidad lo que queda es la disciplina de tocar lo
minimo. Los ficheros que W7-E abrio, y el motivo de cada uno:

| Ruta | Propietario original | Motivo |
|---|---|---|
| `shared/rules/machinery.ts`, `shared/rules/yield.ts` | W2-B | Los papeles de la tabla de §90 y la segmentacion por fase de las malezas son reglas puras y tenian que vivir donde el cliente y el servidor las leen |
| `shared/config/machines.ts` | W2-A | `HARVEST` reiniciaba las malezas, efecto que §89 atribuye solo al cultivador |
| `shared/api/errors.ts` | W2-C | Fijar por escrito el criterio de `expected` y `actual`, que dos rutas interpretaban al reves |
| `shared/config/__tests__/`, `shared/rules/__tests__/` | W2-A, W2-B | Pruebas de regresion de lo anterior |
| `backend/src/lib/gameClock.ts`, `backend/src/plugins/routes.ts`, `backend/src/plugins/config.ts`, `backend/src/server.ts`, `backend/src/worker.ts` | W3-A | El re-anclaje del reloj en el arranque y la fase de enganche de las dos guardas |
| `backend/src/modules/{forestry,tasks,land,fields}/` | W6-C, W6-A, W4-A, W4-C | Los cuatro defectos de dominio del apartado 6.1 de las erratas |
| `backend/src/__tests__/{app,land,tasks,fields,forestry}` y `backend/src/lib/__tests__/gameClock.int.test.ts` | sus agentes | Pruebas de regresion, cada una fallando antes del arreglo |
| `frontend/app/stores/fields.ts`, `frontend/app/components/panels/shared/assignment.ts` | W3-C, W6-D | Las dos mitades de cliente de las reglas compartidas que cambiaron |
| `frontend/app/stores/__tests__/fields.test.ts` | W6-W | Fichero nuevo: la prueba de la proyeccion local de un campo |
| `tools/balance/deviations.ts`, `tools/balance/report.ts` | W5-C | Los cuatro defectos del informe generado |
| `eslint.config.js`, `Makefile`, `.env.example` | W1 | `no-sequences`, el comentario del objetivo `verify` y la variable `GAME_RATE_APPLY_ON_BOOT` |
| `scripts/smoke/smoke.ts`, `scripts/smoke/env.ts` | W7-B | Tres afirmaciones del recorrido daban por buena una conducta que el GDD no admite, y el mundo acelerado necesita ahora autorizacion explicita |
| `docs/erratas-gdd-stack.md`, `docs/ownership.md` | los agentes de cierre | El registro de lo anterior |

El arbol crece en dos ficheros: `frontend/app/stores/__tests__/fields.test.ts` y
`docs/handoff/NOTES-w7e.md`. Ninguno de los cuatro puntos de encuentro que la fase anterior protegia
—`src/app.ts`, `src/handlers.ts`, `plugins/routes.ts` y `components/panels/registry.ts`— cambia de
contenido salvo `plugins/routes.ts`, cuya modificacion es la fase de enganche de dos guardas y no un
registro nuevo: el indice de rutas sigue intacto.

---

## 6. Cierre de W7 y cuadre final con el arbol real

W7 no tiene apartado propio en el 4 porque su ventana de correccion ya ocupa el apartado 5. Este
recoge el resto: el reparto real de los seis agentes de la fase, los ficheros que abrio la ventana de
integracion y el cuadre final del recuento con el arbol.

### 6.1 Reparto real de la fase

| Agente | Cometido | Escribe en |
|---|---|---|
| W7-A | Integracion: aplica el apartado «Pendiente» de las 34 notas anteriores | Ficheros congelados de todas las fases, `backend/src/lib/moduleSeams.ts`, `docs/handoff/INTEGRACION.md`, `README.md` |
| W7-B | Recorrido de humo del bucle completo por HTTP | `scripts/smoke/**`, objetivo `smoke` del `Makefile`, `docs/handoff/NOTES-w7b.md` |
| W7-C | Revision adversarial de formulas y balance frente al GDD | `docs/revision-formulas.md` |
| W7-D | Revision adversarial de reglas de validacion y alcance frente al MVP | `docs/revision-alcance.md` |
| W7-E | Correccion de los hallazgos confirmados, cada uno con su prueba | Todo el arbol, con la disciplina del apartado 5 |
| W7-F | Cierre: ADR, erratas, propiedad, informe de balance y `README.md` | `docs/adr.md`, `docs/erratas-gdd-stack.md`, `docs/ownership.md`, `docs/balance/`, `README.md` |

Las dos revisiones no escriben en el arbol fuera de su propio documento, que es lo que las hace
adversariales: refutan sin poder arreglar, y quien arregla es una ventana posterior con el criterio
escrito de ADR-0059. W7-F no escribe codigo y no deja nota de traspaso: sus cuatro documentos son el
traspaso.

### 6.2 Ficheros que W7-A abrio

| Ruta | Propietario original | Motivo |
|---|---|---|
| `backend/src/lib/moduleSeams.ts` | — | Fichero nuevo: el registro de estrategias con el que se cierran las dos costuras entre modulos hermanos sin relajar la zona de ESLint. ADR-0058 |
| `backend/src/handlers.ts` | W3-A | Unico fichero que nombra los dos extremos de cada costura, y punto de relleno que `server.ts` y `worker.ts` invocan por igual. Cierra las erratas 38 y 57 |
| `Makefile` | W1 | `test-unit` recorre ya el backend (errata 66) y `verify` encadena los ocho pasos del criterio de aceptacion |
| `docker-compose.yml`, `.env.example`, `frontend/nuxt.config.ts`, `.github/workflows/ci.yml` | W1 | El servicio `worker` a `unless-stopped`, `METRICS_PORT` declarada, el puerto del cliente leido del entorno (errata 10) y `CORS_ORIGIN` al puerto publicado |
| `shared/api/schemas/economy.ts`, `shared/api/schemas/state.ts`, `shared/api/routes.ts` | W2-C | Las tres ampliaciones aditivas del contrato: los filtros de `ledgerQuerySchema` (errata 37), el campo `detail` del resumen de liquidacion (errata 60) y `FARM_UPSERTED` en el `emits` de las dos rutas de tarea (errata 56) |
| `backend/src/modules/{forestry,world,session}/`, `backend/src/plugins/systemRoutes.ts` | W6-C, W3-B, W6-B, W3-A | `hasStandingTree` cuenta el arbol marcado (errata 59), el resumen publica `detail`, y `/health` deja de registrar un aviso por sonda |
| `frontend/app/mock/handlers.ts`, `frontend/app/components/panels/{building-inspector,cell-inspector}/` | W3-C, W4-F | `welcomeBackPending` derivado y `expectedTotal` aplicado en el simulado (erratas 45 y 63), etiquetas en castellano del inspector (errata 32) y el sujeto del modo de seleccion (errata 65) |
| `backend/src/__tests__/forestry/forestry.int.test.ts` | W6-C | La prueba de la cancelacion de una tala, que era el camino sin cobertura que `NOTES-w6c` reclamaba |
| `docs/handoff/**`, `README.md` | sus agentes | 105 items movidos del apartado «Pendiente» al apartado «Resuelto» de las 34 notas, conservando su numeracion original |

### 6.3 Cuadre con el arbol real

El recuento del cierre de W6 fue de 549 ficheros, con el mismo procedimiento de las fases anteriores:
`find` sobre el arbol, excluyendo `node_modules/`, `.git/`, `frontend/.nuxt/`, `backend/dist/`,
`backend/src/generated/`, las dos copias sincronizadas de `shared/` y los `*.tsbuildinfo`. El recuento
de este cierre es de 564, y los quince ficheros de diferencia son exactamente los que W7 anade:

| Ficheros | Agente |
|---|---|
| `scripts/smoke/` (8: `smoke.ts`, `env.ts`, `stack.ts`, `http.ts`, `ws.ts`, `site.ts`, `report.ts`, `tsconfig.json`) | W7-B |
| `backend/src/lib/moduleSeams.ts` (1) | W7-A |
| `docs/handoff/INTEGRACION.md`, `docs/handoff/NOTES-w7b.md`, `docs/handoff/NOTES-w7e.md` (3) | W7-A, W7-B, W7-E |
| `docs/revision-formulas.md`, `docs/revision-alcance.md` (2) | W7-C, W7-D |
| `frontend/app/stores/__tests__/fields.test.ts` (1) | W7-E |

549 mas 15 son 564, sin resto: toda ruta del arbol real tiene una fila en el apartado 3 o en una de las
tablas de diferencias de los apartados 4, 5 y 6, y ninguna aparece dos veces. El cierre no anade ningun
fichero, porque escribe dentro de los cuatro documentos que ya existen.

Estado de los cuatro puntos de encuentro que las fases protegen: `src/app.ts` y
`components/panels/registry.ts` siguen sin tocarse desde su fase de origen; `src/handlers.ts` lo abrio
W7-A para rellenar el registro de costuras, que es exactamente el uso para el que la regla 3 lo
reservaba; y `plugins/routes.ts` lo abrio W7-E para cambiar la fase de enganche de dos guardas. El
indice de rutas y el de paneles no se han vuelto a tocar desde que se escribieron.

Contenido de `shared/` al cierre, que es la unidad que mas agentes leen: 53 modulos de contrato y 24
ficheros de prueba en 23 suites. `scripts/sync-shared-types.sh` copia los 53 a cada destino y excluye
`__tests__/`, `package.json`, los `tsconfig` y el `README.md`, que se regenera en cada copia. La
correspondencia la comprueba `make check-sync`, que es prerrequisito de todo objetivo que dependa de
`sync-types` y el primer paso de `make verify`.
