# NOTES-w6w

Agente de costura del cliente de W6. Ambito escrito: `frontend/app/pages/game.vue`,
`frontend/app/composables/useShellUi.ts`, `frontend/app/composables/useGameBridge.ts`,
`frontend/app/stores/**` y este fichero.

La ejecucion de este agente se interrumpio por una parada solicitada por el usuario y se reanudo
despues. Lo escrito antes de la parada —la capa de entidades enlazada en la pagina, los contadores de
plaza en el reductor, la geometria de la parcela forestal en el almacen de silvicultura, el sujeto de
un modo en el puente y la primera version de `stores/__tests__/sync.test.ts`— quedo en el arbol de
trabajo sin verificar en el navegador. La verificacion de la reanudacion encontro dos defectos que ese
codigo tenia y que solo el navegador podia mostrar; los dos estan corregidos y son los apartados 3.1
y 3.2 de esta nota. Conviene leerlos antes que nada, porque el segundo cambia una regla del reductor.

## 1. Ficheros escritos

| Fichero | Que se hizo |
|---|---|
| `frontend/app/pages/game.vue` | La capa de entidades de ADR-0046 se crea con la herramienta de seleccion, una vez la escena del mundo ha corrido `create`; el sujeto de un modo armado desde un panel; el enlace de `EntitySource` con los seis almacenes |
| `frontend/app/composables/useGameBridge.ts` | `SelectionMode` lleva ahora el modo y su sujeto (`mode`, `fieldId`, `forestPlotId`, `buildingType`); `RenderPreferences` y el evento `settings:changed` con carga util retenida |
| `frontend/app/composables/useShellUi.ts` | Sin cambios en esta reanudacion. Lo que lleva es de W5-W |
| `frontend/app/stores/sync.ts` | Contadores de plaza fuera del veredicto de secuencia y con marca propia; condicion de maquina de una cancelacion; geometria de la parcela forestal por trama y por instantanea; la granja de la ultima maquina retirada |
| `frontend/app/stores/farms.ts` | `applyMachineSlots` |
| `frontend/app/stores/workers.ts` | `homeSlots`, `freeHomeSlots`, `applyHomeSlots` y un `reset` propio |
| `frontend/app/stores/machines.ts` | `applyCondition` |
| `frontend/app/stores/forestry.ts` | `cellsByPlotId`, `cellsOf`, `applyCells`, `replaceAllCells` |
| `frontend/app/stores/__tests__/sync.test.ts` | Diez pruebas del reductor sobre lo que W6 le anadio |
| `docs/handoff/NOTES-w6w.md` | Este fichero |

No se ha escrito en ningun directorio de panel, ni en `app/game`, ni en `app/net`, ni en `app/mock`,
ni en `registry.ts`.

## 2. Verificacion

### 2.1 Puertas, con salida real

Ejecutadas desde la raiz del repositorio, con PostgreSQL en 55432 y Redis en 56379.

| Orden | Codigo | Resultado |
|---|---|---|
| `make typecheck` | 0 | `tsc` en `shared` y en `backend` sin salida; `vue-tsc --build --force` del cliente sin salida |
| `make lint` | 0 | `npx eslint .` sin hallazgos, incluidas las reglas de zona; Prettier responde «All matched files use Prettier code style!» |
| `npx vue-tsc --build --force` en `frontend/` | 0 | Sin salida |
| `npx vitest run` en `frontend/` | 0 | 60 ficheros y 646 pruebas, todas en verde |
| `make test-unit` | 0 | `shared`: 23 ficheros y 418 pruebas. Cliente: 60 ficheros y 646 pruebas. Todas en verde |

El cliente eran 52 ficheros y 522 pruebas al empezar esta reanudacion. Dos de las 124 nuevas son de
este agente, en `stores/__tests__/sync.test.ts`; el resto son pruebas de componente que otro agente
de la fase escribia a la vez.

No se ejecuto `git`, ni `npm install`, ni `prisma`, ni `docker compose`, ni ninguna construccion de
produccion.

### 2.2 Recorrido en el navegador

Entorno: `npx nuxt dev --port 3111`, Chrome 151 sin cabeza con SwiftShader dirigido por el protocolo
de depuracion, ventana 1600x900, ruta `/game?mock=1&mockSession=1`, es decir el camino real de datos:
cliente REST tipado y reductor contra el servidor simulado. El servidor de desarrollo y el navegador
quedaron apagados al terminar; los puertos 3111 y 9222 estan libres.

Ningun error de consola en todo el recorrido. Lo unico que la consola emite es el aviso del servidor
simulado («[mock] servidor simulado activo: ninguna peticion sale a la red») y el informativo de Vue
sobre `<Suspense>`. Ninguna excepcion, ninguna peticion fallida.

| Comprobacion | Lo que se observo |
|---|---|
| El mundo se pinta | Lienzo de 1240x725 dentro del visor. Terreno con sus cuatro tipos, la granja con sus cuatro edificios, los dos campos y sus contornos, y la barra superior con saldo 28.450,00, dia 18 · 12:00, multiplicador 24x, plantilla 2, maquinaria 4, silo 18 %, consumo 97,75/h |
| Maquinaria en el lienzo | Dos maquinas aparcadas dentro del garaje, un tractor verde con arado naranja trabajando dentro del campo este, y la maquina que no esta en la tarea en su plaza. Las cuatro que el panel de maquinaria enumera |
| Trabajadores en el lienzo | Un trabajador dibujado junto a la vivienda con su rotulo, «Marc Ferrer», que es el ocioso; el otro esta en la tarea de arar y el panel de tareas lo nombra, «Elena Prado · Tractor + Arado» |
| Arboles en el lienzo | Con la leyenda plegada y la camara sobre la parcela oeste, 236 arboles dibujados uno a uno en hileras dentro del contorno de la parcela, distinguibles del tinte de terreno de bosque que hay al norte |
| Desplazamiento | Arrastre con el boton central: el minimapa pasa de «Celda 113, 105 · 25 de 49 chunks cargados» a «Celda 124, 113 · 30 de 49» |
| Zoom | Tres muescas de rueda hacia fuera: «Celda 124, 112 · 49 de 49 chunks cargados». Tres hacia dentro: vuelve a «Celda 124, 113 · 49 de 49» |
| Panel desde la barra de pestanas | Las nueve pestanas responden. «Tareas» abre «Tareas · Cuenta atras en vivo y cancelacion advertida», con «En curso 1», «Proxima en terminar 1 d 23 h», «Historial 0» y la fila «Arar · Parcela este · En curso · Progreso 8.1 % · Termina en 1 d 23 h · duracion 51.4 h · Elena Prado · Tractor + Arado» |
| Silvicultura | «Parcelas 1 · Arboles en pie 236 · Madera en pie 280.25 m3 · Talable ahora 277.30 m3 · Valor de la tala 12.478,50», y la parcela «Bosque del oeste · 236 celdas · 2,36 ha» con las cuatro fases a 59 arboles cada una |
| Parcela forestal | «Inspeccionar» abre el panel `forest-plot` con el histograma de fases, «Proximo cambio de fase en 3 d 7 h» y los cuatro controles de tala, replantacion y desmonte |
| Asignar tarea | «Talar la parcela entera» abre el modal `task-assign`: operacion Talar/Replantar, «Bosque del oeste · 177 arboles», los dos trabajadores con su habilidad y el motivo del bloqueo de uno («El trabajador no esta disponible»), maquinaria «Cosechadora forestal · §90 · Sin combinacion posible» y la prevision de duracion, coste, salario y desgaste |
| Entrada del lienzo con el modal abierto | Con `task-assign` abierto el visor lleva `fw-input-blocked`; Escape cierra el modal y la clase desaparece |
| Contadores de plaza tras una venta | El panel de granja muestra «Garaje 4 / 4» antes y «Garaje 3 / 4» despues, y esa cifra es `farm.machineSlots` del almacen, no la cuenta local del panel de maquinaria. Leido tambien sobre Pinia: `machineSlots` pasa de `{used:4,total:4}` a `{used:3,total:4}` |
| Contadores de plaza tras un despido | `workers.homeSlots` pasa de `null` a `{used:1,total:4}` sobre Pinia, y el panel de personal de «Plazas de vivienda 2 / 4» a «1 / 4» |
| Que la venta y el despido descartan la respuesta | `sync.discardedCount` sube a 1 con la venta y a 2 con el despido, y los contadores se aplican igualmente. Es la comprobacion del apartado 3.2 |

El resumen de regreso no se pudo ejercitar contra el servidor simulado y el motivo esta en el
apartado 4.4.

## 3. Los dos defectos que el navegador encontro

### 3.1 La capa de entidades no puede adjuntarse sola antes del arranque de Phaser

Categoria: defecto corregido dentro del ambito
Fichero: `frontend/app/pages/game.vue`

`NOTES-w5d.md` 5.1 afirma que la capa de entidades no necesita la espera con plazo que la herramienta
de seleccion necesita, porque «comprueba `isReady` en su constructor y, si la escena no ha corrido
`create`, se suscribe a `Phaser.Scenes.Events.CREATE` y se adjunta sola», y que por tanto se puede
construir en la misma sentencia que `createGame`. Esa afirmacion es incorrecta y el codigo escrito
antes de la parada la habia seguido al pie de la letra.

El respaldo no puede correr antes del arranque porque para suscribirse lee `world.events`, y
`Scene.events` es justamente la propiedad que Phaser asigna en `Systems.init`, es decir cuando el
gestor de escenas arranca la escena, no en el constructor. Construir la capa junto a `createGame`
lanza `TypeError: Cannot read properties of undefined (reading 'once')` dentro del `onMounted` de la
pagina, Nuxt sustituye la pagina por su pagina de error 500, la pagina se desmonta, `handle.destroy()`
destruye el juego a mitad de la generacion de texturas y `PreloadScene` lanza a su vez
`TypeError: Cannot read properties of null (reading 'drawImage')`. Lo que se veia era una pagina de
error del servidor de desarrollo con un mensaje que no menciona ni Phaser ni la capa.

Salida real del rastro, antes del arreglo:

```
 928 dom {"t":"Farming Management Simulator Online","c":true,"n":2,...}
1243 exception TypeError: Cannot read properties of null (reading 'drawImage')
       at PreloadScene.generate (.../game/boot/PreloadScene.ts:88:16)
1342 dom {"t":"500 - Internal Server Error | Nuxt","c":false,"n":0,
      "b":"500Internal Server ErrorCannot read properties of undefined (reading 'once')"}
```

Correccion aplicada: `attachSelectionTool` pasa a llamarse `attachToScene` y construye las dos piezas
—la capa de entidades y la herramienta de seleccion— en la rama en la que `world.isReady` ya es
cierto. Con eso el constructor de `EntityLayer` toma siempre su primera rama, que es la que funciona.
No se ha tocado `EntityLayer.ts`, que es de W5-D.

Consecuencia para quien mantenga `game/entities`: el camino diferido del constructor de `EntityLayer`
—las lineas 148 a 157— es hoy codigo inalcanzable desde la pagina de juego y no es alcanzable de forma
segura desde ningun sitio, porque el unico momento en que `isReady` es falso es tambien el unico en el
que `events` no existe. Lo que procede es que ese constructor use `deps.world.sys.events`, que si
existe desde el constructor de la escena, o que se retire la rama y se documente que la capa se crea
con la escena viva. Es un cambio en un fichero de W5-D, cerrado.

### 3.2 Los contadores de plaza no pueden depender del veredicto de secuencia

Categoria: defecto corregido dentro del ambito
Fichero: `frontend/app/stores/sync.ts`

La primera version aplicaba los contadores dentro de `applyMutationReply`, despues del veredicto. Las
pruebas de la unidad pasaban y en el navegador no se aplicaba ni uno solo.

El motivo es `decideMutationReply`, y su comentario lo explica sin saberlo: «la respuesta lleva la
secuencia del ultimo evento que la mutacion produjo», y por eso una respuesta cuya secuencia la marca
ya alcanzo se descarta, con el argumento de que toda entidad de `result` viaja tambien en una trama y
por tanto no se pierde nada. El argumento es correcto para todo lo demas y falso para los contadores:
ninguna de las cuatro rutas emite `FARM_UPSERTED`, de modo que los contadores viajan unicamente en la
respuesta. Con un socket vivo las tramas de la mutacion llegan antes que la respuesta —que es el orden
corriente, no el excepcional— la marca alcanza la secuencia de la respuesta, la respuesta se descarta y
los contadores se pierden siempre. Medido en el navegador: `sync.discardedCount` valia 1 tras la venta
y 2 tras el despido, `farms[0].machineSlots` seguia en `{used:4,total:4}` y `workers.homeSlots` seguia
en `null`.

Correccion aplicada, tres piezas:

1. `applySlotCounters` se llama antes del veredicto y no despues. Es la unica asimetria de
   `applyMutationReply` y esta declarada en su comentario.
2. Los contadores llevan marca propia, `lastSlotCounterSeq`. Describen el estado en la secuencia de su
   respuesta, de modo que tomarlos en orden no decreciente de secuencia es exactamente la garantia que
   se necesita: una respuesta atrasada no puede pisar una lectura mas reciente. `applySnapshot` fija
   la marca en la secuencia de la instantanea, porque la instantanea trae `machineSlots` y
   `workerSlots` de cada granja y es la lectura mas nueva que hay.
3. La granja de una venta se resuelve en tres pasos: la maquina completa cuando la respuesta la trae
   (compra), la fila del almacen cuando la respuesta gano la carrera, y `farmId` de la trama
   `MACHINE_REMOVED` cuando no la gano. La trama lleva ese campo, de modo que no hace falta inventar
   nada ni conservar un indice.

Dos pruebas nuevas lo fijan: una reproduce el orden real recogiendo las tramas que el servidor
simulado empuja y aplicandolas antes de la respuesta, comprueba que el veredicto es `DISCARD` y que
los contadores llegan igualmente; la otra comprueba que una respuesta de secuencia anterior no
deshace una lectura posterior.

Esto no sustituye al arreglo del servidor, que sigue pendiente y que es el que hace la cifra
autoritativa: `NOTES-w5-cierre.md` 2.6 pide que las cuatro rutas emitan `FARM_UPSERTED`. Con el, los
contadores de la respuesta pasan a ser redundancia y esta marca deja de ser necesaria; sin el, es lo
unico que hay.

## 4. Pendiente fuera del ambito

### 4.5 Puntos de fases anteriores que este recorrido volvio a ver

Estado tras W7-A: el puerto de desarrollo esta resuelto, `nuxt.config.ts` lo lee de `FRONTEND_DEV_PORT`.
Los otros dos se conservan a proposito, con su motivo en el apartado 4 de
`docs/handoff/INTEGRACION.md`: el contador de depuracion bajo la leyenda es cosmetico de una ruta de
desarrollo, y el marcado de una entidad exigiria que `WorldScene` conozca la capa de entidades, cuando
`entityAt` esta publicada y probada para el panel que la necesite.

- `frontend/nuxt.config.ts` fija el puerto de desarrollo en 3001. Quinta tanda de verificacion que
  necesita `--port 3111`. Fila 10 del apartado 5 de las erratas.
- El contador de depuracion de F3 se dibuja bajo el panel de leyenda y en `/game` sigue siendo
  invisible salvo plegando la leyenda. `NOTES-w5w.md` 4.3.
- El puente sigue sin evento de marcado de entidad: `CanvasPick` declara `MACHINE` y `WORKER` y nadie
  los emite, porque `WorldScene` resuelve el sujeto desde la capa de modificaciones del chunk.
  `NOTES-w5d.md` 5.2. Con la capa ya adjunta en la pagina, la costura es la que esa nota describe y
  exige tocar `WorldScene`, que es de W4-D.

## 5. Decisiones que merecen entrada de ADR

Dos, las dos del apartado 3, y las dos son de la misma naturaleza: una premisa razonable sobre el
orden de llegada que resulta ser falsa en la ejecucion real.

1. La costura de una pieza que vive sobre una escena de Phaser espera a que la escena exista, sin
   excepciones y aunque la pieza afirme que sabe esperar sola. El motivo no es prudencia: es que la
   propiedad que una pieza necesita para suscribirse a «la escena ya existe» es de la misma familia
   que la que no existe todavia.
2. Lo que solo viaja en la respuesta de una mutacion no puede aplicarse bajo el veredicto de
   secuencia, porque ese veredicto esta construido sobre la premisa de que todo lo que la respuesta
   trae viaja tambien en una trama. Un dato que rompe la premisa necesita su propia marca de
   monotonia, y el sitio donde declararlo es el propio reductor.

## 6. Ordenes no ejecutadas

Ninguna que mute el repositorio fuera del ambito asignado: sin `git`, sin `npm install`, sin
`docker compose`, sin `prisma migrate` ni `prisma generate`, sin construcciones de produccion. Se
ejecutaron `make sync-types` (como prerrequisito de las puertas), `make typecheck`, `make lint`,
`make test-unit`, `npx vue-tsc --build --force`, `npx vitest run`, `npx nuxt dev --port 3111` y Chrome
sin cabeza contra el protocolo de depuracion. El servidor de desarrollo y el navegador quedaron
apagados antes de cerrar esta nota, con los puertos 3111 y 9222 libres.

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 4.4 El servidor simulado no produce nunca un resumen de regreso

Aplicado por W7-A (integracion), y no cambiando el literal a `true`, que es lo que la nota descarta, sino
derivandolo como el servidor real: `welcomeBackPending` es `lastSummaryGameMs < nowGameMs`, de modo que
`POST /api/session/welcome-back/ack` lo apaga al mover la marca.

El texto original de la nota:

Categoria: cambio en fichero de otro agente
Ficheros afectados: `frontend/app/mock/handlers.ts`, linea 530
Propietario: W3-C (cerrado), a aplicar por W7-A

La instantanea del servidor simulado devuelve `welcomeBackPending: false` como literal, de modo que
`pages/game.vue` no abre nunca el modal `welcome-back` contra el. El panel esta escrito y la ruta
`GET /api/session/welcome-back` esta simulada; lo que no hay es el camino por el que un jugador lo
encontraria. Este agente no lo toco porque `app/mock` no esta en su ambito y porque cambiar ese
literal a `true` haria que el modal se abriese en toda sesion de desarrollo, que tampoco es el
comportamiento correcto. Lo razonable es derivarlo de si `lastSummaryGameMs` esta por detras del
ultimo cierre de sesion del mundo simulado, que es la regla que el servidor real aplica.

Consecuencia: el resumen de regreso es el unico de los cinco paneles de la fase que no se ha podido
ejercitar en el navegador. Sus dependencias de este ambito si estan enlazadas y comprobadas:
`player.welcomeBackPending` lo escribe `applySnapshot`, `player.firstSession` lo escribe
`pages/login.vue`, y `pages/game.vue` abre el modal no descartable en el primer caso y el panel lateral
`starting-guide` en el segundo.

### 4.3 El sujeto de un modo sin proposito compartido sigue sin salir del panel

Aplicado por W7-A (integracion), con la llamada que la nota escribe: `startSelectionMode` publica
`mode`, `fieldId`, `forestPlotId` y `buildingType` junto al proposito. Con ello `FELL_AREA` y
`FIELD_SPLIT` llegan a la herramienta como si mismos y no como el proposito mas cercano.

El texto original de la nota:

Categoria: cambio en fichero de otro agente
Ficheros afectados: `frontend/app/components/panels/cell-inspector/worldAccess.ts`, `startSelectionMode`
Propietario: W4-F o el propietario de `cell-inspector`, a aplicar por W7-A

El puente ya lleva el sujeto: `SelectionMode` declara `mode`, `fieldId`, `forestPlotId` y
`buildingType`, y `pages/game.vue` los aplica sobre la herramienta con una tabla exhaustiva por tipo
en los dos sentidos. Lo que falta es que el emisor los rellene. `startSelectionMode` publica hoy
unicamente el proposito y, para los dos modos que no tienen proposito propio —`FELL_AREA` y
`FIELD_SPLIT`— publica el mas cercano: para una tala eso es `CLEAR_LAND`, cuya regla por celda exige
justo lo contrario, una celda sin arbol en pie.

Cambio a aplicar, dentro de la llamada que ya existe:

```ts
deps.bridge.emit('selection:mode', {
  purpose,
  mode: SelectionToolMode[intent.mode] as SelectionToolModeName,
  fieldId: intent.fieldId ?? null,
  forestPlotId: intent.forestPlotId ?? null,
  buildingType: intent.buildingType ?? null,
  ...(footprint === null
    ? {}
    : { fixedWidthCells: footprint.widthCells, fixedHeightCells: footprint.heightCells }),
});
```

No bloquea nada hoy: los paneles conservan su propio veredicto con `judgeSelection`, que es lo que
`NOTES-w4g.md` 1.3 fijo. Lo que se gana es que la herramienta pinte el veredicto correcto por celda
durante el arrastre de una tala, en lugar del de un desmonte.

### 4.2 La consulta del ledger no admite sus filtros por HTTP

Aplicado por W7-A (integracion).

El texto original de la nota:

Categoria: cambio en fichero congelado del contrato
Ficheros afectados: `shared/api/schemas/economy.ts`, `ledgerQuerySchema`
Propietario: W2-C (cerrado), a aplicar por W7-A

Cae fuera de este ambito. La ampliacion es la de `NOTES-w5c.md` 2.3 y tampoco ha cambiado:

```ts
export const ledgerQuerySchema = z.strictObject({
  limit: limitQuerySchema(MAX_LEDGER_PAGE, DEFAULT_LEDGER_PAGE),
  cursor: cursorSchema.optional(),
  type: z.enum(LedgerType).optional(),
  fromGameMs: gameMsSchema.optional(),
  toGameMs: gameMsSchema.optional(),
});
```

`queryLedger` y `sumLedger` implementan y prueban el filtro; lo que lo rechaza es el objeto estricto
del contrato, antes de llegar al modulo.

### 4.1 El proceso `worker` no aplica la liquidacion forzosa

Aplicado por W7-A (integracion) desde `registerDomainHandlers`.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `backend/src/handlers.ts`
Propietario: W3-A (cerrado), a aplicar por W7-A

Cae fuera de este ambito, que es el cliente. El parche es el de `NOTES-w5c.md` 2.1 y no ha cambiado:
una linea de importacion y una de llamada en `registerDomainHandlers`.

```ts
import { registerEconomySweepHooks } from './modules/economy/jobs.js';
// ...
export function registerDomainHandlers(services: ServiceContext): void {
  registerEconomySweepHooks();
  // el resto sin cambios
}
```

`registerEconomySweepHooks` es idempotente, de modo que llamarla ademas desde `registerEconomyRoutes`
no apila el enganche dos veces. Sin ella, un barrido que corra en el proceso de la cola liquida
devengos y no liquida activos.
