# NOTES-w2-cierre

Agente de cierre documental. Fase W2. Ambito escrito: `docs/adr.md`, `docs/erratas-gdd-stack.md`,
`docs/ownership.md` y `README.md` de la raiz.

Este fichero recoge unicamente lo que este agente detecto al ejecutar la verificacion de cierre y que no
puede arreglar, porque cae fuera de su ambito documental. Las notas de los cuatro agentes de contrato y
de modelo estan en `NOTES-W2a.md`, `NOTES-W2b.md`, `NOTES-W2c.md` y `NOTES-w2d.md`, y siguen vigentes; no
se repiten aqui salvo cuando la verificacion las confirmo con una salida concreta.

## Pendiente

### 1. `README.md` de la raiz queda escrito, pero su apartado 6 caduca en cada fase

Categoria: cambio en fichero abierto
Ficheros afectados: `README.md`
Propietario del cambio: W7-A
Motivo: el apartado 6, "Estado de implementacion", refleja el arbol al cierre de W2: contrato y modelo de
datos completos, servicio y cliente pendientes. La tabla por fases del roadmap del GDD y la lista de
puntos abiertos hay que actualizarlas al cierre de cada flujo de trabajo, y desde luego en W7. El resto
del documento (arranque, estructura, indice de documentacion, balance) no depende de la fase.

Mitigacion adoptada mientras tanto: el apartado declara en su primera linea la fase a la que corresponde
el estado, de modo que un lector sabe si esta leyendo informacion vigente.

## Verificado en el cierre

Salidas reales, ejecutadas desde la raiz del repositorio:

| Orden | Resultado |
|---|---|
| `make typecheck` | exit 0. Sincroniza 53 ficheros a cada copia, `tsc` en `shared` y en `backend` sin salida, `vue-tsc` del cliente en verde tras generar los tipos de Nuxt |
| `make lint` | exit 2. `npx eslint .` exit 0 sin hallazgos; `npx prettier --check .` senala 29 ficheros, 28 de `backend/src/generated/prisma/` y `shared/api/README.md`. Ningun otro fichero del repositorio incumple |
| `make test-unit` | exit 0. `shared`: 23 ficheros y 418 pruebas en verde en 2,39 s. Cliente: 1 fichero y 1 prueba en 0,82 s |
| `make check-sync` | exit 0. Las dos copias de `shared/` en sincronia |
| `git status --porcelain` y `find . -type f` | Toda ruta existente atribuida en `docs/ownership.md`, apartados 3 y 4 |
| `node scripts/adr-append.mjs` | Nueve entradas anadidas, 0006 a 0014, cada una con las cinco secciones de la plantilla y su fila de indice con el ancla correcta |
| `npx prettier --check README.md` | exit 0 |

No ejecutado, conforme al brief: `git`, `npm install`, `prisma generate`, `prisma migrate`,
`docker compose`, construcciones de produccion. `make typecheck` y `make lint` ejecutan `sync-types` como
prerrequisito, de modo que `backend/src/shared` y `frontend/app/shared` quedaron actualizadas; ambas estan
en `.gitignore` y no son ficheros de otro agente, por lo que no supone escritura fuera de ambito.

## Resuelto

Las notas 1 y 2 de este fichero las aplico la ventana de parcheo de W2.5, con el texto original
conservado a continuacion. La nota 1 se resolvio como estaba propuesto, anadiendo
`backend/src/generated/` a `.gitignore` y a `.prettierignore`. La nota 2 se resolvio por la via general
que ella misma proponia, `**/README.md` en `.prettierignore`, y no reformateando el fichero: la
alineacion de las tablas de `shared/api/README.md` es exactamente lo que la exclusion de `docs/`
existe para proteger, y el mismo argumento vale para `backend/prisma/README.md`, que hoy pasa la
comprobacion por casualidad. Tras el cambio `npx prettier --check .` no senala ningun fichero y
`make lint` devuelve 0.

### 1. `make lint` falla por la salida del generador de Prisma

Categoria: cambio en fichero congelado
Ficheros afectados: `.gitignore`, `.prettierignore`
Propietario del cambio: W1 (congelado), a aplicar por W7-A
Motivo: `npx prettier --check .` senala los 28 ficheros de `backend/src/generated/prisma/`, que es la
salida obligatoria del generador `prisma-client` de Prisma 7 y no puede vivir fuera de `src/` por el
`rootDir` de `tsconfig.build.json`. Es codigo generado y regenerable, equivalente a `backend/src/shared`.
Confirma la nota 2 de `NOTES-w2d.md` con la salida real. Ademas, `git check-ignore` confirma que la ruta
no esta ignorada, de modo que hoy se versionarian 2,3 MB de codigo generado.

Cambio a aplicar, en los dos ficheros, junto a las entradas existentes de `backend/src/shared/`:

```
backend/src/generated/
```

Mitigacion adoptada mientras tanto: ninguna posible desde el ambito documental. El fallo es visible y
explicito, no silencioso, y `npx eslint .` si pasa porque los ficheros generados llevan
`/* eslint-disable */`. En integracion continua no ocurre todavia, porque el trabajo de lint no ejecuta
`make generate` y el fichero no esta versionado; cuando se versione, si ocurrira.

### 2. `make lint` falla tambien por `shared/api/README.md`

Categoria: cambio en fichero congelado
Ficheros afectados: `.prettierignore`
Propietario del cambio: W1 (congelado), a aplicar por W7-A
Motivo: `.prettierignore` excluye `docs/` entero, con el argumento de que es prosa escrita a mano con
tablas que Prettier reformatearia, pero `shared/api/README.md` es prosa igualmente escrita a mano y no
esta excluido. `npx prettier --check .` lo senala. Es el unico fichero de documentacion fuera de `docs/`
que existe hoy junto a `backend/prisma/README.md`, que si pasa la comprobacion por casualidad.

Cambio propuesto, que resuelve el caso general y no solo este fichero:

```
# Prose written by hand, in any project. See the note above about docs/.
**/README.md
```

Mitigacion adoptada mientras tanto: ninguna. `shared/api/` es ambito de W2-C y ya esta cerrado, y
reformatear el fichero para satisfacer a Prettier destruiria la alineacion de sus tablas, que es
exactamente lo que la exclusion de `docs/` pretende evitar. La alternativa, si W7-A prefiere no tocar
`.prettierignore`, es ejecutar `npx prettier --write shared/api/README.md` una vez y aceptar el
reformateo.
