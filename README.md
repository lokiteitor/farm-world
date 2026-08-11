# Farming Management Simulator Online

Simulador de gestion agricola y forestal online, top-down 2D, con mundo procedural persistente y
economia gestionada por el jugador. El jugador parte de un capital limitado, compra tierra virgen,
construye su granja, adquiere maquinaria, contrata trabajadores, crea campos, cultiva, cosecha, gestiona
bosques y reinvierte.

Tres propiedades definen la arquitectura y estan documentadas en el GDD:

- El servidor es autoritativo (GDD §54). El cliente solicita acciones y nunca modifica dinero,
  propiedad, maquinaria, trabajadores, campos, inventario ni tiempos.
- La simulacion esta basada en eventos, sin tick continuo (GDD §53). Un coste continuo se calcula como
  integral de solapes entre el intervalo consultado y la vigencia de cada fuente de coste.
- El juego continua con el jugador desconectado (GDD §52), y el progreso se calcula al regreso.

La maquinaria no se conduce: se asigna a trabajadores, que son quienes la operan (GDD §1 y §39).

Alcance de la implementacion: fases 0 a 8 del roadmap del GDD (§71), es decir el MVP agricola completo
mas silvicultura.

---

## 1. Requisitos

- Node 22.20 o superior. La version exacta esta en `.nvmrc`.
- Docker con el complemento Compose v2.
- GNU Make.

No hace falta instalar PostgreSQL ni Redis: los levanta `docker-compose.yml`.

---

## 2. Arranque

```bash
make bootstrap   # copia .env.example a .env, instala los cuatro proyectos npm y sincroniza shared/
make up          # levanta postgres, redis, backend, worker, el cliente y Caddy
make migrate     # aplica las migraciones de Prisma
make seed        # crea el mundo inicial
make smoke       # recorre el bucle completo por HTTP contra la pila real
```

`make bootstrap` encadena `make install` y `make sync-types`. Para repetir solo la instalacion de
dependencias, `make install` basta; para regenerar las copias de `shared/`, `make sync-types`.

`make help` lista los objetivos disponibles con su descripcion. Los agentes de implementacion invocan
objetivos y no los escriben: el `Makefile` esta congelado desde la primera fase.

Puertos por defecto, configurables en `.env`. Ninguno es el canonico de su servicio, y es deliberado:
una maquina de desarrollo suele tener ya ocupados 5432, 6379, 80 y 3000, y Docker aborta `make up`
completo cuando no puede publicar uno solo de ellos. Los puertos internos no cambian, de modo que dentro
de la red de Compose los servicios siguen alcanzandose en `postgres:5432`, `redis:6379`,
`backend:3000` y `frontend:3001`. La tabla completa, con la variable de cada uno, esta en
`.env.example`.

| Servicio                        | URL                           |
| ------------------------------- | ----------------------------- |
| Cliente, servidor de desarrollo | http://localhost:3100         |
| Cliente y API a traves de Caddy | http://localhost:8080         |
| API                             | http://localhost:3000/api     |
| Documentacion OpenAPI           | http://localhost:3000/docs    |
| Metricas                        | http://localhost:3000/metrics |
| PostgreSQL                      | localhost:55432               |
| Redis                           | localhost:56379               |
| Prometheus, perfil `obs`        | http://localhost:59090        |
| Grafana, perfil `obs`           | http://localhost:53000        |

Prometheus y Grafana no se levantan con la pila de desarrollo. Se activan con `make obs-up` y se detienen
con `make obs-down`.

---

## 3. Verificacion

```bash
make typecheck   # tsc en shared y backend, vue-tsc en el cliente
make lint        # ESLint con las reglas de zona, mas Prettier en modo comprobacion
make test-unit   # pruebas de shared y del cliente
make test-int    # integracion del backend con Postgres y Redis reales
make balance     # informe de KPIs de §125 en docs/balance/
make verify      # puerta unica que encadena todo lo anterior, y es lo que ejecuta CI
```

`make verify` no puede quedar en verde hasta la fase W7: encadena `make smoke`, y
`scripts/smoke/smoke.ts` todavia no existe. El objetivo lo detecta y nombra al agente propietario en el
mensaje de error, en lugar de fallar de forma opaca.

---

## 4. Estructura del repositorio

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
├── scripts/                     sincronizacion de shared/, comprobacion de sincronia, anexado de ADR
├── docs/                        GDD, stack, ADR, erratas, propiedad, handoff, informe de balance
├── shared/                      fuente de verdad del contrato
│   ├── domain/                  primitivas marcadas, dinero, identificadores, enumerados, entidades
│   ├── config/                  catalogos de balance del GDD como constantes
│   ├── rules/                   reglas puras: reloj, duracion, rendimiento, precios, geometria, balance
│   ├── api/                     esquemas Zod, mapa de rutas tipado y codigos de error
│   ├── ws/                      union discriminada de eventos, sobre y mensajes de cliente
│   └── world/                   generador determinista de terreno y asignador de origen
├── backend/                     Fastify y worker de BullMQ, un proyecto con dos puntos de entrada
│   ├── prisma/                  schema.prisma, migraciones y semilla
│   └── src/                     app, plugins, lib, modulos de dominio
├── frontend/                    Nuxt 4 en modo SPA, con Phaser en el lienzo del mundo
│   └── app/                     paginas, paneles Vue, stores de Pinia, cliente REST y WebSocket, escenas
└── tools/balance/               calculadora de KPIs de §117 a §125
```

`shared/` es la unica fuente de verdad del contrato. Se sincroniza hacia `backend/src/shared` y
`frontend/app/shared` con `make sync-types`, y las dos copias estan en `.gitignore`. `make check-sync`
falla si alguna difiere del origen, y la integracion continua lo ejecuta.

---

## 5. Documentacion

| Documento                                              | Contenido                                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `docs/GDD_Farming_Management_Simulator_Online_v0.4.md` | Game Design Document, §1 a §142. No se modifica                                         |
| `docs/stack.md`                                        | Documento de stack tecnico. No se modifica                                              |
| `docs/adr.md`                                          | Registro unico de decisiones de arquitectura, con su indice y su plantilla              |
| `docs/erratas-gdd-stack.md`                            | Contradicciones del material de partida, su resolucion y las desviaciones medidas       |
| `docs/ownership.md`                                    | Tabla de propiedad ruta a agente y las cinco reglas del trabajo en paralelo             |
| `docs/handoff/`                                        | Un fichero por agente con lo que queda pendiente fuera de su ambito                     |
| `docs/balance/`                                        | Informe de KPIs generado por `make balance`. No existe todavia                          |
| `shared/api/README.md`                                 | Contrato de la API: mapa de rutas, conversores de frontera y correspondencia de eventos |
| `backend/prisma/README.md`                             | Modelo de datos, invariantes y contrato real de Prisma 7                                |

Los dos documentos de partida se conservan tal como se recibieron. Cuando alguno se contradice o deja un
hueco, la contradiccion se recoge en `docs/erratas-gdd-stack.md` y la decision que provoca, en
`docs/adr.md`.

Se anade una entrada de ADR con `make adr FILE=<ruta>`, nunca editando el final del fichero: el script
comprueba que el numero sea el siguiente de la serie, que no exista ya y que la entrada tenga las cinco
secciones de la plantilla, y actualiza el indice.

---

## 6. Estado de implementacion

Estado al cierre del flujo de trabajo W2. Las columnas se leen asi: Contrato es lo que vive en `shared/`
como vocabulario, catalogo o regla pura; Datos es lo que existe en `schema.prisma` y en la migracion
inicial; Servicio es el modulo del backend; Cliente es la interfaz.

| Fase del GDD §71 | Contrato    | Datos       | Servicio          | Cliente           |
| ---------------- | ----------- | ----------- | ----------------- | ----------------- |
| 0 — Foundation   | Completo    | Completo    | Pendiente, W3     | Pendiente, W3     |
| 1 — World        | Completo    | Completo    | Pendiente, W3     | Pendiente, W3-W4  |
| 2 — Land         | Completo    | Completo    | Pendiente, W4     | Pendiente, W4     |
| 3 — Farming      | Completo    | Completo    | Pendiente, W4     | Pendiente, W4     |
| 4 — Machinery    | Completo    | Completo    | Pendiente, W5-W6  | Pendiente, W5-W6  |
| 5 — Farm         | Completo    | Completo    | Pendiente, W4     | Pendiente, W4     |
| 6 — Economy      | Completo    | Completo    | Pendiente, W5     | Pendiente, W5     |
| 7 — Idle         | Completo    | Completo    | Pendiente, W3-W6  | Pendiente, W6     |
| 8 — Forestry     | Completo    | Completo    | Pendiente, W6     | Pendiente, W6     |
| 9 — Expansion    | No previsto | No previsto | Fuera del alcance | Fuera del alcance |

Lo que existe hoy, en cifras: 53 ficheros de contrato en `shared/` con 23 suites y 418 pruebas en verde;
55 rutas declaradas en 12 areas con sus esquemas de peticion y respuesta; 21 tipos de evento de
WebSocket; 20 modelos y 20 enumerados en `schema.prisma`, con 32 restricciones de comprobacion, 10
disparadores y 9 indices parciales en la migracion inicial, verificados uno a uno con 27 pruebas en
`psql`; y una prueba dorada que reconstruye desde los catalogos los numeros de §117, §118, §119 y §138 y
afirma cada desviacion con su valor real.

Lo que no existe todavia: el esqueleto de Fastify y del worker, los modulos de dominio del backend, toda
la interfaz, la calculadora de balance y la prueba de humo. `backend/src/server.ts`,
`backend/src/worker.ts`, `frontend/app/app.vue`, `frontend/app/pages/index.vue` y
`frontend/app/assets/tokens.css` son andamiajes que sus propietarios sustituyen en W3, y cada uno lo
declara en su cabecera.

Puntos abiertos que afectan al arranque, detallados en `docs/handoff/NOTES-w2-cierre.md`:

1. Falta declarar `@prisma/adapter-pg@7.9.1` en `backend/package.json`. Prisma 7 elimino el motor de
   consultas binario y sin adaptador no arrancan ni el backend ni `make seed`.
2. `.gitignore` y `.prettierignore` no excluyen `backend/src/generated/`, que es la salida obligatoria
   del generador de Prisma. Hoy se versionaria, y `make lint` falla tras `make generate`.
3. El servicio `postgres` de `docker-compose.yml` monta `pg_data:/var/lib/postgresql/data`, ruta que la
   imagen `postgres:18-alpine` rechaza. Debe ser `/var/lib/postgresql`.
4. `shared/index.ts` conserva comentadas las cuatro reexportaciones de `rules`, `api`, `ws` y `world`.
5. Faltan dos valores de enumerado en `shared/domain/enums.ts`: `LedgerType.STARTING_CAPITAL`, sin el cual
   el capital inicial de §117 no tiene asiento y la invariante del ledger se rompe con el primer jugador,
   y el conjunto `ScheduledEventStatus`, que hoy solo existe en `schema.prisma`.

Los cinco requieren modificar ficheros congelados y los aplica el agente de integracion de W7.

---

## 7. Balance

El balance no se ajusta: los valores del GDD se implementan literalmente y las desviaciones se
documentan. Es una decision tomada durante la planificacion y registrada en ADR-0011 y ADR-0014.

Consecuencia ya medida y afirmada por la prueba dorada: el primer ciclo agricola no es rentable con los
valores ilustrativos del GDD. El ratio ingreso/coste es 0,0963 frente al objetivo de 1,3 a 1,8 que fija
§125, y no existe punto de equilibrio en el sentido de §121. La compra escalonada que recomienda §120
mejora el ratio a 0,1237 y no lo resuelve: el deficit es de un orden de magnitud, no de margen. La tabla
completa esta en el apartado 4 de `docs/erratas-gdd-stack.md`.

El propio GDD anticipa el diagnostico en su §119 y pide que se detecte en diseno y no en produccion.

---

## 8. Licencia

Ver `LICENSE`.
