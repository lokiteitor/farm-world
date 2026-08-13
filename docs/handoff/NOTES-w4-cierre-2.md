# NOTES-w4-cierre-2

Agente de cierre documental de la segunda tanda de W4, la que escribio los trece paneles del primer grupo.
Ambito escrito: `docs/adr.md` (entradas 0031 a 0038), `docs/erratas-gdd-stack.md`, `docs/ownership.md`,
`README.md` de la raiz y este fichero. No se ha tocado codigo.

Este fichero recoge lo que la verificacion de cierre detecto y que cae fuera del ambito documental, con su
categoria, su fichero y su propietario. Las notas de los dos agentes de paneles, `NOTES-w4e.md` y
`NOTES-w4f.md`, siguen vigentes y no se repiten aqui salvo cuando la verificacion las confirmo con una
salida concreta. `NOTES-w4-cierre.md`, del primer cierre, tambien sigue vigente: de sus diez apartados, dos
quedan cerrados y se enumeran al final.

## Verificado en el cierre

Salidas reales, ejecutadas desde la raiz del repositorio, con PostgreSQL en 55432 y Redis en 56379:

| Orden | Resultado |
|---|---|
| `make sync-types` | exit 0. 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `make typecheck` | exit 0. `tsc` en `shared` y en `backend` sin salida; `vue-tsc --build --force` del cliente en verde tras regenerar los tipos de Nuxt |
| `make lint` | exit 0. `npx eslint .` sin hallazgos, incluidas las reglas de zona; Prettier responde "All matched files use Prettier code style!" |
| `make test-unit` | exit 1. `shared`: 23 ficheros y 418 pruebas en verde. Cliente: 40 ficheros y 367 pruebas, 366 en verde y 1 en rojo, la del apartado 1 |
| `make test-int` | exit 0. 16 ficheros y 142 pruebas, todas en verde |

Desglose del cliente por si sirve para localizar una regresion: los quince ficheros de
`app/components/panels/` suman 122 pruebas, de las que 121 estan en verde; las catorce suites nuevas de la
tanda aportan 115 y todas pasan. Las cuatro suites unitarias del backend, 54 pruebas, siguen en verde y
siguen sin entrar en ninguna puerta (apartado 4).

No ejecutado, conforme al brief: `git`, `npm install`, `prisma generate`, `prisma migrate`,
`docker compose` y construcciones de produccion. No se levanto ningun servidor de desarrollo en este
cierre. `make typecheck`, `make lint`, `make test-unit` y `make test-int` ejecutan `sync-types` como
prerrequisito, de modo que las dos copias de `shared/` quedaron actualizadas; ambas estan en `.gitignore` y
no son ficheros de otro agente.

La comprobacion de propiedad se hizo con `find` y con las marcas de tiempo del sistema de ficheros, no con
`git`, que la regla 5 prohibe: 432 ficheros, todos atribuidos en el apartado 3 de `docs/ownership.md`.
Ningun fichero de esta tanda tuvo dos escritores; el razonamiento completo esta en el apartado 4.6 de ese
documento.

## Pendiente

### 7. `UiButton.reason` y `exactOptionalPropertyTypes`

Categoria: cambio en fichero de otro agente, opcional
Ficheros afectados: `frontend/app/components/ui/UiButton.vue`
Propietario: W3-C (cerrado), a aplicar por W7-A si lo considera

La propiedad es `string` opcional y no admite que se le enlace `undefined`. Varios paneles de la tanda
tropezaron con ello y lo resolvieron calculando siempre una cadena. La firma general es
`reason?: string | undefined`. `NOTES-w4f.md` 4.5.

## Consecuencias para W5

- El lote de W5-F baja de seis paneles a cinco: `machinery`, `workers`, `labor-pool`, `market` y
  `starting-guide`. `settings` ya esta escrito.
- El lote de W6-D baja de seis a cinco: `task-assign`, `task-list`, `forestry`, `forest-plot` y
  `welcome-back`. `notices` ya esta escrito.
- Las convenciones que los trece paneles fijan y que conviene no reinventar estan en el apartado 2 de
  `NOTES-w4e.md`: de donde sale un motivo de bloqueo, como se formatea un importe, como se arranca un modo
  de seleccion sin tirar las celdas ya seleccionadas, y donde vive una pieza compartida entre paneles.
- Las entradas de ADR de esta tanda que un agente de paneles de W5 debe leer antes de escribir son la 0032
  (el panel no decide), la 0034 (`expectedTotal`) y la 0037 (organizacion de la capa de paneles).
- Los tramos de numeracion de ADR se han desplazado: W5 escribe 0039-0041, W6 0042-0045 y W7-D 0046-0047.
  El apartado 3.3 de `docs/ownership.md` lo recoge.
- Faltan etiquetas en castellano para `MachineType` y para los estados de maquina y trabajador. El
  inspector de edificio muestra hoy el identificador del enumerado; la tabla corresponde a los paneles de
  maquinaria y personal de W5-F. `NOTES-w4f.md` 2.4.

## Resuelto

Dos apartados de `NOTES-w4-cierre.md` quedan cerrados:

- Apartado 1, `make test-int` con cuatro pruebas en rojo. La ventana de integracion posterior a aquel
  cierre sustituyo la lista literal de rutas implementadas por `stubRouteKeys()`, derivada del registro.
  `make test-int` devuelve hoy 0 con 142 pruebas en 16 ficheros. La decision esta en ADR-0038.
- Apartado 2, los once paneles del primer grupo sin escribir. Son trece los escritos, por dos agentes, y
  el reparto real esta en el apartado 3.6 de `docs/ownership.md`.

### 6. `building-placement` esta declarado modal

Aplicado antes de W7: `surface: PanelSurface.SIDE`.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/components/panels/registry.ts`
Propietario: W3-C (cerrado), a aplicar por W7-A

Con un modal abierto, `useShellUi` deshabilita la entrada del lienzo (`worldInputEnabled = modals.length === 0`)
y el fantasma de la huella no seguiria al cursor. La superficie correcta es `SIDE`. Mitigado embebiendo el
mismo componente como paso tres del panel lateral de granja. `NOTES-w4f.md` 2.2.

### 5. Servidor simulado: dos diferencias nuevas con el servidor real

Aplicado antes de W7: el servidor simulado crea una segunda granja en lugar de renombrar la unica, y
rechaza retirar un almacen que dejaria las existencias sin sitio, en el orden y con el codigo del
servidor real.

El texto original de la nota:

Categoria: cambio en fichero de otro agente
Ficheros afectados: `frontend/app/mock/handlers.ts`
Propietario: W3-C (cerrado), a aplicar por W7-A

- `POST /api/farms` renombra la unica granja del mundo de ejemplo en lugar de crear una segunda, de modo
  que la explotacion multigranja de GDD §31 no se puede ejercitar contra el simulado.
- `DELETE /api/buildings/:buildingId` solo rechaza por ocupantes; el backend real rechaza ademas cuando
  retirar un almacen dejaria las existencias de la granja sin sitio. El inspector aplica las dos, de modo
  que es mas estricto que el simulado y coincide con el real.

Los dos estan en `NOTES-w4f.md` 4.1 y 4.2 y en las filas 28 y 29 del apartado 5 de
`docs/erratas-gdd-stack.md`.

### 4. Puntos del primer cierre que siguen abiertos sin cambio

Aplicado por W7-A (integracion), salvo el arbitraje de entrada y el dueno de Escape, que se resolvieron
antes, y `building-placement`, que ya declara `surface: SIDE`.

El texto original de la nota:

Todos con propietario W7-A y detalle en `NOTES-w4-cierre.md`:

- `make test-unit` no ejecuta la suite unitaria del backend, 54 pruebas en 4 ficheros (apartado 5 de aquel
  fichero).
- El servicio `worker` de `docker-compose.yml` sigue con `restart: "no"` (apartado 9).
- `.env.example` no declara `METRICS_PORT` (apartado 9).
- `frontend/nuxt.config.ts` fija el puerto de desarrollo en 3001 y `.github/workflows/ci.yml` declara
  `CORS_ORIGIN` con ese puerto, cuando el publicado es 3100 (apartado 9). Las dos tandas de verificacion en
  el navegador han necesitado `--port 3111`.
- El arbitraje de entrada no deshabilita el lienzo con el foco en un campo de texto, y Escape tiene dos
  duenos (apartado 7). Con trece paneles con formulario ya montados, deja de ser teorico.
- El servidor simulado valora dos veces una celda repetida (apartado 6). Se le anaden ahora dos casos mas,
  en el apartado 5 de este fichero.
- Cuatro tipos de evento agendado siguen con manejador de andamiaje (apartado 8).

### 3. El puente no declara evento de preferencias de renderizado

Aplicado antes de W7: `settings:changed` existe en el puente y la escena lo aplica.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/composables/useGameBridge.ts`, y tres interruptores en
`frontend/app/game/world/`
Propietario: W3-C y W4-D (cerrados), a aplicar por W7-A

Rejilla, contornos, umbral de nivel de detalle y sensibilidad del zoom se persisten y publican
`world:reload`, que es el unico evento congelado con ese significado; el movimiento reducido si se aplica de
verdad. La declaracion exacta de `settings:changed`, y los tres interruptores que la escena no tiene
todavia, estan en `NOTES-w4e.md` 1.2.

### 2. Costuras de `frontend/app/pages/game.vue`

Resuelto por el agente de costura de W5-W.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/pages/game.vue`
Propietario: W3-C (cerrado), a aplicar por W7-A

Dos, y las dos son de una linea o de doce:

- La pagina no llama a `createGame`, de modo que el lienzo solo se ve en `/perf`. Ya declarado en
  `NOTES-w4d.md` 1.1 y `NOTES-w4g.md` 1.5. Consecuencia para esta tanda: los tres paneles que dependen de
  una seleccion se ven vacios en el navegador, y su camino completo solo esta ejercitado por las pruebas de
  componente contra el servidor simulado.
- `activeTab` arranca en `world` y `sidePanel` en `null`, de modo que `/game` carga con el panel lateral
  vacio y hay que pulsar la pestana ya activa. Una linea en `onMounted`: `shell.selectTab('world')`.
  `NOTES-w4e.md` 1.3.

Al aplicar la primera conviene enlazar `SelectionPort.onConfirm` con la tabla `PANEL_OF_MODE` que
`NOTES-w4e.md` publica en su apartado 2, corregida como advierte `NOTES-w4f.md` 2.3: `useShellUi` no tiene
`openPanel`, sino `openSidePanel` y `openModal`.

### 1. `make test-unit` queda en rojo por el registro de paneles

Aplicado antes de W7, con el parche exacto de `NOTES-w4e.md` 1.1.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/components/panels/__tests__/registry.test.ts`
Propietario: W3-C (cerrado), a aplicar por W7-A

Es el unico rojo de las cinco ordenes. La suite recorre `PANEL_IDS` y exige de cada panel montado el texto
«No implementado» y el identificador de su agente, que es lo que pinta `UiPendingPanel`; trece paneles ya
no pueden satisfacerlo sin mentir. Salida real:

```
FAIL  app/components/panels/__tests__/registry.test.ts > los stubs de panel > todos montan sin error de consola
AssertionError: expected 'Inspector de celdaSin celda seleccion…' to contain 'No implementado'
```

Ninguno de los dos agentes de paneles lo toco, y es el comportamiento correcto: el fichero es el punto de
encuentro de los agentes de paneles de W4, W5 y W6, y el ultimo en escribirlo borraria a los otros. El
parche exacto —montar los veintitres y aplicar las dos afirmaciones de andamiaje solo a los que siguen
montando `UiPendingPanel`— esta en `NOTES-w4e.md` apartado 1.1 y en `NOTES-w4f.md` apartado 2.1.

Es el mismo defecto que `backend/src/__tests__/app.int.test.ts` tenia con su lista literal de rutas
implementadas, que rompio el build al final de W3 y otra vez al final de W4, y que la ventana de
integracion resolvio derivandola del propio registro (`stubRouteKeys` en `plugins/routes.ts`). Ese
razonamiento esta ahora en ADR-0038, y el parche del registro de paneles es su aplicacion al cliente.
