# NOTES-w5f

Agente de paneles de maquinaria y personal, fase W5. Ambito escrito:
`frontend/app/components/panels/{machinery,workers,labor-pool,market,starting-guide}/**` y este
fichero. Ningun fichero fuera de esos seis se ha modificado.

Los cinco paneles eran el andamiaje que W3-C dejo con el registro y los cinco estan sustituidos.
`settings`, que el registro atribuye a este agente, lo escribio W4-E; el apartado 3.1 de
`NOTES-w4e.md` y el apartado 3.6 de `docs/ownership.md` lo recogen. Con esta tanda quedan como
andamiaje los cinco paneles de W6-D: `task-assign`, `task-list`, `forestry`, `forest-plot` y
`welcome-back`.

---

## 1. Ficheros creados

```text
frontend/app/components/panels/machinery/machineryPresentation.ts   etiquetas, tonos y las tres negativas
frontend/app/components/panels/machinery/MachineryPanel.vue
frontend/app/components/panels/machinery/__tests__/machinery.test.ts
frontend/app/components/panels/workers/workerPresentation.ts        etiquetas de estado, habilidad y vivienda
frontend/app/components/panels/workers/WorkersPanel.vue
frontend/app/components/panels/workers/__tests__/workers.test.ts
frontend/app/components/panels/labor-pool/hiring.ts                 la decision de contratar, pura
frontend/app/components/panels/labor-pool/LaborPoolPanel.vue
frontend/app/components/panels/labor-pool/__tests__/labor-pool.test.ts
frontend/app/components/panels/market/sale.ts                       la decision de vender, pura
frontend/app/components/panels/market/MarketPanel.vue
frontend/app/components/panels/market/__tests__/market.test.ts
frontend/app/components/panels/starting-guide/steps.ts              la secuencia de §120, derivada
frontend/app/components/panels/starting-guide/StartingGuidePanel.vue
frontend/app/components/panels/starting-guide/__tests__/starting-guide.test.ts
docs/handoff/NOTES-w5f.md                                           este fichero
```

`frontend/app/components/panels/registry.ts` no se ha tocado.

---

## 2. Contrato que este ambito publica

Cinco modulos no son componentes y los leen otros paneles. Siguiendo la convencion de ADR-0037,
cada uno vive en el directorio de la materia a la que pertenece y no en un directorio nuevo que la
tabla de propiedad no atribuiria a nadie.

| Pieza | Ruta | Contenido |
|---|---|---|
| Maquinaria | `machinery/machineryPresentation.ts` | `MACHINE_TYPE_LABELS`, `MACHINE_ROLE_LABELS`, `MACHINE_STATUS_LABELS` y sus tonos; `MACHINE_TYPE_SECTIONS`; `MACHINE_TYPE_ORDER`; `conditionTone`; `assignabilityNote`; `garageOccupancy`; `purchaseBlockingCode`, `sellBlockingCode` y `repairBlockingCode` |
| Personal | `workers/workerPresentation.ts` | `WORKER_STATUS_LABELS` y sus tonos; `derivedSkillFactor`, `formatSkillFactor`, `skillAfterNextTask`, `isAtSkillCap`; `homeOccupancy`; `fireBlockingCode` |
| Contratacion | `labor-pool/hiring.ts` | `hireBlockingCode`, `payrollAfterHire`, `refreshCountdown` |
| Venta | `market/sale.ts` | `STORAGE_RESOURCE_LABELS`, `STORAGE_RESOURCE_SECTIONS`, `sellBlockingCode`, `clampQuantity` |
| Arranque | `starting-guide/steps.ts` | `startingSequence`, `stepStatus`, `isStepDone`, `evaluateSequence`, `startingBudget` |

**La tabla de etiquetas que `NOTES-w4f.md` 2.4 pedia esta en las dos primeras filas.** El inspector
de edificio muestra hoy el identificador del enumerado para `MachineType`, `MachineStatus` y
`WorkerStatus`; la sustitucion es de dos lineas y esta en el apartado 3.1.

Convenciones respetadas, para quien escriba los cinco paneles que quedan:

- Ninguna regla de dominio vive en un panel (ADR-0032). Las nueve negativas de este ambito son
  funciones puras que reproducen el orden de evaluacion del servidor modulo a modulo, y el texto
  del control inhabilitado es la entrada de `VALIDATION_MESSAGES` del codigo con el que el
  servidor rechazaria la peticion. Las pruebas afirman el codigo, nunca la frase.
- Todo importe se formatea con `useFormatting`. Ningun panel divide, redondea ni concatena un
  importe; la cantidad que viaja es siempre la unidad almacenada y la division a la unidad de
  presentacion usa el divisor que trae la linea de inventario.
- Las dos rutas de trabajadores no mueven dinero y por tanto no llevan clave de idempotencia, de
  modo que `stores/pending` nunca tendra una entrada suya: contratar y despedir marcan su
  operacion en curso con una referencia local. `POST /api/machines`, la venta de maquina, la
  reparacion y `POST /api/market/sell` si pasan por `pending`.
- Las dos rutas que mueven dinero con precio de catalogo envian `expectedTotal` (ADR-0034): la
  compra manda el precio del catalogo que el jugador esta mirando y la reparacion el
  `repairCost` que trae la fila.

---

## 3. Pendiente para otros agentes

### 3.3 La guia de arranque no es alcanzable desde su pestana

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/components/panels/registry.ts`, `PANEL_TABS`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

`starting-guide` esta declarado con superficie `SIDE` y pestana `help`, pero
`PANEL_TABS.help.defaultPanel` es `legend` y `TabBar` solo abre el panel por omision de la
pestana. Es el mismo hueco que W4-E encontro con `settings` (`NOTES-w4e.md` 1.4): el panel existe
y nadie lo abre.

Mitigacion adoptada, dentro del ambito: el panel de maquinaria lleva un boton «Guia de arranque»
en su cabecera, que es ademas donde tiene sentido —la compra de la cosechadora el dia uno es el
error que la guia existe para evitar— y la guia enlaza de vuelta con los cuatro paneles de sus
pasos. Si W7 prefiere una entrada en la barra superior o un submenu de pestana, retirar el boton
es una linea.

### 3.4 El reductor no aplica los contadores de plaza que traen las respuestas

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/stores/sync.ts`, tabla `RESULT_APPLIERS`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

Cuatro respuestas del contrato traen `garageSlotsUsed`/`garageSlotsTotal` o
`homeSlotsUsed`/`homeSlotsTotal`, y el reductor no tiene aplicador para ninguno de esos nombres.
El contador vive en la fila del edificio y solo llega por la trama `BUILDING_UPSERTED`, que las
cuatro rutas si declaran. Consecuencia: un cliente sin socket vivo —el arnes de pruebas, o una
pestana cuya conexion se cayo— conserva el garaje lleno despues de vender una maquina y la
vivienda llena despues de un despido, y niega la operacion siguiente que el servidor aceptaria.
Ninguna de las dos rutas emite `FARM_UPSERTED`, de modo que `farm.machineSlots` y
`farm.workerSlots` tampoco se refrescan y son la cifra de la ultima instantanea.

Mitigacion adoptada, sin tocar el reductor ni escribir en ningun almacen: `garageOccupancy` y
`homeOccupancy` cuentan la ocupacion sobre las entidades que llevan su ubicacion —`Machine.garageId`
y `Worker.homeId`, que es exactamente el hecho que cuenta el disparador de ADR-0018— y toman la
capacidad de los edificios. Las maquinas y los trabajadores si viajan en el resultado de la
mutacion, de modo que la cuenta se mueve con la respuesta. Las dos lecturas coinciden por
construccion; cuando no pueden, la de las entidades es la mas reciente y la discrepancia se
resuelve sola en la siguiente trama.

El arreglo limpio es una fila mas en `RESULT_APPLIERS` que aplique el edificio, o que las cuatro
rutas devuelvan el edificio en lugar de dos enteros sueltos, que es lo que ya hacen las rutas de
granja.

### 3.5 El consumo por hora de la barra superior no se refresca al contratar

Categoria: observacion sobre el contrato, sin cambio urgente
Ficheros afectados: `shared/api/routes.ts`, `emits` de `POST /api/workers/hire` y de
`POST /api/workers/:workerId/fire`
Propietario del cambio: W2 (cerrado), a valorar por W7-A o W7-E

Comprobado en el navegador: tras contratar, el panel de trabajadores pasa a 44,75 / h y la barra
superior sigue mostrando 97,75 / h. Las dos rutas emiten `WORKER_UPSERTED`, `WORKER_POOL_UPSERTED`
y `BUILDING_UPSERTED`, pero no `PLAYER_UPSERTED`, y `holdingCostPerGameHour` vive en la fila del
jugador. La cifra se corrige en el siguiente avance del jugador, de modo que no es un error de
saldo, solo una lectura que se queda atras.

Hay dos salidas y las dos son de otro ambito: anadir `PLAYER_UPSERTED` a los `emits` de las dos
rutas, o que la barra superior use `player.localHoldingRate`, que ya existe en el almacen del
jugador precisamente para esto y se recalcula con la regla compartida sobre la plantilla y la
maquinaria que el cliente tiene.

---

## 4. Verificacion, salida real

### 4.1 Ordenes

| Orden | Salida |
|---|---|
| `make typecheck` | **exit 0**. `tsc` en shared y backend sin salida; `vue-tsc --build --force` del cliente en verde |
| `make lint` | **exit 0**. `npx eslint .` sin hallazgos, incluidas las reglas de zona; Prettier: «All matched files use Prettier code style!» |
| `npx vitest run` sobre los cinco directorios de este ambito | **5 ficheros, 52 pruebas en verde**, 8,79 s |
| `npx vitest run` completo del cliente | **51 ficheros, 512 pruebas: 511 en verde y 1 en rojo**, la del apartado 3.2 |
| `npx vitest run` de `shared/` | 23 ficheros, 418 pruebas en verde |

No se ha ejecutado `git`, `npm install`, `prisma`, `docker compose` ni ninguna construccion de
produccion. `make typecheck` y `make lint` ejecutan `sync-types` como prerrequisito, de modo que
las dos copias de `shared/` quedaron actualizadas; ambas estan en `.gitignore`.

### 4.2 Recorrido manual en el navegador

Entorno: Chrome 151 sin cabeza, ventana 1440x900, ruta `/game?mock=1&mockSession=1`, es decir el
camino real de datos: cliente REST tipado, reductor de tramas y socket contra el servidor
simulado. Los paneles se condujeron desde el protocolo de depuracion, pulsando los mismos
controles que pulsaria el jugador. **Ningun error de consola durante todo el recorrido**; los
unicos mensajes son el aviso del servidor simulado, los de Vite y los de Pinia.

Nota sobre el servidor de desarrollo: al ir a levantarlo, `npx nuxt dev --port 3111` respondio
«Another Nuxt dev is already running (PID 418663)», que es el cerrojo global de Nuxt sobre un
servidor que ya habia levantado otro agente de esta misma fase en ese mismo puerto. El recorrido
se hizo contra el, sin levantar un segundo servidor, y por tanto **no se ha apagado**: es de quien
lo levanto. Lo que si se levanto y se apago aqui es el navegador sin cabeza; comprobado que el
puerto 9223 ya no responde.

| Panel | Como se llego | Lo que devolvio |
|---|---|---|
| `machinery` | Pestana Maquinaria | Parque 4 maq., plazas de garaje 4 / 4, mantenimiento 37,00 / h, operacion 22,00 / h, reventa 20.046,60. Tractor «Trabajando», condicion 86.0 %, «Asignada a Elena Prado · Arar», reparacion 756,00 · 3.5 h. Cosechadora al 9.0 % con «Por debajo del 10 % no admite asignacion (§91)» y reparacion 11.466,00 · 22.8 h. Catalogo con los ocho tipos y su seccion; las ocho compras inhabilitadas con «No queda plaza libre de garaje.» |
| `starting-guide` | Boton «Guia de arranque» de maquinaria | Progreso 10 / 11, setup minimo 146.100,00, colchon 13.900,00. «Sostener las cinco maquinas desde el dia uno cuesta 25.688,78 durante el ciclo de 325 h; comprandolas cuando hacen falta, 20.006,22. La diferencia, 5.682,56 [...] frente a un ingreso previsto de 2.475,00 por ciclo.» En «Todavia no», «Comprar remolque · 7.200,00 · Se necesita a las 227 h del ciclo, cuando el campo llegue a Listo para cosechar» |
| `workers` | Pestana Personal | Plantilla 2, plazas de vivienda 2 / 4, coste salarial 38,75 / h, habilidad media 62.5 %. Elena Prado «Trabajando», 24,55 / h, habilidad 74.0 %, «Factor x0.87 · 4 tareas completadas · tras la siguiente, 75.0 %», «Arar · termina en 1 d 23 h», despido inhabilitado con «El trabajador no esta disponible.» Marc Ferrer «Ocioso» con el despido activo |
| `labor-pool` | Boton «Ver candidatos» | Candidatos 3, proximo refresco 1 d 23 h, plazas de vivienda 2. Ana Soler x0.66 pide 6,00 / h, coste tras contratar 44,75 / h; Bruno Vidal x0.79; Carla Ruiz x0.90. Contratar a Ana: el pool baja a 2, la plantilla sube a 3, las plazas a 1 y el coste salarial a 44,75 / h |
| `market` | Pestana Economia | Trigo §123 a 0,22 / L, ocupacion 18.4 %, 18.400 L de 100.000 L, valor 4.048,00. Madera §133 a 45,00 / m3, sin existencias, venta inhabilitada con «La cantidad debe ser mayor que cero.» Elegidos 5000 L, la previsualizacion dice 1.100,00; tras vender, «Vendidos 5000 L por 1.100,00», existencias 13.400 L y saldo 28.450,00 -> 29.550,00 en el panel y en la barra superior |

Las 325 h del ciclo, las 227 h de la cosechadora y las tres cifras del presupuesto no estan
escritas en ningun sitio del cliente: salen de `cyclePhases`, `setupCost` y `balanceKpis` de
`shared/rules/balance.ts`, que son las funciones con las que `tools/balance` emite el informe de
§125.

### 4.3 Que cubre cada suite

| Suite | Pruebas | Que fija |
|---|---|---|
| `machinery` | 13 | El orden de las tres negativas (garaje antes que deuda antes que saldo; taller antes que estado de la maquina); los dos umbrales de condicion del catalogo; las ocho etiquetas de tipo y las cuatro de estado; el parque con nombre y estado en castellano y sin identificador de enumerado; el garaje lleno bloqueando las ocho compras; la maquina reservada que no se vende; la venta que libera plaza y desbloquea la compra que cabe en el saldo mientras la cosechadora sigue bloqueada por importe; la reparacion que cobra la formula de §93 y deja la maquina en el taller; la entrada a la guia |
| `workers` | 10 | Los seis estados con etiqueta; el despido solo en estado ocioso; el factor de habilidad en los tres nodos de §103 y el formato `x0.87`; el techo de §103; la ocupacion de vivienda contada sobre la plantilla; la plantilla con habilidad, salario y estado; el factor derivado identico al que trae la fila; el despido que retira al trabajador y libera la plaza; la apertura del pool |
| `labor-pool` | 10 | El orden de las tres negativas de la contratacion; el coste salarial previsto; la cuenta atras acotada en cero; los tres candidatos con habilidad, factor y salario pedido; el refresco como duracion; la contratacion que retira del pool y suma a la plantilla; llenar la vivienda hasta que el ultimo candidato queda bloqueado con `HOME_CAPACITY_EXCEEDED` |
| `market` | 9 | Las dos negativas de la venta y el acotado a entero; las etiquetas de los dos recursos; el precio del contrato igual al del catalogo; existencias, capacidad y valor de mercado; la previsualizacion calculada con `cropSaleRevenue`; la venta que abona exactamente ese importe; la linea sin existencias con su motivo |
| `starting-guide` | 10 | La secuencia cubre el setup de §117 y nada mas, con el tractor una sola vez; la cosechadora entre 200 y 250 h y desde `READY_TO_HARVEST`; sin campo solo la maquinaria de la primera operacion esta en su momento; el estado del campo hace avanzar la secuencia; un paso cumplido se lee de la explotacion; el presupuesto de §117 reproducido celda a celda (330 celdas, 39.600, 23.000, 83.500, 146.100, colchon 13.900); la compra escalonada ahorra; el panel marca 10 / 11 y presenta el remolque como «Todavia no» |

---

## 5. Material para el ADR

Lo redacta el agente de cierre de la fase. Decisiones de este ambito que conviene que recoja; la
numeracion de W5 es 0039-0041 segun el apartado 3.3 de `docs/ownership.md`.

1. **La negativa de un control es el orden de evaluacion del servidor, no una condicion escrita en
   el panel.** ADR-0032 fijo que el motivo es el `ValidationCode`; esta tanda anade que tambien lo
   es el *orden*. Un garaje lleno y un saldo insuficiente son ciertos a la vez muy a menudo, y el
   servidor responde siempre el primero: si el panel eligiera el otro, el jugador leeria un motivo,
   liberaria saldo y seguiria bloqueado. Las nueve funciones de este ambito reproducen el orden
   modulo a modulo y lo declaran en su comentario, y las pruebas construyen a proposito las
   situaciones en las que dos motivos son ciertos para fijar cual gana.

2. **La ocupacion se cuenta sobre la entidad que lleva su ubicacion, no sobre el contador del
   edificio.** El contador es la autoridad y es lo que defiende el `CHECK` de ADR-0018, pero solo
   llega al cliente por trama; `Machine.garageId` y `Worker.homeId` viajan en la respuesta de la
   mutacion y son el mismo hecho. Contar sobre ellos hace que la plaza liberada por una venta o un
   despido se vea sin socket, sin que ningun panel escriba en un almacen. Apartado 3.4.

3. **La guia de arranque no transcribe §117 a §120: los recalcula.** El presupuesto sale de
   `setupCost`, el instante en que cada maquina hace falta sale de `cyclePhases`, y el ahorro de la
   compra escalonada es `balanceKpis` sobre el mismo escenario con los dos modos de propiedad. Las
   146.100 y el colchon de 13.900 coinciden con el GDD, y las «unas 230 h» de §120 salen 227,3 h.
   El valor de esto no es la exactitud: es que el dia que cambie una velocidad de trabajo o una
   duracion de fase, la guia se mueve con el balance en lugar de mentir con conviccion.

4. **La secuencia de arranque no tiene estado propio.** Cada paso se comprueba contra los almacenes
   —hay granja, hay garaje, hay campo, hay tractor— y la frontera entre «ahora» y «todavia no» es
   el estado proyectado del campo cruzado con `fromCropStates` de la tabla de §90. No hay marca de
   progreso que guardar, que reiniciar ni que sincronizar, y un jugador que compro el silo en otra
   sesion lo encuentra marcado. La alternativa, un contador de onboarding persistido, es estado que
   puede discrepar del mundo y que no aporta nada que el mundo no diga ya.

5. **Contratar y despedir no pasan por el almacen de operaciones optimistas.** No mueven dinero, no
   llevan clave de idempotencia y por tanto `stores/pending` nunca tendra una entrada suya; lo que
   protege la contratacion de un doble envio es que el candidato sale del pool
   (`CANDIDATE_NOT_AVAILABLE`). Un panel que consultara `isSubjectBusy` para estas dos rutas
   obtendria siempre `false` y el jugador no veria nada mientras la peticion vuela.

6. **La previsualizacion de un ingreso usa la regla compartida y no el precio del cable.** El
   almacen de mercado publica las dos: `valueOf` multiplica el precio cotizado y `revenueOf` llama
   a `cropSaleRevenue` y `woodSaleRevenue`, que son las funciones con las que el servidor escribe
   el asiento. El panel usa la segunda, de modo que la cifra previsualizada y la cifra del ledger
   son la misma por construccion y no por coincidencia aritmetica.

---

## 6. Discrepancias detectadas

### 6.1 El registro y el brief siguen sin repartir los mismos paneles

`registry.ts` declara `owner: 'W5-F'` para `settings`, que escribio W4-E, y `owner: 'W6-D'` para
`notices`, que tambien escribio W4-E. Este agente ha escrito los cinco que su brief le asigna. El
registro esta congelado y no se ha tocado; el apartado 3.6 de `docs/ownership.md` ya recoge el
reparto real y la fila 26 del apartado 5 de las erratas, la discrepancia. Se repite aqui solo
porque el campo `owner` sigue sin describir quien escribio siete de las veintitres entradas.

### 6.2 `§117` dice «Worker skill ~60 %» y el escenario de balance usa 70 %

Ya registrado por W2 en el comentario de `MINIMUM_SETUP_SCENARIO`: con 60 % las duraciones de §118
no salen, con 70 % si. La guia de arranque hereda el escenario tal cual y no lo corrige, de modo
que las 227 h que publica son las de un operario al 70 %. Es coherente con el informe de balance,
que es lo que importa, y esta anotado aqui porque un lector que compare la guia con la frase de
§117 encontrara la diferencia.

### 6.3 El coste de operacion del parque se muestra sobre las maquinas que trabajan

`machines.operatingPerGameHour` suma solo las maquinas en estado `WORKING`, que es lo que dicen
§94 y §107. En el mundo de ejemplo son el tractor y el arado, y el arado tiene coste de operacion
cero por el catalogo literal de §89, de modo que el panel muestra 22,00 / h y no 37,00. No es un
error: es la consecuencia, ya documentada en el plan y en el informe de balance, de que los aperos
no lleven costes propios en §89 mientras §118 supone unos 70 $/h combinados.

### 6.4 El precio de la madera del servidor simulado

El simulado cotiza la madera con `MOCK_WOOD_PRICE_PER_DM3`, derivado de los 45 $/m3 de §133, y el
panel lo muestra correctamente como 45,00 / m3. La granja del mundo de ejemplo no tiene almacen de
madera, de modo que la capacidad es cero y la linea entera es el caso vacio. La venta de madera de
extremo a extremo no es ejercitable contra el simulado hasta que exista un almacen; queda cubierta
por las pruebas puras de `sale.ts` y por el camino comun con el trigo.

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 3.6 El servidor simulado no aplica `expectedTotal`

Aplicado por W7-A (integracion). `expectedTotalMismatch` de `frontend/app/mock/handlers.ts` compara el
total declarado con el suyo en la compra y en la reparacion, y devuelve `VALIDATION_FAILED` sobre
`body.expectedTotal` con `expected` y `actual`, que es lo que el servidor real responde.

El texto original de la nota:

Categoria: cambio en fichero de otro agente
Ficheros afectados: `frontend/app/mock/handlers.ts`, `POST /api/machines` y
`POST /api/machines/:machineId/repair`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

Los dos manejadores ignoran `expectedTotal`, mientras que el servidor real compara y devuelve un
400 que nombra el campo cuando el precio se ha movido (`backend/src/modules/machinery/service.ts`).
El panel envia el campo en los dos casos, de modo que es mas estricto que el simulado y coincide
con el real; lo que no puede es ejercitar el rechazo contra el simulado. Es la misma clase de
diferencia que las filas 28 y 29 del apartado 5 de `docs/erratas-gdd-stack.md`.

### 3.2 `registry.test.ts` agota el limite de cinco segundos al montar los veintitres paneles

Aplicado antes de W7: `MOUNT_ALL_TIMEOUT_MS = 30_000` en las dos pruebas que montan los veintitres.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/components/panels/__tests__/registry.test.ts`, o
`frontend/vitest.config.ts`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

Es el unico rojo que deja esta fase y no es un defecto de ningun panel. La prueba «todos montan
sin error de consola» recorre `PANEL_IDS`, resuelve el componente asincrono de cada uno y lo
monta; con trece paneles implementados ya rozaba el limite por omision de Vitest y con dieciocho
lo cruza. Salida real:

```
FAIL  app/components/panels/__tests__/registry.test.ts > los paneles registrados > todos montan sin error de consola
Error: Test timed out in 5000ms.
```

Medicion, para que el diagnostico no sea una conjetura. Con un proceso frio, importar y montar los
veintitres paneles cuesta 10,9 s, de los cuales 5,1 s son el primer `import()` —que arrastra la
transformacion de `shared/`, de los almacenes y de la capa `ui` entera— y 1,0 s los cinco paneles
de este ambito. Con la cache de transformacion de Vite caliente, el mismo bucle baja a 5,2 s, que
sigue por encima del limite. La segunda prueba del mismo fichero, que vuelve a montar los
veintitres, pasa en decimas: la diferencia es enteramente el coste de transformacion, no el de
montaje.

Cambio a aplicar, un tercer argumento en la prueba:

```ts
it('todos montan sin error de consola', async () => {
  // ...
}, 30_000);
```

o, mejor, `testTimeout: 30_000` en el bloque `test` de `frontend/vitest.config.ts`, que ademas
cubre a W6-D cuando implemente los cinco paneles que faltan y vuelva a subir el coste.

No se ha tocado por el mismo motivo por el que W4-E y W4-F se abstuvieron: es el punto de
encuentro de los agentes de paneles de W4, W5 y W6, y `vitest.config.ts` es fichero de
configuracion del cliente. Las cincuenta y dos pruebas de este ambito estan en verde, y de las
460 restantes del cliente solo falla esta.

### 3.1 El inspector de edificio sigue mostrando el identificador del enumerado

Aplicado por W7-A (integracion), con las tres sustituciones que la nota escribe.

El texto original de la nota:

Categoria: cambio en fichero de otro agente
Ficheros afectados: `frontend/app/components/panels/building-inspector/BuildingInspectorPanel.vue`,
lineas de la lista de ocupantes
Propietario del cambio: W4-F (cerrado), a aplicar por W7-A

Es la nota que `NOTES-w4f.md` 2.4 dejo para este ambito. La tabla ya existe; el cambio es
sustituir dos expresiones:

```vue
<!-- en la lista de maquinas -->
<span class="fw-mono">{{ machine.type }}</span>
<!-- pasa a -->
<span>{{ labelOfMachineType(machine.type) }}</span>

<!-- y en las dos listas, el estado -->
{{ machine.status }}   ->  {{ labelOfMachineStatus(machine.status) }}
{{ worker.status }}    ->  {{ labelOfWorkerStatus(worker.status) }}
```

con

```ts
import {
  labelOfMachineStatus,
  labelOfMachineType,
} from '~/components/panels/machinery/machineryPresentation';
import { labelOfWorkerStatus } from '~/components/panels/workers/workerPresentation';
```

No se ha aplicado porque el fichero es de W4-F y la regla 1 de la seccion 11 del plan lo pone
fuera de este ambito.
