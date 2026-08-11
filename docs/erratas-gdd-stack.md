# Erratas y contradicciones del material de partida

Estado: vigente desde el cierre del flujo de trabajo W2.

Las contradicciones de los apartados 1.1 a 1.9 y 2.1 a 2.30 se identificaron durante la planificacion.
Las de los apartados 1.10 y 2.31 a 2.40 se detectaron al implementar y estan marcadas como tales; el
apartado 4 recoge las desviaciones numericas medidas, que son la comprobacion empirica de varias de las
anteriores.

Ninguno de los dos documentos de partida se modifica. El GDD v0.4
(`docs/GDD_Farming_Management_Simulator_Online_v0.4.md`) y el documento de stack (`docs/stack.md`)
se conservan tal como se recibieron. Este documento recoge las contradicciones detectadas entre
ambos, y dentro de cada uno, junto con la resolucion adoptada. Las decisiones de arquitectura que
esas resoluciones provocan se registran en `docs/adr.md`.

Criterio general aplicado al balance: las constantes de catalogo del GDD (§82, §89, §115, §116,
§117, §133) son autoritativas y se implementan literalmente. Los numeros derivados de §118, §119 y
§138 que no se reproducen con esas constantes se documentan como no reproducibles en el informe de
balance de `docs/balance/`, sin ajustar nada.

---

## 1. Contradicciones del documento de stack

| N. | Contradiccion | Resolucion adoptada |
|---|---|---|
| 1 | §1, §5.3 y §7.4 describen npm sin workspaces; §11 describe un monorepo con pnpm workspaces | npm sin workspaces, por decision del usuario. Cuatro proyectos npm independientes: raiz (solo herramientas de lint y formato), `shared/`, `backend/` y `frontend/`. El riesgo de divergencia entre copias de `shared/` se mitiga con `sync-types` como prerrequisito de `dev`, `build`, `test` y `lint`, y con `check-shared-sync` fallando en integracion continua. Registrado en ADR-0001 |
| 2 | §11 situa `prisma/` en la raiz; §7.4 ejecuta `cd backend && npx prisma` | `backend/prisma/`. El esquema pertenece al proyecto que lo consume y que tiene el cliente instalado |
| 3 | §11 declara `apps/worker/` como paquete propio; §7.1 dice "mismo codigo que backend" | Un solo proyecto `backend/` con dos puntos de entrada, `src/server.ts` y `src/worker.ts`, una sola imagen y dos servicios de Compose que se distinguen unicamente por `command`. Registrado en ADR-0003 |
| 4 | §1 y §7.1 fijan la observabilidad desde el inicio; §10 la aplaza a la fase 2 y §14 la excluye del MVP | Se separan las dos mitades. Pino, `/health` y `/metrics` forman parte del servicio y estan presentes siempre. Prometheus y Grafana viven en `docker-compose.obs.yml` bajo el perfil `obs`, de modo que su coste de mantenimiento no compite con el desarrollo. Registrado en ADR-0004 |
| 5 | §2.4 admite TypeBox y Zod indistintamente | Zod. Un mismo esquema sirve de validacion en Fastify via `fastify-type-provider-zod`, de tipo por inferencia y de validacion previa en los formularios de Vue, lo que evita escribir la misma regla dos veces. Se registrara en ADR-0006, en la fase W2 |
| 6 | §2.2 recomienda `fastify-type-provider-typebox`; la resolucion anterior obliga a Zod | Se usa `fastify-type-provider-zod`. Consecuencia de la contradiccion 5, no una decision independiente |
| 7 | §4.4 afirma que no hace falta un proceso batch para la simulacion offline; §4.2 hace depender la puntualidad de trabajos vivos en Redis | Redis solo contiene despertadores. La lista autoritativa de lo que debe ocurrir es la tabla `ScheduledEvent` en PostgreSQL, y `sim.reconcile` reencola lo vencido al arrancar y de forma periodica. Con este diseno la afirmacion de §4.4 es cierta; sin el, perder Redis perderia progreso. Se registrara en ADR-0016, en la fase W3 |
| 8 | §7.1 dibuja el frontend como "build estatico servido por Caddy"; el desarrollo necesita servidor con recarga | Dos ficheros de Caddy. `infra/caddy/Caddyfile` delega en el servidor de desarrollo de Nuxt; `infra/caddy/Caddyfile.prod` sirve el estatico desde un volumen nombrado que publica un servicio de un solo uso. Un unico fichero no puede cubrir ambos casos porque la sustitucion de variables de entorno de Caddy opera sobre un token y no sobre una directiva completa |
| 9 | §9 propone Playwright como opcional de fase 2; el plan exige verificacion de extremo a extremo | La verificacion de extremo a extremo se hace con `make smoke`, que recorre el bucle completo por HTTP contra la pila real con el multiplicador de tiempo acelerado. No se introduce Playwright: el valor esta en ejercitar el mecanismo real de retardo de la cola, no en automatizar el navegador |
| 10 | §3.3 describe Prisma como "cliente TypeScript autogenerado y type-safe" autosuficiente. Prisma 7.9.1 no lo es (detectado al implementar) | Prisma 7 elimino el motor de consultas binario: `new PrismaClient()` exige `{ adapter }`, y para PostgreSQL hace falta `@prisma/adapter-pg`. Tampoco existe ya el generador `prisma-client-js`: solo `prisma-client`, con `output` obligatorio, que emite TypeScript. El contrato real completo esta en `backend/prisma/README.md`, apartado 2, y en ADR-0009. El adaptador falta en `backend/package.json`, que es fichero congelado, y lo aplica W7-A |

---

## 2. Contradicciones y huecos del GDD

| N. | Punto del GDD | Problema | Resolucion adoptada |
|---|---|---|---|
| 1 | §82 frente a §84 y §119 | `weedGrowthRate` de 0,6 %/h implica 195 % en 325 h, no el 20 % que afirma §119 | Se implementa 0,6 %/h con saturacion en 100. Consecuencia aceptada: penalizacion del 50 % al cosechar trigo sin cultivar. Se registra como hallazgo principal del informe de balance, y `CULTIVATE`, opcional para el trigo segun §82, adquiere uso estrategico real: resetear malezas |
| 2 | §76, §80, §82, §84, §118 | La duracion de las fases del ciclo nunca se define | `phaseDurations = { SEEDED: 6, GERMINATING: 12, GROWING: 78 }`, total 96 h de juego, que preserva a la vez el `growthDuration` de §82 y el ciclo de 325 h de §118 |
| 3 | §89 frente a §107 y §114 | `maintenanceCost` descrito como coste "idle" frente a `operatingCost` "working": no se aclara si son aditivos o excluyentes | Aditivos, conforme a §107 y §114, que son explicitos al respecto |
| 4 | §89 frente a §118 | Los implementos no tienen `maintenanceCost` en el catalogo; §118 usa unos 70 $/h combinados y del catalogo salen 37 $/h | Catalogo literal: implementos a 0. La diferencia se documenta en el informe de balance |
| 5 | §36, §102, §117 | Salarios incoherentes: 30 $/h, 12-31 $/h y 15 $/h | La regla procedural de §102 es la autoritativa para el pool de contratacion. Los valores de §36 y §117 se documentan como no reproducibles |
| 6 | §93, §95 | `wearRatePerHour` nunca se define, y un `conditionFactor` de 0 daria duracion infinita | Tasas inventadas por tipo, documentadas como tales: 0,15 %/h en tractor e implementos, 0,25 %/h en cosechadora, 0,30 %/h en maquinaria forestal. Suelo de 0,2 en `conditionFactor` y rechazo de asignacion por debajo del 10 % de condicion |
| 7 | §91 | `conditionFactor` da tres puntos no colineales y no define nada por debajo del 10 % | Tabla de nodos `[0, 0.2] [10, 0.4] [50, 0.75] [100, 1.0]` con interpolacion lineal, resuelta por la misma funcion de curvas que el resto del balance |
| 8 | §77 frente a §86 | La fertilidad solo baja; sin via de restauracion el jugador queda sin tierra util en unos seis ciclos | §77 admite el barbecho como via de restauracion: regeneracion lenta mientras el campo esta en `VIRGIN`, con el mismo patron perezoso que las malezas |
| 9 | §83, §97 | No define que ocurre si el silo se llena al cosechar, y el caso sucede sin el jugador delante | Aviso al asignar la tarea, llenado hasta capacidad al completar, desperdicio del resto con asiento contable y linea en el resumen de regreso |
| 10 | §116 frente a §117 | Aplicar `realBuildingCost` literalmente cobra el suelo dos veces | §116 es ayuda de planificacion. El precio transaccional es `purchasePrice` si el suelo ya pertenece al jugador, y compra las celdas al precio de §115 si no |
| 11 | §93, §29, §95, §117 | La reparacion no tiene duracion, exige un taller que el jugador no puede pagar al arrancar, y `IN_REPAIR` no lo usa nadie | La reparacion es un evento agendado con duracion proporcional a los puntos a restaurar, exige taller y activa `IN_REPAIR`. No consume trabajador |
| 12 | §106, §111 | La cancelacion no dice si se reembolsa lo ya operado ni si se aplica desgaste | No se reembolsa, el desgaste se aplica prorrateado, y `Task` distingue `scheduledEndGameMs` de `endedGameMs` |
| 13 | §131, §133 | Cuatro fases tienen tres fronteras: con 240 h por fase, `OLD_GROWTH` se alcanza a las 720 h, no a las 960 h | Fronteras en 240, 480 y 720 h. Las 960 h de §133 se documentan como lectura erronea del propio documento |
| 14 | §130 frente a §140 | `growthStage` y `woodVolume` aparecen como columna y como derivado a la vez | Derivados, nunca almacenados: se calculan de `plantedAtGameMs`, la especie y el reloj |
| 15 | §132 | `FELLED` se describe como estado y como borrado simultaneamente | Borrado logico con `felledAtGameMs`: la fila permanece con estado `FELLED`, que queda ademas reservado para "talado y pendiente de transporte" cuando el `FORWARDER` de §134 pase de requisito de posesion a restriccion activa. Las consultas de arboles en pie filtran por estado |
| 16 | §31 frente a §83 | Con varias granjas no se dice a que silo va la cosecha | `Field.farmId` como granja que da servicio, y destino explicito en la tarea. Igual para la parcela forestal y el almacen de madera |
| 17 | §117, §118 | El setup minimo no costea la semilla, aunque la sembradora siembra de la nada | Se modela el tipo de asiento correspondiente (`SEED_PURCHASE`) como reservado, para que sea una palanca de balance disponible sin migracion, sin activarlo. Activarlo empeoraria un balance ya deficitario |
| 18 | §52 frente a stack §4.4 | "Simular al jugador hacia adelante" frente a "no hace falta proceso batch" | No existe marca de simulacion por jugador. Existen `lastAccrualGameMs` y marcas por atributo, de modo que liquidar uno no descarta el tiempo transcurrido del otro |
| 19 | §61 | Muestra "Day 18 / Spring / 2x" con reloj global, y las estaciones estan fuera del MVP | Se anade `startedAtGameMs` al jugador para mostrar su propio dia. Sin estacion. El multiplicador se muestra en solo lectura |
| 20 | §51, §120, §61 | No define quien controla el multiplicador de tiempo | Configuracion de servidor, no del jugador. Cambiarlo altera el consumo de caja de todos los jugadores a la vez, por lo que es una operacion de dominio (`retimeWorld`) y no una actualizacion de configuracion |
| 21 | §102 | `poolRefreshInterval` aparece sin valor ni unidad | 48 horas de juego, por coherencia con el resto del dominio, cuyas magnitudes estan todas en horas de juego |
| 22 | §17, §19 | "Formas arbitrarias" sin herramienta definida | Rectangulos combinables con union, resta y conmutacion celda a celda, con un tope compartido de 2.000 celdas entre cliente y servidor |
| 23 | §13 frente a §76 y §85 | El estado del ciclo agricola figura como atributo de celda y de campo | Vive solo en `Field`. Duplicarlo por celda multiplicaria por entre 250 y 2.000 el coste de cada transicion |
| 24 | §98 y §101 frente a §111 | El vinculo trabajador-maquina se propone como dos punteros cruzados y ademas como tarea | La `Task` es el unico vinculo autoritativo (`Task.workerId` mas `TaskMachine`). Se eliminan los dos punteros cruzados porque son dos fuentes de verdad del mismo hecho y se desincronizan; el estado se deriva |
| 25 | §98 | `location` de la maquina es "garageId o farmId", ambiguo | `Machine.farmId` obligatorio como pertenencia y `garageId` opcional como ubicacion fisica asignada por el servidor, lo que permite validar la capacidad por edificio |
| 26 | §108 | La restriccion de alojamiento se formula como suma por granja | Se aplica por edificio, que es mas fuerte, y como §101 ya exige `homeId`, la suma por granja queda satisfecha por construccion |
| 27 | §139 | Sugiere modelar la habilidad como mapa desde el inicio | Se rechaza. Anadir una columna en PostgreSQL es inmediato, mientras que un campo JSON cuesta seguridad de tipos de forma permanente en el camino caliente del calculo de duracion. Si se reservan en cambio, de forma agresiva, valores de enumerado |
| 28 | — | El GDD no define la quiebra, y con sus valores sin ajustar el saldo negativo es el estado esperado del primer ciclo | Deuda como estado derivado `IN_DEBT` que bloquea gasto discrecional pero no vender ni asignar tareas; interes de descubierto con tasa cero por defecto; liquidacion forzosa por encima de un umbral, en orden determinista y publicado; `BANKRUPT` reservado sin activar |
| 29 | — | El GDD no define donde empieza un jugador nuevo | Asignador determinista de origen que garantiza al menos 400 celdas de pradera contiguas |
| 30 | — | El GDD no fija la escala del mundo, necesaria para renderizar y para el rendimiento | Una celda son 10 x 10 m, un chunk 320 m, y 16 px por celda a zoom 1. Con ello las 250 celdas de §117 son 2,5 ha y los 90 L/celda de §119 equivalen a 9.000 L/ha de trigo, que es un valor realista |

Contradicciones detectadas al implementar, no previstas en la planificacion:

| N. | Punto del GDD | Problema | Resolucion adoptada |
|---|---|---|---|
| 31 | §110 frente a §91 | El ejemplo narrativo es inconsistente consigo mismo y con la tabla de §91. Usa 0,95 directamente como `conditionFactor` para una maquina al 95 % de condicion, mientras que la tabla de §91 interpola a 0,975; y su propia expresion, evaluada, da 88,4564 h y no las 84 h que enuncia | La tabla de §91 es la autoritativa y la regla la sigue: la duracion real del ejemplo es 86,1883 h. Las tres cifras (84, 88,4564 y 86,1883) quedan afirmadas en la prueba dorada, la ultima como valor correcto |
| 32 | §84 frente a §76, §80 y §82 | El ejemplo del ciclo narra "6 h despues: GERMINATING" y "96 h despues: GROWING → GrowthProgress 100 % → READY_TO_HARVEST", que situa dos transiciones en el mismo instante | Con `SEEDED 6 / GERMINATING 12 / GROWING 78` la primera transicion coincide, `GROWING` empieza a las 18 h y `READY_TO_HARVEST` a las 96 h. Es la interpretacion que preserva las dos cifras publicadas, 96 h de §82 y 325 h de §118; el texto de §84 se lee como simplificacion narrativa |
| 33 | §80 frente a §76 | `GrowthProgress` se describe como "dentro de `GROWING`" y se calcula acto seguido como `elapsedGameHours / cropGrowthDuration`, que es la duracion de las tres fases y no la de `GROWING` | Se implementa la formula literal de §80, medida desde el instante de siembra sobre las 96 h completas, porque es la unica de las dos lecturas que da un numero. `GROWING` se alcanza al 18,75 % de progreso |
| 34 | §118 frente a §94, §107 y §114 | §118 no contabiliza el coste de operacion, que §94, §107 y §114 declaran explicitamente aditivo al de posesion | Se contabiliza. Sobre el ciclo minimo son 8.771,0084 que §118 omite, lo que compensa en buena parte su sobreestimacion del mantenimiento (apartado 4) |
| 35 | §90 frente a §10 | `CLEAR_LAND`, el desmonte que §10 exige con coste de maquinaria, no figura en la tabla de compatibilidad de §90 | Se resuelve con tractor y arado a 2,0 celdas/h, la mitad de la velocidad del arado, y sin tarifa monetaria adicional: el coste economico que pide §10 es el coste de operacion de la tarea. Inventar una tarifa por celda seria inventar un numero de balance sin respaldo |
| 36 | §137 frente a §134 | `REPLANT` exige maquinaria forestal y la unica velocidad publicada para el procesador forestal son 0,8 arboles/h, con lo que plantar un planton seria cuatro veces mas lento que talar un arbol adulto | Velocidad propia de la operacion, 6,0 celdas/h, declarada como `workSpeedOverrideUnitsPerGameHour` y marcada como inventada en el catalogo |
| 37 | §134 | `FORWARDER` no declara `maintenanceCost` ni `operatingCost` | Se implementa literalmente a cero, igual que con los implementos de §89. Consecuencia para el informe de balance: el setup forestal de §138 tiene coste de posesion menor del que sugiere su precio de adquisicion |
| 38 | §136 frente a §116 | `WoodStorage` publica precio y capacidad pero no huella, que §116 necesita para calcular el coste real | 6 x 8 = 48 celdas, la del garaje, marcada como inventada. Afecta al total de §138, que no incluye suelo para el almacen |
| 39 | §102 | El pool de contratacion no declara tamano, y los tres candidatos de su ejemplo no son colineales, de modo que "salario correlacionado con skill mas ruido" no determina una recta | Tamano 3, por literalidad del ejemplo. Ajuste por minimos cuadrados sobre los tres candidatos: `salario = 0,45 x habilidad - 8,75`, con residuo maximo de 1,15 $/h en el intermedio, dentro de la banda de ruido del 12 % declarada |
| 40 | §138 frente a §131 | La primera tala se estima con el volumen medio del arbolado, que incluye los plantones, y §131 no admite talar un planton ni le asigna valor comercial | Dos cifras distintas y ambas correctas en su contexto: 1.534 dm3 por celda como volumen medio del arbolado (383,5 m3 en 250 celdas) y 1.530 dm3 como produccion de una tala (382,5 m3), que es la que usa la regla y la que el informe de balance debe citar. §138 estima ~382 m3 |

Los valores inventados que las resoluciones 6, 7, 8, 21, 22, 29, 30, 35, 36, 38 y 39 introducen estan
recogidos, con su justificacion individual, en ADR-0014. La resolucion 40 esta recogida en ADR-0030,
pendiente de escritura en la fase W6.

---

## 3. Referencias colgantes del GDD

El GDD v0.4 cita cuatro secciones que no existen en el documento. Las numeraciones proceden de una
version anterior en la que los addenda no se habian integrado como continuacion numerada. Las
equivalencias reales, deducidas del contenido citado en cada caso, son:

| Referencia citada | Aparece en | Seccion real | Contenido |
|---|---|---|---|
| §151 | §118 | §51 | Tiempo: multiplicador configurable en el servidor |
| §154 | §91 | §53 | Simulacion basada en eventos con marcas temporales |
| §161 | §84, §105 | §68 y §124 | Resumen de regreso: §68 la vista, §124 la formula analitica |
| §166 | §142 | §71 | Roadmap conceptual, fase 8 para silvicultura |

En el codigo y en los comentarios se cita siempre la seccion real, nunca la colgante, con una nota
cuando la cita original difiere.

---

## 4. Desviaciones numericas medidas

Varias de las contradicciones anteriores no eran afirmaciones sobre el texto sino hipotesis, y la fase W2
las midio. La prueba dorada de `shared/rules/__tests__/balance-golden.test.ts` reconstruye el escenario de
§117 desde los catalogos y afirma cada cifra con su valor real, no con el del GDD. Ninguna constante se
ajusto para producir estos numeros.

Escenario: 250 celdas de campo, 80 de huella de granja, pradera, garaje mas silo mas vivienda, tractor,
arado, sembradora, cosechadora y remolque, un trabajador a 15 $/h, habilidad del operario 70 %, condicion
de la maquinaria 100 %, fertilidad 100 %, todo comprado el dia uno.

| Concepto | GDD | Medido | Estado |
|---|---:|---:|---|
| Tierra, 330 celdas x 120 (§117) | 39.600 | 39.600 | Reproduce |
| Edificios (§117) | 23.000 | 23.000 | Reproduce |
| Maquinaria (§117) | 83.500 | 83.500 | Reproduce |
| Total de arranque (§117) | 146.100 | 146.100 | Reproduce |
| Colchon sobre 160.000 (§117) | 13.900 | 13.900 | Reproduce |
| Arado, 250 celdas (§118) | ~70 h | 70,0280 h | Reproduce |
| Siembra (§118) | ~61 h | 61,2745 h | Reproduce |
| Crecimiento (§82, §118) | 96 h | 96 h | Reproduce |
| Cosecha (§118) | ~98 h | 98,0392 h | Reproduce |
| Ciclo completo (§118) | ~325 h | 325,3417 h | Reproduce |
| Mantenimiento combinado por hora (§118) | ~70 | 37 | Desviacion, apartado 2.4 |
| Mantenimiento del ciclo (§118) | 22.750 | 12.037,6442 | Desviacion, apartado 2.4 |
| Salarios del ciclo (§118) | 4.875 | 4.880,1260 | Desviacion menor: §118 multiplica por 325 h redondeadas |
| Operacion del ciclo (§107, §114) | No contabilizado | 8.771,0084 | Omision del GDD, apartado 2.34 |
| Coste de posesion del ciclo (§118) | 27.625 | 25.688,7786 | Desviacion del 7 %: los dos errores anteriores se compensan en parte |
| Malezas al cosechar (§119) | 20 % | 100 %, saturado | Desviacion, apartado 2.1 |
| Rendimiento (§119) | 20.700 L | 11.250 L | Desviacion |
| Rendimiento con malezas al 20 % (§119) | 20.700 L | 20.700 L | Reproduce: la discrepancia esta en la tasa, no en la formula |
| Ingreso (§119) | 4.554 | 2.475 | Desviacion |
| Ingreso con malezas al 20 % (§119) | 4.554 | 4.554 | Reproduce |
| Ratio ingreso/coste (§125, objetivo 1,3 a 1,8) | — | 0,0963 | No cumple |
| Ciclos hasta el equilibrio (§121) | — | No existe | Confirma el diagnostico de §119 |
| Duracion del ejemplo de §110 | ~84 h | 86,1883 h | Desviacion, apartado 2.31 |
| Setup forestal minimo (§138) | 132.500 | 132.500 | Reproduce |
| Volumen de la primera tala (§138) | ~382 m3 | 382,5 m3 | Reproduce |
| Ingreso de la primera tala (§138) | ~17.190 | 17.212,50 | Reproduce |

Tres hallazgos que el material no anticipa y que conviene que el informe de balance recoja con estas
cifras:

1. La palanca A de §120, la compra escalonada, no alcanza el punto de equilibrio. Comprando cada maquina al
   empezar la fase que la necesita, el coste de posesion por ciclo baja de 25.688,78 a 20.006,22 y el ratio
   ingreso/coste solo pasa de 0,0963 a 0,1237. El deficit es de un orden de magnitud, no de margen, de modo
   que la palanca A por si sola no basta.
2. Cultivar no evita la saturacion de malezas en un campo de 250 celdas. `CULTIVATE` pone el nivel a cero,
   pero las 78 h de crecimiento mas las 98,04 h de cosecha suman 176,04 h, por encima de las 166,67 h que la
   tasa de 0,6 %/h necesita para saturar. El tamano de campo es la palanca real: por debajo de unas 130
   celdas, contando tambien el arado, el nivel se queda por debajo del 100 %, y un campo de 120 celdas
   termina en 95,20 %.
3. Las tres cifras de salario del GDD no pueden sostenerse a la vez. La regla procedural de §102 da 22,75 $/h
   para el 70 % de habilidad que implican las duraciones de §118 y 18,25 $/h para el "~60 %" que §117
   menciona para el mismo trabajador; §36 dice 30 $/h y §117 usa 15 $/h. El catalogo conserva la regla
   procedural y las otras quedan como no reproducibles.

Distribucion del generador de terreno, medida sobre 20 semillas y 4.096.000 celdas: 59,08 % pradera, 28,37 %
bosque, 2,57 % montana y 9,97 % agua. Las cuatro caen dentro de `TERRAIN_DISTRIBUTION_TARGET_BP`, la montana
con un margen del 28 % sobre su suelo. La cuota de montana medida sobre una sola semilla en una ventana de 30
por 30 chunks oscila entre el 0,88 % y el 3,08 %, de modo que la banda es una afirmacion valida sobre el
agregado del generador y nunca sobre una region concreta.
