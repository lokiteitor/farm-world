# NOTES W7-E — ventana de correccion

Agente: W7-E. Fase: W7, correccion. Fecha: 2026-08-13.

Aplica los hallazgos que las dos revisiones adversariales (`docs/revision-formulas.md` y
`docs/revision-alcance.md`) y el recorrido de humo de W7-B dejaron confirmados. El registro
completo, con la resolucion de cada hallazgo, esta en el apartado 6 de
`docs/erratas-gdd-stack.md`; este fichero recoge lo que la ventana necesita traspasar y no cabe
alli.

## 1. Criterio aplicado

1. Se corrige el codigo que no hace lo que el GDD dice. No se ajusta ninguna constante de balance:
   los tres hallazgos que proponen cambiar un numero de catalogo o una tasa (O4 del alcance, H8 y
   H9 de formulas) quedan registrados como recomendacion y sin aplicar.
2. Toda correccion lleva su prueba de regresion, y de todas se comprobo que fallan antes del
   arreglo y pasan despues. El apartado 3 recoge la salida real de cada comprobacion previa.
3. Cada cambio es el minimo que corrige el defecto. Donde el arreglo natural era mover una regla,
   se movio la regla (la segmentacion de malezas a `shared/rules/yield.ts`) en lugar de duplicarla
   mejor en el cliente.

## 2. Lo que cambia de comportamiento observable

Tres correcciones cambian lo que el juego hace, y las tres en la direccion de la letra del GDD.
Quien lea una suite antigua o un informe antiguo debe saberlo:

1. **La cosecha ya no reinicia las malezas.** §78 enumera una unica via en el MVP, `CULTIVATE`, y
   §89 recoge el efecto como `sideEffect` exclusivo del cultivador. El ciclo siguiente hereda el
   nivel. Sin efecto sobre ninguna cifra publicada, porque con la tasa de §82 el nivel satura
   dentro de un solo ciclo; el efecto aparece el dia que se toque la tasa, que es la palanca que el
   informe de balance cuantifica en su apartado 7.2.
2. **Una tala por lote ya no destruye los plantones.** Siguen en pie despues de la tala, cuentan
   para la duracion de §135 y no producen madera. Consecuencia practica para cualquier prueba:
   despues de una tala la parcela no queda vacia, y una replantacion solo puede nombrar las celdas
   que quedaron libres.
3. **El arranque ya no re-ancla el reloj del mundo desde `GAME_RATE_NUM`.** La variable decide el
   multiplicador de un mundo que todavia no existe; para cambiar el de un mundo vivo hay
   `POST /api/dev/retime`, o `GAME_RATE_APPLY_ON_BOOT=true` si de verdad se quiere que un arranque
   lo aplique. Con los valores actuales de `.env` no cambia nada: el mundo de desarrollo y la
   configuracion coinciden en 12/1.

## 3. Comprobacion de cada prueba de regresion antes del arreglo

Cada una se ejecuto con el arreglo revertido a mano y se volvio a revertir despues. Salida real:

```text
forestry.int.test.ts   × no marca ni tala el planton            AssertionError: expected 2 to be 1
forestry.int.test.ts   × cierra la parcela en lugar de escribir cellCount = 0
assignment.int.test.ts × rechaza intercambiar la maquina propulsada y el implemento
                         AssertionError: expected 200 to be greater than or equal to 400
app.int.test.ts        × decide la identidad antes de validar el cuerpo
                         AssertionError: /api/farms: expected 400 to be 401
gameClock.int.test.ts  × el arranque no cambia el multiplicador de un mundo vivo
                         AssertionError: expected true to be false
stores/fields.test.ts  × coincide con la regla compartida segmentada por fase
                         AssertionError: malezas a las 18 h: expected 1080 to be +0
purchase.int.test.ts     (afirmacion invertida: expected pasaba a valer 600 y no 480)
catalog.test.ts          (HARVEST declaraba resetsWeedLevel: true)
```

Las cuatro correcciones de `tools/balance/` no tienen suite: ningun objetivo de Vitest alcanza
`tools/`. Su prueba es el propio informe regenerado, que es determinista y esta versionado, de modo
que `make balance` deja la diferencia a la vista. Antes y despues, literalmente:

```text
-| ... | 100 % (saturado; sin techo serian 1 %) | ...
+| ... | 100 % (saturado; sin techo serian 147,6 %) | ...
-| §138 | Volumen de la primera tala ... | 383,5 m3 |     ->  382,5 m3
-| §138 | Ingreso de la primera tala ... | 17.257,50 $ |  ->  17.212,50 $
-| Escenario | 1. Setup minimo | 2. Posesion por ciclo | ...
+| Escenario | 1. Setup minimo | 2. Coste por ciclo (posesion + operacion) | ...
-Con un colchon de 13.900,00 $ el jugador no puede permitirse el taller (9.000 $), un segundo
 trabajador ni el cultivador (5.200 $).
+Con un colchon de 13.900,00 $ el jugador puede permitirse el taller o el cultivador, pero no los
 dos: ... Contratar a un segundo trabajador no mueve dinero ...
```

Conviene, cuando alguien abra `tools/`, darle un objetivo de pruebas propio o incluirlo en el de
`shared/`. Es la unica parte del arbol sin ninguna puerta automatica, y es la que publica cifras.

## 4. El recorrido de humo

`make smoke` esta en verde: 184 comprobaciones, los dieciseis pasos, dos ejecuciones consecutivas
identicas en resultado y 19,8 s y 8,8 s de reloj real. Lo que hubo que tocar en el, y por que
ninguno de los tres cambios debilita una afirmacion:

1. `env.ts` declara `GAME_RATE_APPLY_ON_BOOT=true` para sus dos procesos. Es el unico punto del
   repositorio que lo declara y lo hace explicitamente; el mundo acelerado es suyo durante la
   ejecucion y lo restituye con `dev/retime` en el `finally`.
2. La afirmacion «y con las malezas reiniciadas» pasa a «las malezas no se reinician al cosechar», y
   se compara contra la regla pura, no contra cero.
3. Las afirmaciones de la tala pasan a contar con los plantones supervivientes: el lote se calcula
   con `isFellable` en el instante de la asignacion, la parcela queda con los arboles que §131 no
   admite talar, y la replantacion nombra las celdas que la tala dejo libres. Son mas afirmaciones
   que antes, no menos.

Ademas, la aportacion de capital del recorrido sube de 400.000 a 4.000.000 en cada uno de sus dos
tramos. No es balance: es capital de trabajo del arnes, con fila propia en la tabla de variaciones,
y su motivo esta en el comentario de la constante. A 100 horas de juego por segundo real, el coste
de posesion de la explotacion del recorrido es del orden de diez mil por segundo de reloj, de modo
que la factura es proporcional a lo que tarde la maquina; con 400.000 una maquina cargada llevaba
el saldo a negativo antes de la cosecha, la liquidacion forzosa vendia el grano y el recorrido
terminaba afirmando un silo vacio.

## 5. La base de datos de desarrollo

Se retiraron los veintiun jugadores de verificacion acumulados y todo lo que colgaba de ellos,
conservando `dev@farm-world.local`. El motivo esta en el apartado 6.3 de las erratas y no es
cosmetico: con esos jugadores en descubierto, el barrido periodico liquidaba a cada uno en cada
ciclo y, con el multiplicador del recorrido de humo, saturaba al worker hasta hacer fallar por
espera finalizaciones que no tenian nada malo. El recorrido no se limpia a si mismo, de modo que la
cuenta vuelve a crecer una unidad por ejecucion; `make reset`, o la misma limpieza selectiva, cuando
vuelva a estorbar.

## 6. Pendiente

1. **`tools/` sin puerta de pruebas.** Apartado 3 de este fichero.
2. **`smoke` sigue fuera de `verify`.** El motivo, medido, esta en el comentario del objetivo y en
   el apartado 6.2 de las erratas. La linea que lo encadenaria es `@$(MAKE) smoke` antes de
   `balance`.
3. **ADR-0056** —la estrategia de pruebas y el recorrido de humo— sigue sin escribirse. El reparto
   lo atribuye a W7-D y la ventana de correccion no escribe en `docs/adr.md`, que tiene un unico
   escritor por fase. Lo que esta ventana aporta a esa entrada: el recorrido de humo es la unica
   prueba que ejercita el mecanismo real de retardo de la cola, y ha encontrado un defecto que
   ninguna de las 260 pruebas de integracion encontro, porque ninguna desmontaba una parcela entera.
4. **Los siete hallazgos registrados y no corregidos** del apartado 6.2 de las erratas. Ninguno es
   un defecto de implementacion frente al GDD; cinco son decisiones de balance o de contrato y dos
   son redaccion.
