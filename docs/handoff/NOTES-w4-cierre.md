# NOTES-w4-cierre

Agente de cierre documental. Fase W4. Ambito escrito: `docs/adr.md`, `docs/erratas-gdd-stack.md`,
`docs/ownership.md`, `README.md` de la raiz y este fichero. No se ha tocado codigo.

Este fichero recoge lo que la verificacion de cierre detecto y que cae fuera del ambito documental, con su
categoria, su fichero, su motivo y su propietario. Las notas de los agentes de la fase estan en
`NOTES-w4a.md`, `NOTES-w4b.md`, `NOTES-w4c.md`, `NOTES-w4d.md` y `NOTES-w4g.md` y siguen vigentes; no se
repiten aqui salvo cuando la verificacion las confirmo con una salida concreta.

Dos hechos de la fase que conviene leer antes que nada. Los dos agentes de paneles previstos no entregaron
nada, de modo que los once paneles del primer grupo siguen siendo el stub de W3-C. Y la herramienta de
seleccion, prevista para W5, se adelanto a esta fase y esta completa.

## Pendiente

### 3. La ventana de parcheo previa a W4 modifico dos ficheros congelados sin dejar traspaso

Categoria: trazabilidad del proceso
Ficheros afectados: `eslint.config.js`, `backend/src/__tests__/app.int.test.ts`
Propietario: quien la ejecuto; a efectos de registro queda documentado en `docs/ownership.md` 4.5

Entre el cierre de W3 y el arranque de W4 alguien aplico los apartados 1 y 2 de `NOTES-w3-cierre.md`. Las
marcas de tiempo del sistema de ficheros lo situan a las 09:31 y 09:32, frente a las 10:05 del primer
fichero de modulo de W4, y las cinco notas de la fase declaran no haber tocado ninguno de los dos.

No es una infraccion de propiedad: los dos son ficheros congelados y solo el agente de integracion tiene
mandato sobre ellos. Lo que falta es el registro, que es lo que la ventana W2.5 si dejo
(`NOTES-w2-5-parcheo.md`). Se documenta aqui y en `docs/ownership.md` 4.5 para que el cambio no quede sin
autor, y se anota que el parcheo de `app.int.test.ts` quedo obsoleto en cuanto W4 aterrizo, que es el
apartado 1 de este fichero.

### 10. Consecuencia de la numeracion de ADR para W5

Categoria: coordinacion entre fases
Ficheros afectados: `docs/adr.md`, `docs/ownership.md` apartado 3.3
Propietario: el agente designado de W5

Esta fase escribio ocho entradas, 0023 a 0030, y no las cuatro que preveia el reparto de la seccion 11 del
plan. Cuatro son adiciones o adelantos: la compra de tierra y las granjas no estaban cubiertas por ningun
tema, y las dos entradas sobre atributos perezosos y sobre reglas de validacion compartidas estaban
situadas en W5 pero corresponden a trabajo que se hizo aqui. Los tramos restantes quedan asi: W5 escribe
0031-0033, W6 0034-0037 y W7-D 0038-0039. La tabla completa con el tema de cada numero esta en el apartado
3.3 de `docs/ownership.md`. `scripts/adr-append.mjs` rechaza cualquier numero que no sea el siguiente de la
serie, de modo que el error se detecta al intentarlo.

## Verificado en el cierre

Salidas reales, ejecutadas desde la raiz del repositorio, con PostgreSQL en 55432 y Redis en 56379:

| Orden | Resultado |
|---|---|
| `make sync-types` | exit 0. 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `make typecheck` | exit 0. `tsc` en `shared` y en `backend` sin salida; `vue-tsc --build --force` del cliente en verde |
| `make lint` | exit 0. `npx eslint .` sin hallazgos, incluidas las reglas de zona; Prettier responde "All matched files use Prettier code style!" |
| `make test-unit` | exit 0. `shared`: 23 ficheros y 418 pruebas. Cliente: 26 ficheros y 252 pruebas |
| `make test-int` | exit 2. 16 ficheros y 182 pruebas: 178 en verde y 4 en rojo, las cuatro del apartado 1 |

El unico fallo de las cinco ordenes es el del apartado 1, y es una lista desfasada dentro de un fichero de
otro agente. Los dos hallazgos que las notas de la fase reportaban en `make lint` (un `no-unused-vars` en
`backend/src/__tests__/farms/capacity.int.test.ts` y dos en
`backend/src/__tests__/fields/fields.int.test.ts`) ya no aparecen: los dos agentes los corrigieron antes de
terminar, y `npx eslint .` devuelve 0 sobre el arbol completo.

No ejecutado, conforme al brief: `git` salvo `git ls-files` y `git status`, `npm install`,
`prisma generate`, `prisma migrate`, `docker compose` y construcciones de imagenes. `make typecheck`,
`make lint`, `make test-unit` y `make test-int` ejecutan `sync-types` como prerrequisito, de modo que las
dos copias de `shared/` quedaron actualizadas; ambas estan en `.gitignore` y no son ficheros de otro
agente.

La comprobacion de propiedad se hizo con `git ls-files` y
`git status --porcelain --untracked-files=all`: 329 rutas versionadas y 74 sin confirmar, 403 en total,
todas atribuidas en el apartado 3 de `docs/ownership.md`. Ningun fichero de esta fase tuvo dos escritores;
el razonamiento completo esta en el apartado 4.5 de ese documento.

## Resuelto

Dos apartados de `NOTES-w3-cierre.md` quedan cerrados, los dos por la ventana de parcheo del apartado 3 de
este fichero:

- Apartado 2, zonas de ESLint. `eslint.config.js` agrupa los modulos por fase y admite la importacion de
  los de fases anteriores. `land`, `farms` y `fields` consumen `modules/world/service.ts` y `make lint`
  devuelve 0. Era el bloqueo declarado para el arranque de W4 y no bloqueo.
- Apartado 1, primera mitad. Las dos rutas del area `world` estan ya en `IMPLEMENTED`. La segunda mitad, las
  doce rutas de W4, vuelve a estar abierta y es el apartado 1 de este fichero.

### 9. Puntos de W3 que siguen abiertos sin cambios

Aplicado por W7-A (integracion) salvo la trama de acuse del latido, que queda descartada por decision:
el latido del cliente no depende de la respuesta y el servidor ya emite `CLOCK` periodico, de modo que
anadir `PONG` seria un cambio del contrato sin consumidor. Los demas: `restart: unless-stopped`,
`METRICS_PORT` en la plantilla, el puerto del cliente leido del entorno y `CORS_ORIGIN` alineado. Los dos
ficheros de documentacion desfasados corresponden a W7-D.

El texto original de la nota:

Categoria: cambio en ficheros congelados
Propietario del cambio: W7-A

| Punto | Fichero | Estado |
|---|---|---|
| Politica de reinicio del worker | `docker-compose.yml` | Sigue en `restart: "no"` (`NOTES-w3-cierre` 4) |
| `METRICS_PORT` sin declarar | `.env.example` | Sin cambios (`NOTES-w3-cierre` 5) |
| Puerto del cliente en 3001 | `frontend/nuxt.config.ts`, `.github/workflows/ci.yml` | Sin cambios. La verificacion de W4 volvio a necesitar `--port 3111` (`NOTES-w3-cierre` 6, `NOTES-w4d` 1.4) |
| Sin trama de acuse para el latido | `shared/ws/envelope.ts` o `backend/src/plugins/ws.ts` | Sin cambios (`NOTES-w3-cierre` 7) |
| `shared/api/README.md` apartado 8 y `docs/handoff/README.md` apartado 4 desfasados | los dos | Sin cambios. El segundo enumera las notas hasta W2.5 y ya faltan las nueve de W3 y W4 (`NOTES-w3-cierre` 9) |

### 8. Cuatro tipos de evento agendado siguen con manejador de andamiaje

Resuelto por W5 y W6.

El texto original de la nota:

Categoria: trabajo pendiente de fases posteriores
Ficheros afectados: `backend/src/modules/{machinery,workers,tasks,forestry}/jobs.ts`
Propietario: los agentes de W5 y W6, cada uno el de su modulo

Actualiza el apartado 8 de `NOTES-w3-cierre.md`, que hablaba de cinco. `fields` tiene ya manejador real de
`FIELD_ADVANCE_PHASE`. La metrica `farm_world_scheduled_events_unhandled_total` debe quedar plana en cero
cuando W6 cierre.

### 7. El puente del cliente y el arbitraje de entrada

Aplicado, en dos tandas. El arbitraje de entrada y el dueno de Escape, antes de W7; el sujeto de un modo
de seleccion, por W7-A, que completo el emisor. `selection:confirmed` sigue sin existir en el puente por
decision registrada: el puerto `SelectionPort.onConfirm` lo cubre y lleva ademas la instantanea completa,
que el evento no podria llevar sin arrastrar tipos de dominio al puente.

El texto original de la nota:

Categoria: cambio en ficheros congelados
Ficheros afectados: `frontend/app/composables/useGameBridge.ts`, `frontend/app/composables/useShellUi.ts`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

Cuatro puntos, todos de `NOTES-w4g` 1.1, 1.2, 1.6 y 1.7 y `NOTES-w4d` 2.4: no existe evento de
confirmacion de seleccion; `SelectionMode` no distingue la division de campo ni la tala por area y no
puede llevar el sujeto; `input:enabled` no se apaga con el foco en un campo de texto, de modo que WASD
mueve la camara y Enter confirma mientras se escribe; y Escape tiene dos duenos.

Mitigacion adoptada por el ambito de W4-G: puerto propio con `onConfirm`, `setIntent` con la intencion
completa, y respeto de `input:enabled` en todos los caminos de entrada, de modo que el arreglo se aplica
sin tocar `app/game`.

### 6. El servidor simulado valora dos veces una celda repetida

Aplicado antes de W7.

El texto original de la nota:

Categoria: divergencia entre el servidor real y el simulado
Ficheros afectados: `frontend/app/mock/handlers.ts`, manejadores del area `land`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

Confirmado de `NOTES-w4a` 1.3. Afecta a los paneles en cuanto la seleccion contenga solapes, que es
exactamente lo que produce la union de rectangulos de la herramienta de seleccion. El cambio es deduplicar
por `cellKey` al entrar en los dos manejadores.

### 5. `make test-unit` no ejecuta la suite unitaria del backend

Aplicado por W7-A (integracion).

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `Makefile`, objetivo `test-unit`
Propietario del cambio: W7-A

Confirmado de `NOTES-w4c` 1.2. Son cuatro ficheros y 54 pruebas que no necesitan ni PostgreSQL ni Redis, y
entre ellas las 17 que afirman la formula de §78 y el recorrido de la maquina de estados de §76. Cambio de
una linea, `@cd backend && npm run --silent test`, entre `shared` y `frontend`.

Mitigacion adoptada: la suite se ejecuta con `cd backend && npx vitest run`, verde al cierre.

### 4. El lienzo no se monta en `/game`

Resuelto por el agente de costura de W5-W.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/pages/game.vue`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

Confirmado de `NOTES-w4d` 1.1 y `NOTES-w4g` 1.5. Nadie llama a `createGame` fuera de `pages/perf.vue`. Son
doce lineas mas tres de la herramienta de seleccion, ya escritas y verificadas en la ruta de medicion.

Mitigacion adoptada: `/perf?source=store` ejercita el camino real completo, almacen de mundo mas cliente
REST. Mientras no se aplique, `/game` muestra el marcador de posicion de W3-C.

### 2. Los once paneles del primer grupo no se escribieron

Resuelto por W5 y W6: los veintitres paneles registrados tienen contenido real y ninguno monta ya
`UiPendingPanel`.

El texto original de la nota:

Categoria: trabajo de la fase no entregado
Ficheros afectados: `frontend/app/components/panels/{cell-inspector,land-purchase,field-list,field-inspector,field-create,field-edit,farm-overview,building-placement,building-inspector,legend,minimap}/`
Propietario: sin asignar; decision para el arranque de W5

Los dos agentes previstos terminaron sin producir ningun fichero y sin dejar traspaso. Comprobado: los once
directorios contienen unicamente el stub que W3-C creo junto al registro, que monta `UiPendingPanel`.

Consecuencia real, y es la que hay que sopesar al planificar W5: el lienzo y la herramienta de seleccion
estan completos y llegan hasta publicar una seleccion valida por su puerto, pero no hay ningun panel que la
reciba. Es decir, la fase entrego el camino de entrada y no el de salida. `NOTES-w4g` 1.5 lleva el codigo
de enlace exacto, incluido el mapa `PANEL_OF_MODE` que el panel de destino necesita.

Mitigacion adoptada: ninguna posible. El registro de paneles esta congelado y los stubs son validos, de
modo que el cliente arranca y navega; lo que no hay es contenido.

### 1. `make test-int` termina con cuatro pruebas en rojo

Resuelto por ADR-0038.

El texto original de la nota:

Categoria: cambio en fichero de otro agente
Ficheros afectados: `backend/src/__tests__/app.int.test.ts`
Propietario del cambio: W3-A (cerrado), a aplicar por W7-A

Es la tercera aparicion del mismo punto: `NOTES-w3-cierre` 1 lo dejo para las dos rutas del area `world`, y
`NOTES-w4a` 1.1, `NOTES-w4b` 3.1 y `NOTES-w4c` 1.1 lo repiten para las doce rutas de W4. La constante
`IMPLEMENTED` enumera a mano las rutas servidas y la prueba generada afirma 501 para todas las demas.

Salida real de `make test-int` al cierre de la fase:

```text
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas > GET /api/farms responde 501 con NOT_IMPLEMENTED
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas > DELETE /api/buildings/:buildingId responde 501 con NOT_IMPLEMENTED
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas > GET /api/fields responde 501 con NOT_IMPLEMENTED
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas > GET /api/fields/:fieldId responde 501 con NOT_IMPLEMENTED
Test Files  1 failed | 15 passed (16)
Tests  4 failed | 178 passed (182)
```

Los tres agentes de backend se abstuvieron deliberadamente de tocar el fichero, y es la conducta correcta:
editar la misma constante a la vez habria hecho que el ultimo en escribir borrase a los otros dos. Este
agente tampoco lo toca, porque su brief le prohibe escribir codigo.

Cambio a aplicar, una sola vez, con las doce claves de la fase:

```text
'POST /api/land/quote',
'POST /api/land/purchase',
'GET /api/farms',
'POST /api/farms',
'POST /api/farms/:farmId/buildings',
'DELETE /api/buildings/:buildingId',
'GET /api/fields',
'GET /api/fields/:fieldId',
'POST /api/fields',
'POST /api/fields/:fieldId/extend',
'POST /api/fields/:fieldId/split',
'POST /api/fields/merge',
```

y bajar `expect(stubs.length).toBe(40)` a 28, ajustando el nombre de la prueba ("los nueve modulos de
dominio pendientes" pasa a seis) y el comentario que la acompana: veintisiete de las cincuenta y cinco
estan implementadas, que son las seis de `auth`, las dos de `world`, las dos de `land`, las cuatro de
`farms`, las seis de `fields`, las tres del area de sistema que se sirven y las cuatro de desarrollo.

Comprobado con el arbol real: `defineRoute` aparece hoy sobre veinte claves en `modules/`, mas las tres del
area de sistema y las cuatro de desarrollo. Las 28 restantes reparten asi: `state` 4, `machinery` 5,
`workers` 4, `tasks` 5, `economy` 4 y `forestry` 6.

Mitigacion adoptada: ninguna posible desde el ambito documental. El fallo es visible y explicito y no
oculta ningun defecto del servicio: los otros quince ficheros de la suite, incluidos los tres modulos de la
fase, estan en verde.
