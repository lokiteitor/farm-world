# Farming Management Simulator Online

Simulador de gestion agricola y forestal online, top-down 2D, con mundo procedural persistente y
economia gestionada por el jugador. Se parte de un capital limitado, se compra tierra virgen, se
construye la granja, se adquiere maquinaria, se contrata a los trabajadores, se crean campos, se
cultiva, se cosecha, se gestionan bosques y se reinvierte.

La implementacion cubre las fases 0 a 8 del roadmap del GDD (§71): el MVP agricola completo mas
silvicultura. Esta terminada y verificada de extremo a extremo; el apartado 4 recoge la salida de cada
puerta y el apartado 7, el estado fase a fase.

Tres propiedades definen la arquitectura y las tres estan en el GDD:

- El servidor es autoritativo (§54). El cliente solicita acciones y nunca modifica dinero, propiedad,
  maquinaria, trabajadores, campos, inventario ni tiempos.
- La simulacion esta basada en eventos, sin tick continuo (§53). Un coste continuo se calcula como
  integral de solapes entre el intervalo consultado y la vigencia de cada fuente de coste, de modo que
  el resultado no depende de cuando se liquide.
- El juego continua con el jugador desconectado (§52) y el progreso se explica al regreso.

La maquinaria no se conduce: se asigna a trabajadores, que son quienes la operan (§1 y §39).

---

## 1. Requisitos

- Node 22.20 o superior. La version exacta esta en `.nvmrc`.
- Docker con el complemento Compose v2.
- GNU Make.

No hace falta instalar PostgreSQL ni Redis: los levanta `docker-compose.yml`.

---

## 2. Arranque desde cero

```bash
make bootstrap   # copia .env.example a .env, instala los cuatro proyectos npm y sincroniza shared/
make up          # levanta postgres, redis, backend, worker, el cliente y Caddy
make migrate     # aplica las migraciones de Prisma
make seed        # crea el mundo inicial
```

Con eso el juego queda servido en `http://localhost:8080`. `make smoke` recorre a continuacion el
bucle completo por HTTP contra esa misma pila y publica el resultado de cada uno de sus dieciseis
pasos.

`make bootstrap` encadena `make install` y `make sync-types`. Para repetir solo la instalacion de
dependencias basta `make install`; para regenerar las copias de `shared/`, `make sync-types`.
`make help` lista todos los objetivos con su descripcion. El `Makefile` es el punto unico de entrada
de comandos y esta congelado desde la primera fase: los agentes de implementacion invocan objetivos y
no los escriben.

Puertos por defecto, configurables en `.env`. Ninguno es el canonico de su servicio, y es deliberado:
una maquina de desarrollo suele tener ya ocupados 5432, 6379, 80 y 3000, y Docker aborta `make up`
completo cuando no puede publicar uno solo de ellos. Los puertos internos no cambian, de modo que
dentro de la red de Compose los servicios siguen alcanzandose en `postgres:5432`, `redis:6379`,
`backend:3000` y `frontend:3001`. La tabla completa, con la variable de cada uno, esta en
`.env.example`.

| Servicio                        | URL                           |
| ------------------------------- | ----------------------------- |
| Cliente y API a traves de Caddy | http://localhost:8080         |
| Cliente, servidor de desarrollo | http://localhost:3100         |
| API                             | http://localhost:3000/api     |
| Documentacion OpenAPI           | http://localhost:3000/docs    |
| Metricas                        | http://localhost:3000/metrics |
| PostgreSQL                      | localhost:55432               |
| Redis                           | localhost:56379               |
| Prometheus, perfil `obs`        | http://localhost:59090        |
| Grafana, perfil `obs`           | http://localhost:53000        |

Prometheus y Grafana no se levantan con la pila de desarrollo. Se activan con `make obs-up` y se
detienen con `make obs-down`.

---

## 3. El bucle completo

La partida se juega en `/game`, con el lienzo del mundo a la izquierda y una barra de nueve pestanas
—Mundo, Campos, Granja, Maquinaria, Personal, Tareas, Economia, Silvicultura y Ayuda— que abren el
panel lateral. La barra superior lleva siempre el saldo, el dia propio del jugador, el multiplicador
de tiempo, la plantilla, la ocupacion del silo, el consumo por hora y el estado de la conexion.

El arte es abstracto y esta generado por codigo, de modo que el panel de leyenda de la pestana Ayuda
no es opcional: es el que dice que significa cada color. La guia de arranque de esa misma pestana
resume la secuencia de compra escalonada que §120 recomienda.

1. **Cuenta.** Registro y acceso en `/login`. Un jugador nuevo recibe los 160.000 de capital inicial
   de §117 y un origen asignado de forma determinista con al menos 400 celdas de pradera contiguas.
2. **Mundo.** Desplazamiento con arrastre o teclado y zoom en pasos anclados al cursor. Los chunks se
   cargan y descargan solos; por debajo de 0,4 de zoom el mundo se dibuja con una miniatura por chunk,
   que es la misma que alimenta el minimapa.
3. **Tierra.** Pestana Mundo, panel de compra: se arrastra un rectangulo sobre pradera, se combinan
   varios con union, resta y celda a celda, y el panel presupuesta al precio de §115 antes de cobrar.
   El presupuesto local sirve para el arrastre y el del servidor para cobrar, y los dos coinciden.
4. **Granja y edificios.** Pestana Granja: se funda la granja, que no cuesta nada porque lo que ocupa
   celdas son los edificios, y se colocan garaje, silo y vivienda con el fantasma de la huella
   siguiendo al cursor. El taller habilita las reparaciones. El precio de §116 cobra el suelo solo si
   no era ya del jugador.
5. **Maquinaria.** Pestana Maquinaria: catalogo de §89 y §134 con el precio y el motivo de bloqueo
   cuando no queda plaza de garaje. Cuatro plazas por garaje (§96).
6. **Personal.** Pestana Personal: el pool ofrece tres candidatos con la regla procedural de §102 y se
   renueva cada 48 horas de juego. Contratar exige plaza de vivienda (§108).
7. **Campo.** Pestana Campos: se selecciona un area contigua de celdas propias, se crea el campo y se
   recorre la maquina de estados de §76, de `VIRGIN` a `HARVESTED` y vuelta. Los campos pueden cruzar
   chunks, ampliarse, dividirse y fusionarse.
8. **Tareas.** Sobre un campo se asigna arar, cultivar, sembrar o cosechar a un trabajador con su
   maquina propulsada y su implemento. La combinacion se valida contra la tabla de §90 y la secuencia
   de seis comprobaciones de §104, y el panel adelanta duracion y coste con la misma evaluacion que
   ejecutara el servidor. Una tarea en curso se sigue con cuenta atras y se puede cancelar, con
   desgaste prorrateado y sin reembolso.
9. **Crecimiento.** Tras sembrar, el cultivo pasa a `GERMINATING` a las 6 horas de juego, a `GROWING` a
   las 18 y a `READY_TO_HARVEST` a las 96, sin que el jugador tenga que estar delante. Las transiciones
   llegan por WebSocket y aparecen en el resumen de regreso.
10. **Cosecha y venta.** La cosecha aplica la formula de §83 con la fertilidad de §77 y la penalizacion
    por malezas de §78, llena el silo hasta su capacidad y desperdicia el resto con su asiento. La
    pestana Economia vende el grano al precio de §123 y publica el historico del ledger.
11. **Silvicultura.** Pestana Silvicultura: se compra bosque, se crea la parcela con su arbolado
    generado proceduralmente, se tala por area con maquinaria forestal, se almacena y se vende la
    madera, se replanta y se desmonta el suelo talado a terreno agricola, sobre el que ya se puede
    crear un campo. La fase, la edad y el volumen de un arbol no se almacenan en ninguna columna: se
    derivan del instante de plantacion.
12. **Regreso.** Al volver tras una ausencia, el resumen de regreso agrega el ledger por tipo de
    asiento, lista las tareas cerradas, las transiciones automaticas, la ocupacion de los almacenes y
    los arboles que cambiaron de fase, con enlaces que mueven la camara.

El multiplicador de tiempo es configuracion de servidor y no del jugador (§51): cambiarlo altera el
consumo de caja de todos a la vez, de modo que el cliente lo muestra en solo lectura.

Advertencia de balance, que es una desviacion documentada y no un defecto: con las constantes del GDD
sin ajustar, el primer ciclo cierra en negativo. El apartado 9 lo desarrolla.

---

## 4. Verificacion

```bash
make typecheck   # tsc en shared y backend, vue-tsc en el cliente
make lint        # ESLint con las reglas de zona, mas Prettier en modo comprobacion
make test-unit   # pruebas unitarias de shared, backend y cliente
make test-int    # integracion del backend con Postgres y Redis reales
make balance     # informe de KPIs de §125 en docs/balance/
make verify      # puerta unica que encadena todo lo anterior
make smoke       # bucle completo por HTTP contra la pila real
```

`make verify` encadena `check-sync`, `typecheck`, `lint`, `test-unit`, `migrate`, `test-int`,
`compose-config` y `balance`, que es el orden del criterio de aceptacion. Salida del cierre:

| Puerta | Resultado |
| --- | --- |
| `check-sync` | Las dos copias de `shared/` en sincronia |
| `typecheck` | `shared`, `backend` y `frontend` sin errores |
| `lint` | ESLint sin hallazgos; Prettier conforme |
| `test-unit` | `shared` 425 en 23 ficheros · `backend` 82 en 6 · `frontend` 649 en 61 |
| `migrate` | 2 migraciones, ninguna pendiente |
| `test-int` | 260 pruebas en 32 ficheros contra PostgreSQL y Redis reales |
| `compose-config` | Los tres ficheros de Compose validos |
| `balance` | Informe regenerado, identico byte a byte al anterior |
| `smoke` | 187 comprobaciones en 16 pasos y 76 peticiones HTTP, 8,3 s de reloj real |

Son 1.416 pruebas automatizadas mas las 187 comprobaciones del recorrido de humo.

`make smoke` se invoca aparte y no forma parte de `verify`, por un motivo medido: necesita Docker y la
base de desarrollo migrada, y deja en ella la cuenta de cada ejecucion, de modo que una puerta que lo
encadenara acabaria fallando por carga acumulada y no por el juego. La linea que lo encadenaria esta en
el comentario del objetivo. El reparto de lo que afirma cada capa esta en ADR-0056.

`make balance` termina en cero aunque el margen del ciclo sea negativo: el informe documenta la
desviacion en lugar de exigir que se corrija (ADR-0044). Lo que si es exigible es su determinismo, y se
comprobo al cierre ejecutandolo dos veces: dos ficheros identicos byte a byte, de modo que un cambio en
`docs/balance/` significa siempre un cambio de constante.

`make smoke-ui` imprime la secuencia de comprobacion manual en el navegador —registro, desplazamiento
y zoom, compra de tierra por arrastre, construccion, asignacion de tarea y llegada del evento de fin
por WebSocket sin recargar— y `make perf-lab`, la ruta de medicion de fotogramas y llamadas de dibujo.
Es el unico punto del criterio de aceptacion que no esta automatizado, por la razon que ADR-0056 da:
lo que un navegador anade sobre el recorrido de humo es que la pagina monta y que el lienzo dibuja, y
eso se comprueba mirandolo. El recorrido registrado esta en `docs/handoff/NOTES-w5w.md`, `NOTES-w6w.md`
y `docs/handoff/INTEGRACION.md`.

---

## 5. Estructura del repositorio

```text
/
├── Makefile                     punto unico de entrada de comandos
├── docker-compose.yml           desarrollo: postgres, redis, backend, worker, cliente, Caddy
├── docker-compose.prod.yml      produccion: imagenes construidas y estatico en un volumen
├── docker-compose.obs.yml       Prometheus y Grafana, perfil obs
├── .env.example                 plantilla de entorno; ningun valor de aqui es balance
├── tsconfig.base.json  eslint.config.js  .prettierrc  .nvmrc
├── infra/                       Caddyfile de desarrollo y de produccion, Prometheus, init de Postgres
├── .github/workflows/ci.yml
├── scripts/                     sincronizacion de shared/, anexado de ADR y el recorrido de humo
├── docs/                        GDD, stack, ADR, erratas, propiedad, revisiones, balance y handoff
├── shared/                      fuente de verdad del contrato
│   ├── domain/                  primitivas marcadas, dinero, identificadores, enumerados, entidades
│   ├── config/                  catalogos de balance del GDD como constantes
│   ├── rules/                   reglas puras: reloj, duracion, rendimiento, precios, geometria, balance
│   ├── api/                     esquemas Zod, mapa de rutas tipado y codigos de error
│   ├── ws/                      union discriminada de eventos, sobre y mensajes de cliente
│   └── world/                   generador determinista de terreno y asignador de origen
├── backend/                     Fastify y worker de BullMQ, un proyecto con dos puntos de entrada
│   ├── prisma/                  schema.prisma, migraciones y semilla
│   └── src/                     app, plugins, lib, once modulos de dominio
├── frontend/                    Nuxt 4 en modo SPA, con Phaser en el lienzo del mundo
│   └── app/                     paginas, paneles Vue, stores de Pinia, cliente REST y WebSocket, escenas
└── tools/balance/               calculadora de KPIs de §117 a §125
```

`shared/` es la unica fuente de verdad del contrato: 53 modulos que el backend y el cliente leen a la
vez, de modo que la validacion del servidor y la del formulario no pueden divergir. Se sincroniza hacia
`backend/src/shared` y `frontend/app/shared` con `make sync-types`, las dos copias estan en
`.gitignore`, y `make check-sync` falla si alguna difiere del origen.

Cifras del arbol al cierre: 55 rutas declaradas en 12 areas, las 55 implementadas; 20 tipos de evento
de WebSocket; 20 modelos y 20 enumerados en `schema.prisma`; 11 modulos de dominio en el backend; y 23
paneles registrados, los 23 con contenido. Todas las texturas se generan por codigo al arrancar la
escena y no hay ningun recurso grafico que descargar (ADR-0020).

---

## 6. Documentacion

| Documento | Contenido |
| --- | --- |
| `docs/GDD_Farming_Management_Simulator_Online_v0.4.md` | Game Design Document, §1 a §142. No se modifica |
| `docs/stack.md` | Documento de stack tecnico. No se modifica |
| `docs/adr.md` | Registro unico de decisiones de arquitectura: 59 entradas con indice y plantilla |
| `docs/erratas-gdd-stack.md` | Contradicciones del material de partida, su resolucion, las desviaciones medidas y lo que queda abierto |
| `docs/ownership.md` | Propiedad ruta a agente, las cinco reglas del trabajo en paralelo y el cuadre con el arbol real |
| `docs/revision-formulas.md` | Revision adversarial de las formulas de §77 a §138 y del informe de balance |
| `docs/revision-alcance.md` | Revision adversarial de la validacion autoritativa y del alcance frente a §86, §99, §112, §126 y §141 |
| `docs/balance/` | Informe de KPIs generado por `make balance`, con `kpis.json` para consumo automatico |
| `docs/handoff/` | Un fichero por agente con lo que quedaba pendiente fuera de su ambito, mas `INTEGRACION.md` |
| `shared/api/README.md` | Contrato de la API: mapa de rutas, conversores de frontera y correspondencia de eventos |
| `backend/prisma/README.md` | Modelo de datos, invariantes y contrato real de Prisma 7 |

Los dos documentos de partida se conservan tal como se recibieron. Cuando alguno se contradice o deja
un hueco, la contradiccion se recoge en `docs/erratas-gdd-stack.md` y la decision que provoca, en
`docs/adr.md`. Se anade una entrada de ADR con `make adr FILE=<ruta>`, nunca editando el final del
fichero: el script comprueba que el numero sea el siguiente de la serie y que la entrada tenga las
cinco secciones de la plantilla, y actualiza el indice.

Las dos revisiones de `docs/revision-*.md` se encargaron con el mandato de refutar y no de confirmar.
Entre las dos y el recorrido de humo entregaron diecinueve hallazgos confirmados por ejecucion; doce se
corrigieron, cada uno con una prueba de regresion comprobada fallando antes del arreglo y pasando
despues, y siete quedan registrados sin corregir con el motivo de cada uno. El criterio esta en
ADR-0059 y el detalle, en el apartado 6 de las erratas.

---

## 7. Estado por fases del roadmap del GDD (§71)

Las columnas se leen asi: Contrato es lo que vive en `shared/` como vocabulario, catalogo o regla pura;
Datos es lo que existe en `schema.prisma` y en las migraciones; Servicio es el modulo del backend;
Cliente es la interfaz.

| Fase del GDD §71 | Contrato    | Datos       | Servicio          | Cliente                      |
| ---------------- | ----------- | ----------- | ----------------- | ---------------------------- |
| 0 — Foundation   | Completo    | Completo    | Completo          | Completo                     |
| 1 — World        | Completo    | Completo    | Completo          | Completo, montado en `/game` |
| 2 — Land         | Completo    | Completo    | Completo          | Completo                     |
| 3 — Farming      | Completo    | Completo    | Completo          | Completo                     |
| 4 — Machinery    | Completo    | Completo    | Completo          | Completo                     |
| 5 — Farm         | Completo    | Completo    | Completo          | Completo                     |
| 6 — Economy      | Completo    | Completo    | Completo          | Completo                     |
| 7 — Idle         | Completo    | Completo    | Completo          | Completo                     |
| 8 — Forestry     | Completo    | Completo    | Completo          | Completo                     |
| 9 — Expansion    | No previsto | No previsto | Fuera del alcance | Fuera del alcance            |

Que significa «completo», con la precision que la tabla no admite:

- No queda ninguna ruta de andamiaje. Las 55 rutas del contrato tienen manejador real, y
  `stubRouteKeys()` devuelve la lista vacia, de modo que la suite que deriva del registro los casos
  «responde 501» no genera ninguno (ADR-0038).
- No queda ningun panel de andamiaje: los 23 registrados tienen contenido y ninguno monta ya el
  componente de pendiente.
- Los seis tipos de evento agendado tienen manejador real, y el contador
  `farm_world_scheduled_events_unhandled_total` sigue sin ninguna serie tras procesar eventos de los
  tres tipos que un recorrido completo produce.
- Fase 3. El bucle de cultivo se juega de extremo a extremo, con la validacion de §90 y §104, la
  prevision de duracion y coste, la cuenta atras, la cancelacion advertida con desgaste prorrateado y
  el desbordamiento de silo resuelto como aviso al asignar y desperdicio con asiento al completar
  (ADR-0052).
- Fase 7. El resumen de regreso agrega el ledger sobre el intervalo `(ultimo resumen, ahora]`, cuadra
  `balanceBefore + netChange = balanceAfter` y solo desaparece al acusarlo (ADR-0053). La escalera de
  resincronizacion tiene sus tres peldanos: reproduccion desde el anillo, registro autoritativo cuando
  el anillo se perdio e instantanea completa cuando el hueco no cabe en una pagina (ADR-0019).
- Fase 8. El ciclo forestal completo, con la fase, la edad y el volumen del arbol derivados y nunca
  almacenados (ADR-0049), y con el desmonte total dando de baja la parcela vaciada en lugar de escribir
  un recuento imposible (ADR-0059).

Presupuesto de rendimiento del renderizador, medido y no estimado. Del mundo, sobre Chrome 1920x1080
con Intel Iris Xe: a zoom 1 con diez chunks visibles, 59,1 fotogramas por segundo y 2 llamadas de
dibujo frente a un presupuesto de 55 y 130; a zoom 0,25 con 112 chunks visibles, 60,1 y 8 frente a 55 y
220. De la capa de entidades, sobre un banco de 200 maquinas y 2.000 arboles a zoom 1: 2.302 sprites,
2,7 ms de pasada estructural a 10 Hz y 1,48 ms de coste medio por fotograma. El detalle esta en
`docs/handoff/NOTES-w4d.md` y `NOTES-w5d.md`, y las decisiones en ADR-0023 y ADR-0046.

Puntos abiertos al cierre, con su motivo, en el apartado 7.3 de `docs/erratas-gdd-stack.md`: los dos
pasos de la liquidacion forzosa que siguen sin estrategia y se reportan como no ejecutados, la ausencia
de puerta de pruebas sobre `tools/`, `smoke` fuera de `verify`, y cuatro puntos menores de contrato y
de interfaz. Ninguno impide jugar el bucle completo.

---

## 8. Fuera del alcance

§70 del GDD enumera lo que queda fuera del MVP, y nada de ello esta implementado. La revision de
alcance lo comprobo lista por lista contra §86, §99, §112, §126 y §141: las once exclusiones que el GDD
pide conservar como valor reservado figuran en los enumerados sin que ninguna ruta las escriba, que es
la politica de reserva agresiva de ADR-0013.

Animales y ganaderia · multiplayer directo y PvP · vehiculos controlados por el jugador · clima
complejo · contratos · prestamos · produccion industrial y cadenas de produccion · fertilizantes
avanzados y herbicidas · trabajadores con habilidades avanzadas · transporte entre granjas · carreteras
avanzadas · mineria · pesca · modding · mercado global complejo.

De la fase 9 del roadmap tampoco hay nada: mas cultivos, mas maquinaria, mas edificios ni economia
avanzada.

Tres precisiones sobre esa frontera:

1. La silvicultura (§128 a §142) si esta implementada. El propio §70 la situa como lo primero que puede
   ir despues del MVP agricola, y el alcance acordado son las fases 0 a 8, que la incluyen.
2. La gestion de varias granjas por jugador pertenece a la fase 9 y esta implementada por una decision
   deliberada del plan: sin ella no hay respuesta a que silo va la cosecha cuando hay mas de una granja,
   que es una contradiccion real entre §31 y §83. Se declara como ampliacion y no solo como resolucion
   de una contradiccion (erratas 16 y O6).
3. Lo que queda dentro del MVP pero deliberadamente inactivo es vocabulario reservado, no funcionalidad
   a medias. Entre ellos, `BANKRUPT`, `COMPACTED`, `BROKEN`, `TRAVELING`, `UNAVAILABLE`, `RESTING`,
   `INJURED`, `SEED_PURCHASE` y el multiplicador de fertilizacion fijo en 1,0: existen para que la
   palanca este disponible sin migracion, y ninguna ruta los produce.

---

## 9. Balance

El balance no se ajusta: los valores del GDD se implementan literalmente y las desviaciones se
documentan. Es una decision tomada durante la planificacion y registrada en ADR-0011, ADR-0014 y, con
las cifras finales, en ADR-0057.

La calculadora de `tools/balance/` importa las mismas constantes y las mismas reglas puras que el juego
y publica `docs/balance/informe-balance.md` y `docs/balance/kpis.json`. No lleva ninguna cifra escrita
ni marca de tiempo, de modo que un cambio en el informe significa siempre un cambio de constante. Es un
entregable y no una puerta (ADR-0044).

Los seis KPI de §125, con la compra completa el dia uno que describe §117:

| KPI | Valor |
|---|---|
| 1. Coste de setup minimo | 146.100,00 $ |
| 2. Coste por ciclo, posesion mas operacion | 25.688,78 $ |
| 3. Ingreso por ciclo | 2.475,00 $ |
| 4. Ratio ingreso/coste | 0,0963 |
| 5. Horas hasta el equilibrio | No existe: el margen por ciclo es negativo (§121) |
| 6. Colchon tras el setup | 13.900,00 $ |

El objetivo que §125 recomienda es un ratio entre 1,3 y 1,8. La compra escalonada de §120 lo mejora a
0,1237 y no lo resuelve: el deficit es de un orden de magnitud, no de margen. De las 24 cifras
publicadas que la calculadora comprueba, 15 se reproducen desde el catalogo y 9 no.

El hallazgo principal, y el que mas dinero mueve: la tasa de malezas de §82, 0,6 %/h, satura al 100 % en
166,67 horas y el ciclo tiene 246,07 horas de crecimiento de malezas, de modo que la penalizacion de
§78 al cosechar es la maxima y el rendimiento es 11.250 L frente a los 20.700 L que §119 supone. La
prevision del plan de que `CULTIVATE` diera con ello un uso estrategico no se sostiene, porque tras
cultivar quedan 176,04 horas hasta la cosecha y vuelve a saturar; la palanca que si funciona es el
tamano del campo, que por debajo de unas 130 celdas no llega a saturar.

Lo que el juego hace con ese deficit esta implementado y probado, no pendiente: saldo negativo
permitido porque impedirlo rechazaria el propio devengo, `IN_DEBT` derivado que bloquea el gasto
discrecional y no la venta ni la asignacion de tareas, e interes de descubierto y liquidacion forzosa
en el orden publicado (ADR-0039).

Las siete recomendaciones de balance que las revisiones produjeron y que no se aplicaron estan
consolidadas, con el motivo de cada una, en el apartado 7.2 de `docs/erratas-gdd-stack.md`.

El propio GDD anticipa el diagnostico en su §119 y pide que se detecte en diseno y no en produccion.

---

## 10. Licencia

Ver `LICENSE`.
