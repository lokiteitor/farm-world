# W3-C — Esqueleto del cliente, red, estado y registro de paneles

Agente: W3-C. Fase: W3. Fecha: 2026-08-11.

Ambito escrito: `frontend/app/app.vue`, `frontend/app/layouts/`, `frontend/app/pages/`,
`frontend/app/middleware/`, `frontend/app/net/`, `frontend/app/stores/`,
`frontend/app/composables/`, `frontend/app/assets/`, `frontend/app/components/shell/`,
`frontend/app/components/ui/`, `frontend/app/components/panels/registry.ts` con los 23 stubs, y
`frontend/app/mock/`. No se ha escrito en `frontend/app/game/`, ni en `backend/`, ni en `shared/`,
ni en la raiz. `frontend/nuxt.config.ts` no se ha tocado (apartado 4.1).

---

## 1. Que queda instalado

### 1.1 Red (`frontend/app/net/`)

| Fichero | Contenido |
|---|---|
| `runtime.ts` | Configuracion del transporte y deteccion del servidor simulado |
| `transport.ts` | Costura HTTP: `fetchTransport` real y punto de sustitucion |
| `errors.ts` | `ApiClientError` con `code` del contrato, y clasificacion del fallo |
| `session.ts` | Token de acceso en memoria y refresco unico en cola |
| `api.ts` | Cliente REST tipado derivado de `API_ROUTES` |
| `sequence.ts` | Regla de secuencia y escalera de resincronizacion, puras |
| `backoff.ts` | Retroceso exponencial con jitter, con el azar inyectado |
| `ws.ts` | Conexion viva: ticket, latido, reconexion y aplicacion de la regla |
| `bootstrap.ts` | Orden de arranque: transporte antes de la primera peticion |

Cuatro comportamientos viven solo aqui: credenciales siempre incluidas, un unico refresco por
rafaga de 401, tiempo limite por llamada con `AbortController`, y clave de idempotencia generada
una vez por intento del jugador y reutilizada por cada reintento.

Nada del cliente construye un `fetch` ni un `WebSocket` propio. Las dos costuras
(`setHttpTransport`, `setWsSocketFactory`) son por tanto suficientes y no se pueden sortear, que
es la razon de que el servidor simulado sea un transporte y no un `fetch` parcheado.

### 1.2 Estado (`frontend/app/stores/`)

Los dieciseis almacenes de la seccion 9.6 del plan, mas dos que el plan no nombra y que el
contrato exige (apartado 3.2): `forestry` y `sync`. Mas `collection.ts`, que es la fabrica de
coleccion normalizada sobre la que se construyen los almacenes de entidad.

El reductor tiene exactamente dos puntos de entrada, conforme al apartado 2.1 de `NOTES-W2c`:
`applyFrame` para un sobre de WebSocket y `applyMutationReply` para el `result` de una ruta
secuenciada. La respuesta mutante se reduce por nombre de campo y no con un `switch` por
endpoint, de modo que las veintidos rutas secuenciadas estan cubiertas por una tabla y una ruta
anadida despues no exige tocar el reductor. Cada aplicador valida su valor con el esquema que lo
describe, que es a la vez como un `unknown` se convierte en fila tipada sin conversion y como un
nombre ambiguo no puede escribir en la porcion equivocada.

La marca `lastAppliedSeq` vive en `sync` y no en `net`, porque es una propiedad del reductor y no
de la conexion: dice que se ha aplicado, que es exactamente la pregunta contra la que se decide
un duplicado o un hueco. `net` la lee y no la escribe.

El estado optimista esta aislado en `pending`, indexado por clave de idempotencia, y solo decora
el renderizado: `pendingCellKeys` para el lienzo, `isRouteBusy` e `isSubjectBusy` para los
controles. Ningun almacen de dominio se escribe antes de que el servidor responda.

### 1.3 Reloj (`composables/useGameClock.ts`)

Extrapolacion local desde el ancla con `gameMsAt` de `shared/rules`, con el reloj de pared
inyectado. Tres propiedades verificadas por prueba: avanza por el multiplicador racional, nunca
retrocede aunque el reloj de la maquina se corrija hacia atras, y salta en seco cuando la
desviacion supera `CLOCK_RESYNC_THRESHOLD_GAME_MS`. La primera lectura no cuenta como salto: es
inicializacion, y contarla haria que el contador dijese que el reloj local esta mal en cada
carga de pagina.

El vigilante de la lectura se descarga con `flush: 'sync'`. No es un detalle de estilo: tras un
salto en seco, cualquier cuenta atras que lea el reloj en el mismo turno tiene que ver el valor
corregido, o la interfaz pinta un fotograma con la extrapolacion vieja.

### 1.4 Puente con Phaser (`composables/useGameBridge.ts`)

Emisor tipado con quince eventos, completo aunque Phaser no exista todavia, porque es lo que
consumen W3-D, W4-D, W5-D y W5-E. Publica Phaser: `scene:ready`, `scene:preload`, `scene:error`,
`canvas:pick`, `canvas:hover`, `canvas:drag`, `camera:changed`, `render:stats`. Publica Vue:
`camera:goto`, `selection:mode`, `selection:changed`, `chunks:invalidated`, `world:reload`,
`input:enabled`, `viewport:resized`.

El puente es de ambito de modulo y no se provee por inyeccion de Vue: una escena de Phaser vive
fuera del arbol de componentes y no puede llamar a `inject`. `useGameBridge()` da la version con
desuscripcion automatica al destruirse el ambito; `gameBridge()` da la version sin seguimiento,
para una escena y para las pruebas.

### 1.5 Composicion de la pagina y arbitraje de entrada

La rejilla de la seccion 9.1 esta en `components/shell/AppShell.vue`: barra superior, visor mas
panel lateral colapsable, barra de pestanas, y las capas fijas de modales y avisos fuera de la
rejilla. Estan fuera a proposito: en una fila, abrir un dialogo reflowearia el visor, lo que
redimensionaria el lienzo, lo que en un renderizador de tilemap significa reconstruir los chunks
visibles. Un modal costaria una caida de fotogramas sin motivo.

El arbitraje esta en un unico sitio, `useShellUi`, como una sola expresion: el mundo acepta
entrada cuando no hay ningun modal abierto. El panel lateral no la quita, porque arrastrar una
seleccion mientras el panel muestra su precio es el flujo entero de la compra de tierra. El
vigilante que publica el veredicto corre en un `effectScope` desacoplado y con descarga
sincrona; atado al ambito del primer componente que llamase al composable, se destruiria al
desmontarse ese componente y desde entonces abrir un modal dejaria de deshabilitar el lienzo.

Escape cierra el modal superior; sin modal, cierra la bandeja de avisos; sin bandeja, colapsa el
panel lateral. Ese orden es lo que hace que Escape signifique «un paso atras» y no «cierra
todo», que es el comportamiento que pierde un formulario a medio rellenar.

### 1.6 Registro de paneles

`components/panels/registry.ts` con los 23 paneles, cada uno con su stub en su propio
directorio. **Queda congelado.** Cada entrada declara superficie, pestana, agente responsable y
secciones del GDD, de modo que el reparto de los tres grupos es dato y no un parrafo.

| Grupo | Agente | Paneles |
|---|---|---|
| Primero | W4-E | `cell-inspector`, `land-purchase`, `field-list`, `field-inspector`, `field-create`, `field-edit`, `farm-overview`, `building-placement`, `building-inspector`, `legend`, `minimap` |
| Segundo | W5-F | `machinery`, `workers`, `labor-pool`, `market`, `starting-guide`, `settings` |
| Tercero | W6-D | `task-assign`, `task-list`, `forestry`, `forest-plot`, `welcome-back`, `notices` |

Como se llega a 23 desde la seccion 9.6 del plan: la prosa enumera veintidos clausulas separadas
por punto y coma; la barra superior y la barra de pestanas son componentes del shell y no
paneles, la autenticacion es una pagina y no un panel, y tres clausulas cubren mas de un panel
(el inspector y el listado de campos, la creacion y la edicion de geometria, y el listado de
parcelas y el inspector de una). El recuento esta anotado en la cabecera del registro.

El componente se carga con `import()` dinamico, que no crea arista estatica en el grafo de
modulos: por eso el registro no depende de veintitres componentes y un panel que el jugador
nunca abre no se descarga.

### 1.7 Servidor simulado (`frontend/app/mock/`)

Responde a las 55 rutas del contrato. La tabla esta indexada por `ApiRouteKey`, de modo que una
ruta anadida al mapa sin manejador es un error de compilacion y no un 404 que descubre un panel.
El emparejamiento de URL recorre `routeDefinitions()`, igual que el registro de Fastify, con los
segmentos literales antes que los marcadores para que `POST /api/fields/merge` no case con
`POST /api/fields/:fieldId/extend`.

Cuanto comportamiento tiene cada manejador es un gradiente deliberado:

- Simulado de verdad: presupuesto y compra de tierra con motivo por celda, creacion, ampliacion,
  division y fusion de campo, colocacion y retirada de edificio con huella del catalogo, compra,
  venta y reparacion de maquina con la plaza de garaje y el taller como restricciones,
  contratacion y despido con la plaza de vivienda, prevision y creacion de tarea con reserva de
  trabajador y maquinaria, cancelacion con liberacion, venta de mercado con movimiento de
  existencias y de saldo, y carga de chunks con version y respuesta `unchanged`.
- Coherente y sin simular lo que ningun panel lee: el resumen de regreso, el libro mayor
  paginado, la creacion de parcela forestal (crea la parcela vacia y no genera arbolado), y las
  cuatro rutas de desarrollo.

Dos invariantes se cumplen en todas: una ruta mutante emite sus tramas antes de construir la
respuesta y responde con la secuencia de la ultima, y ninguna respuesta se escribe con un
literal donde una regla compartida puede producirla. El mundo de ejemplo deriva el origen de
`assignSpawn`, las capacidades de `BUILDING_CATALOGUE`, los precios de `MACHINE_CATALOGUE` y
`CROPS`, el salario de la regla procedural de §102 con las constantes de `shared/config`, y las
fases del arbolado de `PINE`.

El socket simulado implementa `WsSocketLike` y nada mas, de modo que la reconexion, el latido y
la regla de secuencia de `net/ws.ts` corren sin cambios contra el. El anillo de reproduccion
tiene capacidad 64 a proposito: la escalada de reproduccion a instantanea solo ocurre cuando el
anillo no alcanza, y un anillo que nunca truncase dejaria sin ejercitar el camino mas delicado
del cliente.

Activacion, en orden de precedencia: `VITE_FARM_WORLD_MOCK=1`, `?mock=1` en la URL, o
`farm-world.mock` en `localStorage`. La segunda es la que usara un agente de paneles: no exige
reiniciar el servidor de desarrollo y sobrevive a una recarga. `?mockSession=1` arranca con
sesion abierta, para no rellenar el formulario en cada recarga.

---

## 2. Para el ADR (los escribe W3-A: 0015-0020)

1. **ADR-0019, sincronizacion del cliente por secuencia.** Dos puntos de entrada al reductor y
   ningun tercero. La frontera que decide entre reproducir y pedir instantanea es
   `oldestReplaySeq <= lastAppliedSeq + 1`: el anillo tiene que contener la primera trama que
   falta, no meramente solaparse con el rango. La respuesta de una ruta mutante se acepta con
   `seq > marca` y no con `seq === marca + 1`, porque una mutacion produce varias tramas y su
   `seq` es la de la ultima; es admisible porque toda entidad es reemplazo completo.
2. **ADR-0019, complemento.** La regla de huecos se aplica tambien por chunk, con la misma forma
   y una consecuencia distinta: un parche es un delta de las celdas modificadas, asi que solo
   puede aplicarse sobre la version exacta que sigue, y cualquier otra cosa es una recarga del
   chunk. Adivinar dejaria al renderizador pintando una celda que ya no pertenece al campo
   dentro del que se dibuja.
3. **ADR-0020, paleta unica.** La costura entre `game/textures/palette.ts` y `assets/tokens.css`
   es un bloque delimitado por marcadores `fw-palette:start` / `fw-palette:end`, que W3-D
   regenera y W3-C no toca. Funciono: W3-D lo regenero durante esta misma fase y el bloque de
   interfaz sobrevivio intacto. El DOM lee todo token como `var(--fw-x, fallback)`, de modo que
   un token renombrado degrada a un color legible en lugar de a `unset`, que en CSS resuelve a
   `transparent` para un fondo y produce una pagina que parece vacia en vez de rota.
4. **Decision nueva: el servidor simulado es un transporte, no un `fetch` parcheado.** Dos
   costuras, `setHttpTransport` y `setWsSocketFactory`, y ningun global. Se gana que una prueba
   lo instale sin tocar el entorno, que el camino real y el falso tengan el mismo contrato
   observable, y que nada de la aplicacion pueda sortearlo. El coste es que el cliente no puede
   usar `$fetch` de Nuxt en ningun sitio, lo que es de todos modos necesario para que el cliente
   tipado sea el unico camino.
5. **Decision nueva: el refresco unico no es una optimizacion.** El refresh token rota al usarse
   y la rotacion invalida el que consumio, de modo que tres llamadas que refrescasen por su
   propio 401 producirian tres rotaciones, dos de ellas rechazadas, y la recuperacion destruiria
   la sesion que intentaba salvar. Una sola promesa compartida por rafaga es lo que hace
   compatibles la rotacion y la concurrencia.
6. **Decision nueva: el estado optimista no escribe dominio.** El pilar de servidor autoritativo
   se sostiene tambien en la arquitectura del cliente porque el mapa `pending` esta indexado por
   clave de idempotencia y solo decora el renderizado. La consecuencia practica es que un panel
   no puede «adelantar» un cambio: lo unico que puede hacer es marcar la operacion en vuelo.

---

## 3. Discrepancias detectadas

### 3.1 El contrato no tiene trama de acuse para el latido

`shared/ws/envelope.ts` declara `ping` del cliente y la union de tramas del servidor no tiene
ninguna etiqueta de acuse. `WS_CLOSE_CODES.HEARTBEAT_TIMEOUT` existe, lo que confirma que el
corte por silencio esta previsto, pero desde el cliente no hay nada que contar como «pong
recibido».

Resuelto sin cambiar el contrato: `net/ws.ts` mide trafico entrante de cualquier tipo y trata
dos periodos de latido consecutivos sin recibir nada como socket muerto. El servidor simulado
responde a un `ping` con una trama `CLOCK`.

**Pendiente para W3-A**: el backend debe responder a un `ping` con alguna trama, y `CLOCK` es la
natural, porque ya esta en la union, no consume numero de secuencia y lleva justo lo que el
cliente quiere de todos modos. Si en su lugar se prefiere anadir una etiqueta `PONG`, es un
cambio en `shared/ws/`, que esta congelado, y lo aplicaria W7-A.

### 3.2 El plan enumera dieciseis almacenes y el contrato exige dos mas

La seccion 9.6 nombra `player`, `clock`, `world`, `farms`, `buildings`, `fields`, `machines`,
`workers`, `laborPool`, `tasks`, `inventory`, `market`, `notices`, `pending`, `selection` y
`net`. No hay ninguno para silvicultura, y el contrato tiene `FOREST_PLOT_UPSERTED`,
`FOREST_PLOT_REMOVED` y `TREES_UPSERTED`, y los paneles `forestry` y `forest-plot` de W6-D
necesitan de donde leerlos.

Anadidos, y documentados en la cabecera de cada uno:

- `stores/forestry.ts`, parcelas y arboles. La alternativa, meter las parcelas en el almacen de
  campos, pondria dos entidades distintas tras un mismo espacio de claves.
- `stores/sync.ts`, el reductor. No es una porcion de estado sino el punto por el que pasan
  todas, y el apartado 2.1 de `NOTES-W2c` lo exige explicitamente.
- `stores/collection.ts`, fabrica de coleccion normalizada. No es un almacen: Pinia identifica
  un almacen por nombre y doce almacenes de entidad necesitarian doce nombres.

Los asientos recientes del libro mayor viven en `stores/player.ts` y no en un almacen propio:
`ledgerSeq` es una columna del jugador y lo que la interfaz necesita son los ultimos asientos
para explicar un saldo que acaba de moverse. Una pagina de historico es una peticion, no estado.

### 3.3 Rutas del brief que difieren de `docs/ownership.md`

| Brief de W3-C | `docs/ownership.md` (3.6) | Elegido | Motivo |
|---|---|---|---|
| `frontend/app/components/panels/registry.ts` | `frontend/app/components/panels/index.ts` | `registry.ts` | El brief lo nombra tres veces y dice explicitamente que no se vuelve a tocar |
| `frontend/mock/**` | `frontend/app/mock/` | `frontend/app/mock/` | Fuera de `srcDir` no lo cubre ningun proyecto de TypeScript de los que genera Nuxt, de modo que `vue-tsc` no lo comprobaria, y el patron de inclusion de `vitest.config.ts` (`app/**`) no recogeria sus pruebas. Coincide ademas con el arbol de la seccion 4 del plan |
| `frontend/app/assets/**` como propiedad de W3-C | `assets/tokens.css` atribuido a W3-D | Compartido con marcadores | Apartado 2, punto 3 |
| `frontend/nuxt.config.ts` como propiedad de W3-C | W1, congelado tras W1 | No tocado | Apartado 4.1 |

**Pendiente para W7-A**: cuadrar el apartado 3.6 de `docs/ownership.md` con el arbol real.
Concretamente: `registry.ts` en lugar de `index.ts`; `frontend/app/mock/`; las dos filas de
`frontend/app/assets/tokens.css` (bloque de paleta de W3-D, bloque de interfaz de W3-C) y
`shell.css`; los dos directorios nuevos `frontend/app/middleware/` y
`frontend/app/components/{shell,ui}/`; y `frontend/app/pages/texture-lab.vue`, que lo ha escrito
W3-D dentro de un directorio atribuido a W3-C (ver 3.5).

### 3.4 `shared/api/__tests__/fixtures.ts` no llega al cliente

El apartado 8 de `shared/api/README.md` dice que los fixtures de partida del servidor simulado
estan ahi. `scripts/sync-shared-types.sh` excluye `__tests__/` a cualquier profundidad, que es
lo que la seccion 4 del plan exige para que las suites corran solo sobre el origen, de modo que
esos fixtures no existen en `frontend/app/shared`. `frontend/app/mock/world.ts` construye los
suyos desde los catalogos. No es un problema: son datos mas ricos y coherentes entre si, que es
lo que un mundo de ejemplo necesita y un fixture por modelo de lectura no da. Anotado porque el
README del contrato dice otra cosa.

### 3.5 W3-D ha escrito en un directorio atribuido a W3-C

`frontend/app/pages/texture-lab.vue` existe y lo ha creado W3-D. No se ha tocado: es su
entregable y la ruta de inspeccion de texturas que su brief pide. La consecuencia es que
`frontend/app/pages/` tiene dos escritores en esta fase, lo que no ha producido perdida de
trabajo porque los ficheros son distintos, pero contradice la regla 1. Anotado para W7-A.

En sentido contrario, la costura de la paleta funciono como estaba disenada: W3-D regenero el
bloque entre marcadores de `assets/tokens.css` sin tocar el bloque de interfaz, y su prueba
`game/textures/__tests__/tokens-css.test.ts` pasa contra el fichero resultante.

### 3.6 Dos cosas que el cliente no puede resolver solo

1. **`sellResult` no dice de que granja es.** La respuesta de `POST /api/market/sell` lleva
   `resource`, `quantitySoldUnits`, `revenue`, `balanceAfter` y `usage`, y `usage` es una
   ocupacion de almacen sin la granja ni el recurso a los que pertenece, de modo que no se puede
   colocar. El reductor la ignora y se apoya en la trama `INVENTORY_UPSERTED` que la misma ruta
   emite, que si lleva la colocacion. Es correcto por el contrato y conviene saberlo.
2. **`CHUNK_PATCHED` es la unica via para el uso de una celda.** Una respuesta mutante informa
   de las celdas que cambio (`purchasedCells`, `footprintCells`, `releasedCells`, `movedCells`)
   pero no de su nuevo uso, asi que el reductor las usa solo para invalidar: marca el chunk como
   obsoleto y el camino de streaming lo recarga. Reconstruir la fila de la celda desde la
   respuesta significaria inventar los campos que no lleva.

### 3.7 Puertos

`nuxt.config.ts` fija `devServer.port` en 3001, que es correcto: es el puerto dentro del
contenedor, y `docker-compose.yml` lo publica en `FRONTEND_DEV_PORT`, 3100. En esta maquina 3001
esta ocupado por otro proyecto y 3100 tambien estaba ocupado durante la verificacion, de modo
que el servidor de desarrollo se levanto con `npx nuxt dev --port 3111`. No hace falta ningun
cambio: `--port` de la linea de ordenes prevalece sobre la configuracion, y por eso no se ha
tocado un fichero congelado.

---

## 4. Contrato para las fases siguientes

### 4.1 Para W3-D y W4-D (lienzo)

- El punto de montaje es `components/shell/WorldViewport.client.vue`. Expone `host`, que es el
  `HTMLDivElement` que hay que pasar a la configuracion de Phaser como padre, y `size`. No
  importa Phaser y no crea ninguna escena.
- La rejilla decide el tamano. Un `ResizeObserver` mide el elemento y publica
  `viewport:resized`; la escena se configura con `Scale.RESIZE` y reacciona a ese evento. Medir
  la ventana produce el error clasico de este diseno, un lienzo que cubre el panel lateral
  porque midio la ventana antes de que el panel se abriese.
- El placeholder desaparece con `scene:ready`. `scene:preload` mueve la barra de progreso y
  `scene:error` pinta el motivo.
- La escena no puede importar `app/stores` (regla de zona de `eslint.config.js`). Todo lo que
  necesite entra por el puente.
- Tokens que el DOM consume y que el bloque de paleta debe seguir publicando: los cuatro de
  terreno, los cinco de uso, los ocho del ciclo de cultivo, los cuatro de fase de arbol, los de
  entidad, y `--fw-select-valid`, `--fw-select-invalid`, `--fw-select-neutral`,
  `--fw-select-pending`, `--fw-outline-owned`, `--fw-outline-field`, `--fw-outline-farm`,
  `--fw-outline-forest-plot` y `--fw-grid-line`.

### 4.2 Para W5-E (herramienta de seleccion)

`stores/selection.ts` tiene la forma final: `begin(intent, touching)`, `addRect`, `removeRect`,
`toggleCell`, `replaceCells`, `cancel`, y los derivados `resolvedCells`, `validation`, `ok`,
`price`, `issues`, `firstConflict`, `unresolvedCount`. El veredicto sale de `validateSelection`
de `shared/rules`, de modo que el resaltado verde y el 409 del servidor no pueden discrepar.
`unresolvedCount` mayor que cero significa que hay celdas cuyo chunk no esta cargado: el
veredicto es provisional y un resultado verde no autoriza a enviar.

### 4.3 Para W4-E, W5-F y W6-D (paneles)

- Sustituir el cuerpo del stub en su sitio. No tocar `registry.ts`.
- Leer los almacenes, no escribirlos. Enviar con `useApi().mutate`, que es el unico camino que
  pasa la respuesta por el reductor, abre y cierra el marcador optimista y genera la clave de
  idempotencia una vez por intento.
- Validar antes con los mismos esquemas y las mismas reglas compartidas: un control
  deshabilitado tiene que estar deshabilitado por el motivo por el que el servidor rechazaria, y
  `UiButton` tiene `reason` para decirlo.
- No abrir modales por cuenta propia: `useShellUi().openModal` es el unico camino, porque el
  arbitro de entrada deriva de ahi.
- Formatear con `composables/useFormatting.ts`. Las unidades del dominio no son las que el
  jugador ve y cada conversion tiene una sola implementacion.
- Desarrollar contra el servidor simulado: `http://localhost:<puerto>/game?mock=1&mockSession=1`.

---

## 5. Verificacion, salida real

| Orden | Salida |
|---|---|
| `make sync-types` | 53 ficheros a `backend/src/shared` y a `frontend/app/shared` |
| `cd frontend && npx nuxt prepare` | `Types generated in .nuxt` |
| `cd frontend && npx vue-tsc --build --force` | Sin salida, **exit 0** |
| `cd frontend && npx vitest run` | **9 ficheros, 93 pruebas, todas en verde** (incluye las dos de W3-D) |
| `npx eslint frontend` | Sin hallazgos |
| `npx prettier --check 'frontend/app/**/*.{ts,vue,css}'` | «All matched files use Prettier code style!» |
| `npx nuxt dev --port 3111` con `VITE_FARM_WORLD_MOCK=1` | Arranca sin errores; el registro solo contiene el aviso `[mock] servidor simulado activo` |

Comprobacion del pintado con Chrome sin cabeza (`--headless=new --dump-dom`), que es lo mas
cercano a la comprobacion manual que este entorno admite:

- `/login?mock=1`: aparecen «Iniciar sesion», el formulario con «Correo» y «Contrasena», la nota
  «Diez caracteres como minimo», el boton «Entrar» y el enlace «Crear una cuenta nueva». Ningun
  lienzo montado.
- `/game?mock=1&mockSession=1`: la barra superior con las siete cifras y con datos reales que
  han recorrido el reductor —Saldo 28.450,00, Dia 18 · 12:00, Multiplicador 24x, Plantilla 2,
  Maquinaria 4, Silo 18 %, Consumo 97,75 /h—, «Avisos (1)», el estado de conexion en **En
  linea** (es decir, el socket simulado conecto y su `HELLO` se aplico), la barra con las nueve
  pestanas, el anfitrion del panel lateral, el punto de montaje del lienzo con su placeholder, y
  los paneles de superposicion Leyenda, Minimapa y Avisos resueltos desde el registro.

Pruebas que cubren lo que el brief pide: hueco que desemboca en reproduccion y luego en
instantanea (`net/__tests__/sequence.test.ts`), descarte de secuencia duplicada (idem, y el eco
de una mutacion ya aplicada en `__tests__/mock-server.test.ts`), limites del retroceso con
jitter (`net/__tests__/backoff.test.ts`), extrapolacion y salto del reloj
(`composables/__tests__/game-clock.test.ts`), refresco unico ante varios 401 simultaneos
(`net/__tests__/refresh.test.ts`), y montaje sin error de los 23 stubs
(`components/panels/__tests__/registry.test.ts`).

`npx eslint .` y `npx prettier --check .` sobre todo el repositorio siguen senalando 81 y 17
ficheros respectivamente, todos bajo `backend/src/`, que es el ambito de W3-A y W3-B y estaba en
curso al cerrar esta nota. Nada de `frontend/` ni de `shared/` aparece.

---

## 6. Ordenes que no se han ejecutado

Ninguna que mute el repositorio fuera del ambito asignado: sin `git`, sin `npm install`, sin
`docker compose`, sin `prisma`, sin compilaciones de produccion. Se ejecutaron `make sync-types`,
`npx nuxt prepare`, `npx vue-tsc`, `npx vitest run`, `npx nuxt dev` y, sobre
`frontend/app` unicamente, `npx eslint --fix` y `npx prettier --write`.
