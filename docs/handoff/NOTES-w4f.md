# NOTES-w4f

Agente de paneles de granja, fase W4 (reintento). Ambito escrito, exclusivamente:

- `frontend/app/components/panels/farm-overview/**`
- `frontend/app/components/panels/building-inspector/**`
- `frontend/app/components/panels/building-placement/**`
- este fichero

No se ha escrito en ningun otro directorio. `frontend/app/components/panels/registry.ts` y su
`__tests__/`, `stores/`, `net/`, `game/`, `mock/`, `nuxt.config.ts` y `assets/tokens.css` quedan
intactos: sustituir un andamiaje consistio en reemplazar el cuerpo del stub en su sitio, conforme a
la regla 3 de la seccion 11 del plan.

---

## 1. Que se ha implementado

Los tres paneles que W4-E y W4-F dejaron sin escribir en la primera ejecucion de la fase, del grupo
de once que el registro atribuye a W4-E.

| Panel | Superficie declarada | Contenido |
|---|---|---|
| `farm-overview` | Lateral, pestana Granja | Granjas, miniatura de huella, capacidades, edificios, flujo de construccion en tres pasos y fundacion de granja |
| `building-inspector` | Lateral, pestana Granja | Tipo, capacidad, contenido, ocupantes, reventa y demolicion |
| `building-placement` | Modal (ver apartado 2.2) | Huella del catalogo, coste en vivo, motivos de invalidez y confirmacion |

Ficheros creados:

```text
frontend/app/components/panels/farm-overview/FarmOverviewPanel.vue          el panel
frontend/app/components/panels/farm-overview/FarmFootprint.vue              miniatura SVG de la huella
frontend/app/components/panels/farm-overview/buildingPresentation.ts        etiquetas, colores y lectura de capacidad
frontend/app/components/panels/farm-overview/__tests__/farm-overview.test.ts
frontend/app/components/panels/building-inspector/BuildingInspectorPanel.vue
frontend/app/components/panels/building-inspector/__tests__/building-inspector.test.ts
frontend/app/components/panels/building-placement/BuildingPlacementPanel.vue
frontend/app/components/panels/building-placement/placementPlan.ts          espejo cliente de planPlacement
frontend/app/components/panels/building-placement/__tests__/placement-plan.test.ts
frontend/app/components/panels/building-placement/__tests__/building-placement.test.ts
docs/handoff/NOTES-w4f.md                                                   este fichero
```

Reglas transversales que los tres cumplen y que conviene no relajar despues:

- Ninguna cifra de balance es un literal. La huella, la capacidad, el precio y el valor de reventa
  salen de `BUILDING_CATALOGUE` y de `shared/rules/pricing.ts`; las pruebas comparan contra esas
  mismas funciones, de modo que cambiar el catalogo no deja pasar un panel que miente.
- Todo importe se formatea con `useFormatting`, que es el unico sitio que llama a `Money.toDisplay`.
  Los importes que llegan del servidor pasan por `fromWireMoney` antes de formatearse.
- Todo texto de rechazo sale de `VALIDATION_MESSAGES`. Las dos unicas frases escritas a mano en un
  boton deshabilitado describen estados del cliente que ningun codigo del contrato nombra, porque en
  ellos no se puede formar peticion alguna: no hay tipo de edificio elegido y no hay granja.
- Los paneles no escriben ningun almacen de dominio. El unico almacen que escriben es
  `stores/selection.ts`, que es estado de interaccion y cuya API (`begin`, `replaceCells`, `cancel`)
  el apartado 4.2 de `NOTES-w3c.md` publica precisamente para esto.

### 1.1 El flujo de construccion en tres pasos

El paso uno es una decision sobre dinero, el paso dos una decision sobre espacio (GDD §24) y el paso
tres es donde se muestra el presupuesto. El catalogo del paso uno muestra los dos precios de GDD
§116 a la vez, que es la distincion que el brief pide: el precio de la estructura, que es lo que paga
quien ya posee el suelo (GDD §117), y la formula literal con la huella incluida, como ayuda de
planificacion (plan seccion 2.2, ADR-0011).

El paso dos entrega el modo al lienzo por el puente (`selection:mode` con `purpose: BUILDING` y las
dos dimensiones de la huella del catalogo) y abre la intencion en `stores/selection.ts`. No muta
nada y no cobra nada.

El paso tres es el panel `building-placement`, embebido en el panel de granja. Es el mismo
componente que el registro carga como panel propio, con `embedded` como unica diferencia: un
componente, dos superficies. La alternativa era escribir dos veces el mismo desglose de coste.

### 1.2 El espejo del plan de colocacion

`building-placement/placementPlan.ts` reproduce `planPlacement` de
`backend/src/modules/farms/placement.ts` sentencia a sentencia y llama a las mismas funciones de
`shared/rules`: `validateBuildingFootprint`, `validateSelection`, `realBuildingCost` y
`landPurchasePrice`. Incluye la proyeccion `projectAfterPurchase` y la traduccion de `CELL_IN_USE` a
`BUILDING_FOOTPRINT_OVERLAPS`, con el mismo orden de evaluacion: primero la regla de edificio sobre
la huella proyectada, despues la de compra sobre las celdas que se adquieren.

Tres diferencias deliberadas con el servidor, todas por ser el cliente una cache y no una autoridad:

1. Se reportan todos los motivos y no solo el primero. El servidor lanza el primero porque una
   transaccion tiene que parar; el panel tiene que explicar la huella entera.
2. Una celda cuyo chunk no ha llegado es indecisa, nunca invalida: no cuenta como motivo y bloquea la
   confirmacion. Es la misma lectura del apartado 5.5 de `NOTES-w4g.md`.
3. La asequibilidad se evalua contra el saldo liquidado que el cliente vio por ultima vez, con las
   dos puertas del servidor en el mismo orden: `SPENDING_BLOCKED_IN_DEBT` con saldo negativo y
   `INSUFFICIENT_FUNDS` si no alcanza.

---

## 2. Pendiente para otros agentes

---

## 3. Decisiones para el ADR

Las redacta el agente de cierre de la fase. Este agente no escribe en `docs/adr.md`.

### 3.1 El plan de colocacion del cliente es un espejo declarado del servidor, no una segunda regla

Contexto: la seccion 8 del plan y ADR-0030 exigen que la validez que el cliente pinta y el rechazo
que el servidor devuelve sean la misma funcion. La colocacion de un edificio es el caso donde eso es
mas dificil, porque no basta con `validateSelection`: hay una proyeccion de la compra, una traduccion
de codigo, un precio con dos casos y un orden de evaluacion entre la regla de edificio y la de
compra, y todo eso vive hoy en `backend/src/modules/farms/placement.ts`, que el cliente no puede
importar.

Decision: `placementPlan.ts` reproduce ese modulo sentencia a sentencia y declara en cabecera que lo
hace, con las tres diferencias enumeradas y justificadas (todos los motivos en lugar del primero,
celda sin chunk como indecisa, y asequibilidad contra el saldo liquidado que el cliente vio). Ninguna
regla se reinventa: las cuatro funciones que deciden y las dos que ponen precio son las compartidas.
Es el mismo patron que W4-G adopto para la division de campo y la tala por area (apartado 1.3 de
`NOTES-w4g.md`), y tiene el mismo coste conocido: si algun dia cambia el orden de evaluacion en el
servidor, hay dos sitios que tocar. La forma de eliminar la duplicacion, el dia que estorbe, es subir
`planPlacement` a `shared/rules/`, que es donde ya viven las seis funciones que usa.

### 3.2 El coste de un edificio se muestra siempre con sus dos casos de propiedad del suelo

Contexto: GDD §116 define `realBuildingCost = purchasePrice + footprint x cellPrice` y GDD §117
describe a un jugador que ya compro las celdas. Plan seccion 2.2 y ADR-0011 resolvieron cual es el
precio transaccional; lo que la interfaz tiene que resolver es que el jugador entienda por que dos
edificios iguales cuestan distinto.

Decision: el catalogo del paso uno muestra las dos cifras a la vez, la estructura y la formula
literal con suelo, etiquetada como referencia de planificacion; y el paso tres muestra el desglose
real de la ubicacion elegida, con el numero de celdas que la peticion adquiere. Cuando la huella esta
parcialmente poseida se cobran solo las celdas adquiridas, que es lo que hace el servidor y lo que
ninguno de los dos extremos de `realBuildingCost` expresa (apartado 4.1 de `NOTES-w4b.md`). El panel
envia `expectedTotal` con esa cifra, de modo que un presupuesto obsoleto se rechaza con un 400 que
nombra el campo en lugar de cobrarse en silencio.

### 3.3 Un componente, dos superficies

Contexto: el brief pide un flujo de construccion en tres pasos dentro del panel de granja y, a la
vez, un panel acompanante del modo de colocacion, que el registro declara aparte.

Decision: son el mismo componente. `BuildingPlacementPanel` acepta `embedded` y el panel de granja lo
monta como paso tres; el registro lo carga como panel propio para el camino que llega desde el
lienzo. Escribir dos veces el desglose de coste habria producido dos verdades sobre el mismo importe,
que es el defecto que el modulo de plan existe para evitar.

### 3.4 Capacidad, contenido y ocupantes son tres preguntas distintas y el modelo las responde en
tres sitios

Contexto: la asimetria de la seccion 5.4 del plan (lo fungible se agrega por granja, lo contado se
comprueba por edificio) es facil de romper en la interfaz, donde lo natural es pintar «lo que hay
dentro de este edificio».

Decision: la capacidad se lee del catalogo por `capacityKind`, nunca con un `switch` por tipo, de
modo que anadir un edificio a `shared/config/buildings.ts` no obliga a tocar ningun panel; el
contenido de un almacen se muestra como existencias de la granja y el panel lo dice con esas
palabras, en lugar de inventar un stock por edificio que el servidor no guarda; y los ocupantes se
listan por edificio, que es donde el servidor comprueba la capacidad y donde nace el rechazo. El
inspector reproduce ademas las dos negativas previsibles de la demolicion con el codigo del contrato,
`BUILDING_NOT_EMPTY` en los dos casos, en el mismo orden en que el servidor las evalua.

### 3.5 Fundar una granja no es una operacion fisica

Contexto: GDD §23 declara la granja una entidad fisica que ocupa celdas reales.

Decision, que ya estaba en ADR-0029 y que la interfaz hace visible: el formulario de fundacion es un
nombre y un boton, sin coste, sin huella y sin clave de idempotencia, y el panel lo dice en una linea
junto al formulario, porque un jugador que espera pagar por una granja y no paga necesita saber por
que. Lo que ocupa celdas y cuesta dinero es cada edificio.

---

## 4. Discrepancias detectadas

1. `frontend/app/mock/handlers.ts`, `POST /api/farms`: el servidor simulado renombra la unica granja
   del mundo de ejemplo en lugar de crear una segunda («One farm in the sample world»). Es una
   decision consciente de W3-C y esta documentada en el codigo, pero implica que el flujo de fundacion
   no se puede ejercitar con dos granjas contra el simulado: la prueba comprueba que la granja pasa a
   llamarse como el jugador pidio y no que el recuento suba. Contra el backend real, `POST /api/farms`
   si crea una fila nueva. Si algun dia se quiere ejercitar la explotacion multigranja de GDD §31 en
   el cliente, hay que ampliar ese manejador.

2. `frontend/app/mock/handlers.ts`, `DELETE /api/buildings/:buildingId`: el simulado solo rechaza por
   `occupancy > 0`. El backend real rechaza ademas cuando retirar la capacidad de un almacen dejaria
   las existencias de la granja por encima de lo que queda (`backend/src/modules/farms/index.ts`,
   paso previo a la escritura). El inspector aplica las dos, de modo que en el mundo de ejemplo el
   panel es mas estricto que el simulado y coincide con el servidor real: el silo, con 18.400 L
   almacenados y capacidad 100.000 L, no se puede retirar. Es la direccion correcta de la diferencia,
   pero conviene saberla antes de interpretar una prueba manual contra el simulado.

3. `shared/api/schemas/farms.ts`, `buildingDtoSchema.capacity`: el taller informa cero, como ya
   anoto el apartado 5.4 de `NOTES-w4b.md`. Los tres paneles leen la capacidad del catalogo por
   `capacityKind` y usan la columna solo para la ocupacion contada, de modo que el taller muestra su
   funcion («da acceso a la reparacion de maquinaria», GDD §29) y no un cero sin significado.

4. `frontend/app/composables/useGameBridge.ts`, `SelectionMode`: no lleva el tipo de edificio, solo el
   proposito y las dos dimensiones de la huella. Es suficiente para que la escena dibuje el fantasma,
   y el tipo viaja por `stores/selection.ts` en la intencion. Coincide con el apartado 1.2 de
   `NOTES-w4g.md`, que propone anadir `buildingType` al modo; si se aplica, este ambito no necesita
   cambios, porque ya publica la intencion completa en el almacen.

5. `frontend/app/components/ui/UiButton.vue`, propiedad `reason`: es `string` opcional, y con
   `exactOptionalPropertyTypes` en el `tsconfig` no admite que se le enlace `undefined`. Es un error
   de compilacion facil de encontrar y que aparecio en varios paneles de esta fase. Los de este ambito
   calculan siempre una cadena, vacia cuando no hay motivo. Si W7 prefiere una solucion general, la
   firma natural es `reason?: string | undefined`.

6. `docs/ownership.md`, apartado 3.6: la fila del primer grupo de paneles atribuye los once a W4-E y
   anota que ninguno se escribio. Tres de ellos los escribe este agente, W4-F, en el reintento de la
   fase. El agente de cierre tiene que cuadrar la fila con el arbol real: catorce paneles con
   contenido y nueve andamiajes, y las tres rutas de este ambito con su propietario.

---

## 5. Verificacion, salida real

Ordenes ejecutadas desde `frontend/`, salvo la primera, que es de la raiz.

| Orden | Resultado |
|---|---|
| `make sync-types` | exit 0. 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `npx vue-tsc --noEmit` | exit 0, sin salida. No comprueba nada: `frontend/tsconfig.json` es un fichero de solucion con `"files": []` (apartado 5 de `NOTES-w3d.md`) |
| `npx vue-tsc --build --force` | exit 0, sin salida. Es la orden que comprueba de verdad |
| `npx vitest run` sobre los tres directorios | **4 ficheros, 31 pruebas, todas en verde**, 2,83 s |
| `npx vitest run` (cliente completo) | 33 ficheros y 306 pruebas: 305 en verde y 1 en rojo, la del apartado 2.1 |
| `npx eslint` sobre los tres directorios | exit 0, sin hallazgos |
| `npx prettier --check` sobre los tres directorios | «All matched files use Prettier code style!» |

Comprobacion de que la comprobacion de tipos alcanza de verdad a este ambito: se introdujo a
proposito `const __probe: number = "not a number";` en `placementPlan.ts`, `vue-tsc --build --force`
lo senalo, y se revirtio.

### 5.1 Recorrido manual en el navegador

Entorno: `npx nuxt dev --port 3111` (3000, 3001 y 3100 estan ocupados en esta maquina), Chrome 151
sin cabeza dirigido por el protocolo de depuracion, ventana 1440x900, ruta
`/game?mock=1&mockSession=1`, es decir el camino real de datos: cliente REST tipado y reductor contra
el servidor simulado. El servidor de desarrollo y el navegador se apagaron al terminar; el puerto
3111 queda libre.

Panel de granja, texto real del panel lateral:

```text
Granjas · 1 en la explotacion
Granja del origen · 4 edificios · Con taller
105 celdas ocupadas en un area de 13 x 13
GARAJE 4 / 4      VIVIENDA 2 / 4
Silo (§27) 18.4 %            18.400 L de 100.000 L
Almacen de madera (§136) 0.0 %   Sin almacen construido
Garaje    6 x 8 celdas  4 / 4 plazas   4.800,00  Inspeccionar
Silo      4 x 4 celdas  100.000 L      6.000,00  Inspeccionar
Vivienda de trabajadores 4 x 4 celdas 2 / 4 plazas 3.000,00 Inspeccionar
Taller    5 x 5 celdas  Da acceso a la reparacion de maquinaria. 5.400,00 Inspeccionar
```

Las cifras cuadran con el catalogo sin literales: 105 celdas son 48 + 16 + 16 + 25 (GDD §116), y las
reventas son el 60 % de `RESALE_FACTOR_BP` sobre 8.000, 10.000, 5.000 y 9.000.

Paso uno, el catalogo con los dos precios de GDD §116:

```text
Garaje                   8.000,00   6 x 8 celdas · 4 plazas §96          con suelo 13.760,00
Silo                    10.000,00   4 x 4 celdas · 100.000 L §27         con suelo 11.920,00
Vivienda de trabajadores 5.000,00   4 x 4 celdas · 4 plazas §108         con suelo  6.920,00
Taller                   9.000,00   5 x 5 celdas · reparacion §29        con suelo 12.000,00
Almacen de madera       12.000,00   6 x 8 celdas · 500,00 m3 §136        con suelo 17.760,00
```

Paso dos: «Activar modo de colocacion» deja el paso en «Modo activo: elige el punto en el mapa», la
intencion del almacen de seleccion queda en `{ purpose: 'BUILDING', buildingType: 'GARAGE' }` y el
conjunto seleccionado sigue en **0 celdas**, es decir que armar el modo no selecciona ni compra nada.

Paso tres, con la huella situada en (157, 149) sobre pradera sin propietario:

```text
Garaje · Huella 6 x 8 celdas · 48 celdas · Colocacion valida
Capacidad: 4 plazas §96
Origen (157, 149) · 0 de 48 celdas ya son tuyas
Edificio (§116)              8.000,00
Suelo (48 celdas, §115)      5.760,00
Coste total                 13.760,00
Saldo tras la operacion     14.690,00
```

Tras confirmar, con la respuesta del servidor simulado ya reducida:

```text
Construido
Edificio        8.000,00
Suelo (48 celdas) 5.760,00
Total cobrado  13.760,00
Saldo          14.690,00
```

y la barra superior pasa de `SALDO 28.450,00` a `SALDO 14.690,00`, con el almacen de edificios en 5.
El desglose que el panel calculo y el que el servidor cobro coinciden importe a importe.

Nota sobre como se situo la huella: `pages/game.vue` todavia no monta el lienzo (apartado 2.3), de
modo que no hay escena que emita `canvas:pick` ni camino de streaming que cargue chunks. Para el
recorrido se cebo la cache de chunks con `ensureChunk`, que genera el terreno localmente desde la
semilla —que es exactamente lo que hace el renderizador (seccion 5.1 del plan)— y se escribio el
conjunto de celdas en el almacen de seleccion, que es lo que hara el enlace de la herramienta. El
resto del camino es el real: veredicto, precio, peticion, reductor e interfaz.

Inspector de edificio, los tres casos:

```text
Garaje    Ocupantes 4 de 4 plazas: TRACTOR 86 % WORKING · PLOW 79 % WORKING ·
          SEEDER 92 % IDLE · HARVESTER 9 % IDLE
          Retirar edificio deshabilitado: «El edificio conserva contenido asignado y no
          puede retirarse.»
Silo      Capacidad: 100.000 L §27 · Contenido 18.4 % · 18.400 L de 100.000 L en la granja
          Retirar edificio deshabilitado, por el mismo codigo: las existencias no cabrian
          sin el (discrepancia 2)
Taller    Capacidad: da acceso a la reparacion de maquinaria §29 · Reventa 5.400,00
          Retirar edificio > Confirmar retirada por 5.400,00 > «Edificio retirado.
          Reembolso 5.400,00»
```

Tras la retirada, la barra superior pasa de `SALDO 28.450,00` a `SALDO 33.850,00` y el almacen de
edificios baja de 4 a 3.

### 5.2 Que cubre cada suite

| Fichero | Cubre |
|---|---|
| `building-placement/__tests__/placement-plan.test.ts` (14) | Huella del catalogo y esquina noroeste; desglose de coste en los dos casos de propiedad del suelo y en el caso parcial, comparado contra `realBuildingCost` y `landPurchasePrice`; traduccion de `CELL_IN_USE`; terreno no construible antes que no comprable; arbol en pie; celda sin chunk como indecisa; huella de tamano equivocado; seleccion vacia; fondos insuficientes y gasto bloqueado por deuda |
| `building-placement/__tests__/building-placement.test.ts` (4) | Contra el servidor simulado y con la cache de chunks real: huella y coste pintados, motivo y boton deshabilitado sobre una huella ocupada, huella centrada en la celda que publica `canvas:pick`, y confirmacion que llega al servidor y mueve el saldo por el reductor |
| `farm-overview/__tests__/farm-overview.test.ts` (6) | Capacidades contadas y existencias fungibles leidas donde el modelo las guarda; listado de edificios con reventa; catalogo del paso uno con los dos precios de §116; paso dos entregando el modo por el puente sin mutar nada; fundacion de granja; boton deshabilitado sin nombre |
| `building-inspector/__tests__/building-inspector.test.ts` (7) | Estado vacio; tipo, capacidad de catalogo y reventa; contenido como existencias de la granja; ocupantes del garaje; las dos negativas de demolicion con `BUILDING_NOT_EMPTY`; y retirada real con reembolso |

---

## 6. Ordenes que no se han ejecutado

Ninguna que mute el repositorio fuera del ambito asignado: sin `git`, sin `npm install`, sin
`docker compose`, sin `prisma`, sin construcciones de produccion. Se ejecutaron `make sync-types`,
`npx vue-tsc`, `npx vitest run`, `npx nuxt dev --port 3111` y, sobre los tres directorios de este
ambito unicamente, `npx eslint --fix` y `npx prettier --write`. El servidor de desarrollo y el
navegador sin cabeza que se levantaron para el recorrido manual quedaron apagados antes de cerrar
esta nota, y el puerto 3111 libre.

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 2.1 `registry.test.ts` afirma «No implementado» para los veintitres paneles

Aplicado antes de W7, con la forma que esta nota propone.

El texto original de la nota:

Categoria: cambio en fichero congelado de otro agente
Ficheros afectados: `frontend/app/components/panels/__tests__/registry.test.ts`
Propietario del cambio: W3-C (cerrado), a aplicar por el agente de integracion de W7

La suite recorre `PANEL_IDS` y exige de cada panel que su texto contenga «No implementado» y el
identificador de su agente. Es correcto mientras los veintitres son andamiajes y deja de serlo en
cuanto uno se sustituye, que es el trabajo que esta fase existe para hacer. Al cerrar esta nota son
catorce los paneles con contenido real y nueve los que siguen siendo andamiaje.

Salida real (`npx vitest run`, en `frontend/`):

```text
 ❯ app/components/panels/__tests__/registry.test.ts (7 tests | 1 failed) 767ms
 FAIL  app/components/panels/__tests__/registry.test.ts > los stubs de panel >
       todos montan sin error de consola
 AssertionError: expected 'Inspector de celdaSin celda seleccion…' to contain 'No implementado'
 Test Files  1 failed | 32 passed (33)
      Tests  1 failed | 305 passed (306)
```

El fallo lo dispara el primer panel del indice que ya no es andamiaje, que hoy es `cell-inspector`;
los tres de este ambito lo dispararian igual. Las otras seis pruebas del fichero, que son las que
comprueban la forma del registro, siguen en verde y conviene conservarlas intactas.

Cambio a aplicar, que preserva el valor de la prueba en lugar de borrarla: partir el caso en dos,
uno que monte todos los paneles y afirme unicamente que ninguno emite error o aviso de consola y que
cada uno pinta su titulo, y otro que aplique las dos afirmaciones de andamiaje solo a los paneles que
todavia lo son, detectados por la presencia de `UiPendingPanel` en su marcado:

```ts
const isStub = wrapper.findComponent(UiPendingPanel).exists();
if (isStub) {
  expect(wrapper.text()).toContain('No implementado');
  expect(wrapper.text()).toContain(PANEL_REGISTRY[id].owner);
}
```

Mitigacion adoptada: ninguna posible sin escribir fuera del ambito. Igual que en el apartado 3.1 de
`NOTES-w4b.md`, editar un fichero de otro agente que varios de esta fase tocarian a la vez es
exactamente la perdida de trabajo que la regla 1 evita. Los tres paneles traen su propia suite y las
treinta y una pruebas estan en verde.

Nota sobre el montaje sin props: los tres paneles montan sin ninguna propiedad y sin error de
consola, que es lo que esa prueba comprueba de verdad. `building-inspector` sin `buildingId` pinta su
estado vacio, `building-placement` sin tipo pinta el suyo, y `farm-overview` sin granjas pinta el
suyo.

### 2.4 Etiquetas en espanol de los tipos de maquinaria y de los estados

Aplicado por W7-A (integracion). `BuildingInspectorPanel.vue` consume `labelOfMachineType`,
`labelOfMachineStatus` y `labelOfWorkerStatus` de los dos modulos de presentacion que W5-F escribio, en
lugar de mostrar el identificador del enumerado en tipografia monoespaciada.

El texto original de la nota:

Categoria: coordinacion entre fases, sin cambio en fichero ajeno
Propietario: W5-F (paneles de maquinaria y de trabajadores)

El inspector de edificio lista los ocupantes de un garaje y de una vivienda. El trabajador tiene
`name`, pero la maquina solo tiene `type`, y no existe en ningun sitio una tabla de etiquetas en
espanol para `MachineType` ni para `MachineStatus` o `WorkerStatus`. Este ambito muestra el
identificador del enumerado en tipografia monoespaciada, que se lee como un codigo y no como prosa,
en lugar de inventar una segunda tabla que W5-F tendria que duplicar. Cuando W5-F escriba la suya,
sustituir las dos lineas de `BuildingInspectorPanel.vue` que la usan es inmediato; conviene que esa
tabla viva donde los dos paneles puedan leerla.

`farm-overview/buildingPresentation.ts` es el equivalente para los edificios y lo consumen los tres
paneles de este ambito. Si W5-F o W6-D necesitan las etiquetas de edificio, esa es la ruta.

### 2.3 El enlace de `pages/game.vue` que esta fase necesita

Resuelto por el agente de costura de W5-W.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/pages/game.vue`
Propietario del cambio: W3-C (cerrado), a aplicar por W7

Ya pendiente por el apartado 1.1 de `NOTES-w4d.md` (montar el lienzo) y por el 1.5 de
`NOTES-w4g.md` (crear la herramienta y enlazar su puerto). Lo que este ambito anade es el contenido
de `PANEL_OF_MODE` para su modo y una precision sobre el nombre del metodo:

```ts
onConfirm: (snapshot) => {
  if (snapshot.intent.mode === 'BUILDING') {
    shell.openSidePanel('building-placement', { type: snapshot.intent.buildingType });
  }
},
```

`useShellUi` no expone ningun `openPanel`; los dos metodos reales son `openSidePanel(panelId, props)`
y `openModal(panelId, props, dismissible)`. El esbozo del apartado 1.5 de `NOTES-w4g.md` usa
`shell.openPanel`, que no existe.

Mitigacion adoptada mientras ese enlace no exista: el panel de colocacion escucha `canvas:pick` del
puente y compone la huella centrada en la celda escogida con `footprintCells` y `footprintOf` de
`game/selection/ghost.ts`, que son las mismas funciones con las que la herramienta dibuja el
fantasma. Cuando el enlace exista, las dos vias producen el mismo conjunto para la misma celda bajo
el cursor, de modo que no compiten: la herramienta escribe `replaceCells` con la huella centrada y
este panel tambien. El apartado 2.3 de `NOTES-w4g.md` ya avisaba de que la escena emite `canvas:pick`
tambien con un modo activo.

### 2.2 `building-placement` esta declarado modal y un modal le quita la entrada al lienzo

Aplicado antes de W7: la entrada `building-placement` del registro declara `surface: PanelSurface.SIDE`.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/components/panels/registry.ts`, entrada `building-placement`
Propietario del cambio: W3-C (cerrado), a aplicar por W7 si se decide

El registro declara `surface: MODAL` para el panel de colocacion. El arbitro de entrada de
`useShellUi` deriva `worldInputEnabled` de `modals.length === 0` y publica el veredicto por
`input:enabled`, y la herramienta de seleccion respeta `input:enabled` en todos sus caminos de
entrada (apartado 1.7 de `NOTES-w4g.md`). La consecuencia es exacta: con el panel de colocacion
abierto como modal, el fantasma no sigue al cursor y el clic no coloca nada, de modo que el panel que
acompana al modo de colocacion es el unico panel del registro que no puede vivir en la superficie que
el registro le asigna.

Cambio a aplicar, una linea: `surface: PanelSurface.SIDE` en la entrada `building-placement`, con
`tab: null`, que es lo que ya tiene.

Mitigacion adoptada, y funciona hoy sin tocar el fichero congelado: el panel de granja lo embebe como
paso tres de su flujo, que ocurre en el panel lateral, donde el lienzo conserva la entrada por diseno
(«el panel lateral no la quita, porque arrastrar una seleccion mientras el panel muestra su precio es
el flujo entero de la compra de tierra», apartado 1.5 de `NOTES-w3c.md`). Quien enlace la herramienta
de seleccion debe abrirlo con `openSidePanel` y no con `openModal` mientras el modo este activo.
