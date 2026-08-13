# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Simulador de gestion agricola y forestal online (Fastify + BullMQ, Nuxt 4 SPA con Phaser,
PostgreSQL, Redis). Servidor autoritativo, simulacion basada en eventos sin tick continuo, y el
juego continua con el jugador desconectado. La documentacion del repositorio esta en espanol.

## Comandos

El `Makefile` es el punto unico de entrada; `make help` lista todos los objetivos.

```bash
make bootstrap                 # entorno nuevo: .env, npm install x4, sincroniza shared/
make up && make migrate && make seed   # pila de desarrollo (Docker) lista en localhost:8080
make verify                    # puerta unica: check-sync, typecheck, lint, test-unit, migrate, test-int, compose-config, balance
make test                      # test-unit + test-int
make typecheck / make lint / make format
make balance                   # regenera docs/balance/ (determinista, byte a byte)
make smoke                     # bucle completo por HTTP; necesita Docker; NO forma parte de verify
make migrate-dev NAME=descripcion      # nueva migracion de Prisma
make adr FILE=entrada.md       # anade una entrada de ADR (nunca editar docs/adr.md a mano)
```

Un solo test (vitest 4; los cuatro proyectos npm son independientes, sin workspaces):

```bash
cd shared && npx vitest run rules/__tests__/yield.test.ts
cd backend && npx vitest run src/__tests__/workers/pool.test.ts          # unitarias
cd backend && npm run test:int -- src/__tests__/economy/market.int.test.ts  # integracion; exige postgres+redis de `make up`
cd frontend && npx vitest run <fichero>
```

Los tests de integracion (`*.int.test.ts`) usan PostgreSQL y Redis reales y dejan datos en la base
de desarrollo. Hay un test de agenda de eventos ocasionalmente inestable bajo carga paralela
(`fields.int.test.ts`); si falla en una pasada completa, comprobarlo aislado antes de tocar nada.

## Arquitectura

### shared/ es la fuente de verdad del contrato

`shared/` (53 modulos: domain, config, rules, api, ws, world) se copia a `backend/src/shared` y
`frontend/app/shared` con `make sync-types`. Las copias estan en `.gitignore`: no se editan nunca;
se edita `shared/` y se resincroniza (todos los objetivos relevantes de make lo hacen solos).
Backend y frontend importan su copia sincronizada, nunca `shared/` de la raiz; ESLint lo impone.

Reglas de zona de ESLint que estructuran el codigo (fallan el lint, no son convencion):

- `shared/` es puro y deterministico: prohibidos `Date.now()` y `Math.random()`; el reloj se
  inyecta como parametro (`gameMs`) y el azar viene del hash deterministico de `shared/world`.
- Los 11 modulos de `backend/src/modules` estan ordenados por fases: un modulo importa modulos de
  fases anteriores, `lib/`, `plugins/` y `shared/`, y nunca un modulo hermano de su misma fase
  (el acoplamiento transversal va por `lib/moduleSeams.ts`). `lib/` es capa inferior y no conoce
  los modulos.
- Las escenas de Phaser (`frontend/app/game`) no importan stores de Pinia: el estado entra por el
  puente de escena y el lienzo nunca lo muta.

### Simulacion por eventos, no por tick

Un coste continuo (salarios, mantenimiento, operacion, interes) se liquida como integral de
solapes entre el intervalo consultado y la vigencia de cada fuente (`shared/rules/holding.ts`,
`backend/src/lib/accrual.ts`): el resultado no depende de cuando se liquide. Lo mismo con las
proyecciones perezosas: fase de cultivo, malezas y fertilidad se derivan del instante almacenado y
se asientan en cada cambio de estado; la fase, edad y volumen de un arbol nunca se almacenan. El
multiplicador de tiempo es configuracion de servidor y no altera ninguna ratio economica, porque
todos los costes e ingresos estan por hora de juego.

### Balance

Las constantes de balance viven en `shared/config/`, cada una con su seccion del GDD citada.
Desde la revision de 2026-08 (`docs/balance/revision-2026-08.md`) el catalogo se aparta
deliberadamente del GDD en precio del trigo, tasas de maquinaria, recta salarial y estados de
malezas; ya no rige la premisa original de "implementar el GDD literalmente".

Cambiar una constante de balance implica tres cosas: regenerar `docs/balance/` con `make balance`
(el informe es determinista: si el fichero cambia es que cambio una constante), actualizar los
tests dorados que anclan las cifras (`shared/rules/__tests__/balance-golden.test.ts`,
`holding.test.ts`, `pricing.test.ts`, `catalog.test.ts`, y los de integracion de economia y
maquinaria del backend), y registrar la decision. `tools/balance/` importa las mismas constantes y
reglas que el juego y no reescribe ninguna cifra.

## Documentacion y convenciones

- `docs/GDD_Farming_Management_Simulator_Online_v0.4.md` y `docs/stack.md` no se modifican. Las
  contradicciones del material de partida van a `docs/erratas-gdd-stack.md` y las decisiones a
  `docs/adr.md` via `make adr` (59 entradas; el script valida numeracion y plantilla).
- `docs/balance/informe-balance.md` y `kpis.json` son generados: se cambian tocando
  `shared/config/` o la prosa de `tools/balance/`, nunca a mano.
- `docs/balance/informe-para-revision.md` es registro historico del balance previo a la revision
  de 2026-08 y se conserva sin modificar.
- Los comentarios del codigo citan la seccion del GDD (`GDD section 82`, `§89`) o el documento de
  decision que justifica cada valor; mantener esa trazabilidad al tocar constantes o reglas.
- Idiomas mezclados por zona: el codigo de produccion de `shared/` y `backend/` comenta en
  ingles; los tests del backend, la prosa del informe de balance, los documentos y los mensajes
  de commit estan en espanol sin signos diacriticos. Seguir el idioma del fichero circundante.
