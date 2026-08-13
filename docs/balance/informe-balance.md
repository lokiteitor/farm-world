# Informe de balance del MVP

Generado por `make balance` desde `tools/balance/`. Contrato compartido 0.1.0.

Documento generado. No se edita a mano: cualquier cifra que haya que cambiar se cambia en
`shared/config/`, que es de donde salen todas.

## 1. Alcance y metodo

La calculadora importa las mismas constantes que el juego, desde `shared/config/`, y las
mismas reglas puras, desde `shared/rules/`. No hay ninguna cifra escrita en la herramienta:
el coste de posesion se obtiene con la misma integral de solapes que el servidor liquida, y
el rendimiento con la misma formula de GDD §83 que aplica la cosecha. Si se retoca una
constante, este informe se mueve con ella.

La implementacion original aplicaba el balance del GDD sin modificarlo, y este informe midio
que el resultado quedaba un orden de magnitud por debajo del objetivo del propio documento.
La revision de balance de 2026-08 (`docs/balance/revision-2026-08.md`) ajusto cuatro grupos de
constantes: el precio de venta del trigo, las tasas horarias de la maquinaria, la recta
salarial y los estados en los que crecen las malezas. El informe compara ahora el catalogo
revisado con lo que el GDD publica, y senala en cada desviacion si procede del GDD o de la
revision.

El informe no lleva marca de tiempo. Dos ejecuciones sobre el mismo catalogo producen bytes
identicos, de modo que la unica razon por la que este fichero cambia es que ha cambiado una
constante, que es lo que lo hace util en revision y en integracion continua.

## 2. Los seis KPI de GDD §125

Uno por columna, en el orden en que GDD §125 los enumera. El objetivo que la propia seccion
recomienda para el MVP es un ratio ingreso/coste entre 1,3 y 1,8 en el primer ciclo jugado de
forma eficiente.

| Escenario | 1. Setup minimo | 2. Coste por ciclo (posesion + operacion) | 3. Ingreso por ciclo | 4. Ratio ingreso/coste | 5. Horas hasta equilibrio | 6. Colchon tras setup |
|---|---|---|---|---|---|---|
| Setup minimo viable, compra completa el dia uno | 146.100,00 $ | 16.194,24 $ | 16.459,20 $ | 1,016 | 179.397,1 h | 13.900,00 $ |
| Setup minimo viable, compra escalonada | 146.100,00 $ | 12.784,71 $ | 16.459,20 $ | 1,287 | 12.935,77 h | 13.900,00 $ |
| Primer ciclo con la hipotesis de malezas de GDD §119 | 146.100,00 $ | 16.194,24 $ | 18.630,00 $ | 1,15 | 19.514,44 h | 13.900,00 $ |

- **Setup minimo viable, compra completa el dia uno**: Reproduce literalmente GDD §117 y §118: las cinco maquinas se adquieren al arrancar y se mantienen durante todo el ciclo.
- **Setup minimo viable, compra escalonada**: Aplica la recomendacion de GDD §120: cada maquina se adquiere cuando empieza la fase que la necesita, de modo que su mantenimiento solo corre desde ese momento.
- **Primer ciclo con la hipotesis de malezas de GDD §119**: Fija el nivel de malezas en el 20 % que GDD §119 supone, en lugar de proyectarlo con la tasa de GDD §82. Sirve para comprobar que la formula de rendimiento reproduce el ingreso publicado y que la discrepancia esta en el nivel de malezas.

## 3. Reproduccion de GDD §117: el setup minimo viable

Se reproduce exactamente. Las tres partidas y su suma salen del catalogo de precios de GDD
§115 y §116 sin ningun ajuste.

| Partida | GDD §117 | Calculado | Coincide |
|---|---|---|---|
| Tierra, 330 celdas de pradera | 39.600,00 $ | 39.600,00 $ | Si |
| Edificios (garaje, silo y vivienda) | 23.000,00 $ | 23.000,00 $ | Si |
| Maquinaria minima (cinco maquinas) | 83.500,00 $ | 83.500,00 $ | Si |
| Total de arranque | 146.100,00 $ | 146.100,00 $ | Si |
| Capital inicial | 160.000,00 $ | 160.000,00 $ | Si |
| Colchon tras el setup | 13.900,00 $ | 13.900,00 $ | Si |

Se cumple la regla de GDD §47: el capital alcanza para arrancar y no para comprarlo todo.
Con un colchon de 13.900,00 $ el jugador puede permitirse el taller o el cultivador, pero no los dos: el taller cuesta 9.000,00 $ y el cultivador 5.200,00 $, y juntos 14.200,00 $, por encima del colchon. Contratar a un segundo trabajador no mueve dinero (§102 leido como politica de deuda, errata 47): cuesta su salario continuo de §107 y lo limita la capacidad de la vivienda de §116.

## 4. Reproduccion de GDD §118: el coste de sostener el primer ciclo

### 4.1 Duracion del ciclo

Las cuatro duraciones que GDD §118 publica se reproducen dentro de su propio redondeo. La
duracion de cada operacion sale de `workSpeed` de GDD §89 y del factor de habilidad de GDD
§103; las tres fases de crecimiento son el reparto de la seccion 2.2 del plan, que preserva a
la vez el `growthDuration` de 96 h de GDD §82 y el ciclo de unas 325 h de GDD §118.

| Tramo | Estado del campo | Duracion | Maquinaria |
|---|---|---|---|
| PLOW | VIRGIN | 70,03 h | TRACTOR, PLOW |
| SEED | PLOWED | 61,27 h | TRACTOR, SEEDER |
| Fase SEEDED | SEEDED | 6 h | — |
| Fase GERMINATING | GERMINATING | 12 h | — |
| Fase GROWING | GROWING | 78 h | — |
| HARVEST | READY_TO_HARVEST | 98,04 h | HARVESTER, TRAILER |

Duracion total del ciclo: **325,34 h**, frente a las 325 h de GDD §118.

### 4.2 Coste de posesion

Aqui aparece la primera desviacion de fondo. GDD §118 supone unos 70 $/h de mantenimiento
combinado; ya el catalogo literal de GDD §89 producia solo 37 $/h (unicamente el tractor y la
cosechadora declaran `maintenanceCost`), y la revision de balance de 2026-08 dejo las tasas en
la mitad (tractor 6 $/h, cosechadora 15 $/h). Ademas GDD §118 omite el `operatingCost`, que
GDD §107 y §114 declaran aditivo al mantenimiento.

| Concepto | GDD §118 | Calculado | Nota |
|---|---|---|---|
| Salarios del ciclo | 4.875,00 $ | 5.107,87 $ | Reproducible; la diferencia es el redondeo del ciclo a 325 h. |
| Mantenimiento por hora | ~70,00 $/h | 21,00 $/h | No reproducible: los implementos no tienen mantenimiento en GDD §89. |
| Mantenimiento del ciclo | 22.750,00 $ | 6.832,18 $ | Consecuencia de la fila anterior. |
| Operacion por hora (maquinas trabajando) | No contabilizado | 40,00 $/h | GDD §107 y §114 lo declaran aditivo; GDD §118 lo omite. |
| Operacion del ciclo | No contabilizado | 4.254,20 $ | Solo durante las tareas activas, por integral de solapes. |
| Interes de descubierto | No contemplado | 0,00 $ | Tasa 0 % por hora de juego. |
| Coste total del ciclo (posesion + operacion) | 27.625,00 $ | 16.194,24 $ | No reproducible: dos desviaciones de signo contrario que se compensan en parte. |

La compra escalonada que GDD §120 recomienda es la palanca que el propio sistema ya habilita.
Con ella el coste de posesion del ciclo baja a 12.784,71 $, es decir 3.409,54 $ menos, porque el mantenimiento de cada maquina solo corre desde que se compra.

## 5. Reproduccion de GDD §119: el ingreso de la primera cosecha

La formula de rendimiento de GDD §83 y la curva de penalizacion de GDD §78 reproducen el
numero publicado **exactamente**, siempre que se les de el nivel de malezas que el propio
GDD §119 supone. Lo que no se reproduce es ese nivel de malezas, y el apartado 7 lo desarrolla.

| Concepto | GDD §119 | Con la hipotesis de §119 | Con la tasa de §82 |
|---|---|---|---|
| Nivel de malezas al cosechar | ~20 % | 20 % | 46,8 % |
| Penalizacion de GDD §78 | ~8 % | 8 % | 18,72 % |
| Rendimiento | ~20.700 L | 20.700 L | 18.288 L |
| Ingreso | ~4.554,00 $ | 18.630,00 $ | 16.459,20 $ |

El precio de venta es 0,90 $ por litro, fijo y sin fluctuacion (GDD §123). Es el precio de la revision de balance de 2026-08: el 0,22 $/L de GDD §82 hacia inviable cualquier ciclo y fue la constante que la revision senalo como mas desproporcionada.

## 6. Valores del GDD que su propio catalogo no reproduce

De las 24 cifras publicadas que la calculadora comprueba, 13 se reproducen y 11 no. La columna "calculado" es lo que sale del catalogo implementado, que desde la revision de 2026-08 se aparta deliberadamente del GDD en el precio de venta, las tasas de maquinaria, la recta salarial y los estados de malezas; la columna "causa" distingue las desviaciones internas del GDD de las introducidas por la revision.

### 6.1 No reproducibles

| Seccion | Concepto | Publicado | Calculado | Causa |
|---|---|---|---|---|
| §117 frente a §118 | Habilidad del trabajador de arranque | aproximadamente 60 % | 70 % para reproducir las duraciones de §118 | Con habilidad 60 % el factor de GDD §103 es 0,8 y arar 250 celdas tarda 74,4 h, no las 70 h de §118. Las duraciones publicadas exigen un factor de 0,85, que en la curva implementada corresponde al 70 % de habilidad. |
| §117 frente a §36 y §102 | Salario del trabajador de arranque | 15 $/h en §117, 30 $/h en §36, 12-31 $/h en §102 | 15,70 $/h para habilidad 70 % con la recta salarial revisada | Las tres cifras del GDD son incompatibles entre si. La regla procedural de §102 es la autoritativa; la revision de 2026-08 escalo su recta a la baja porque el ajuste original (22,75 $/h para el 70 %) superaba todo el ingreso de un ciclo. Con la recta revisada el 15 $/h de §117 corresponderia a una habilidad del 67,74 %. |
| §118 | Salarios del ciclo | 4.875 $ (15 $/h x 325 h) | 5.107,87 $ | Reproducible. La diferencia es la del ciclo: el GDD redondea 325 h y el calculo integra 325,34 h. |
| §118 | Mantenimiento de maquinaria por hora | aproximadamente 70 $/h combinado | 21,00 $/h | NO reproducible por dos motivos acumulados: el catalogo de §89 solo asigna maintenanceCost al tractor y a la cosechadora (37 $/h combinados, no ~70), y la revision de 2026-08 dejo esas dos tasas en la mitad (6 y 15 $/h), porque con las literales un tractor consumia el 22 % de su precio de compra en un solo ciclo. |
| §118 | Mantenimiento del ciclo | 22.750 $ | 6.832,18 $ | Consecuencia directa de la fila anterior. |
| §118 | Coste de posesion del ciclo | 27.625 $ (salarios mas mantenimiento) | 11.940,04 $ sin operacion, 16.194,24 $ con ella | NO reproducible. A la baja, el mantenimiento del catalogo revisado es menos de un tercio del que §118 supone; al alza, §118 omite el operatingCost, que aqui son 4.254,20 $ y que §107 y §114 declaran aditivo al mantenimiento. |
| §119 | Ingreso de la primera cosecha con esa misma hipotesis | aproximadamente 4.554 $ | 18.630,00 $ | NO reproducible por el precio, no por los litros: los 20.700 L de §119 se reproducen, pero el precio es el 0,90 $/L de la revision de 2026-08 y no el 0,22 de §82, descartado por inviable. |
| §119 frente a §82 | Nivel de malezas acumulado al cosechar | aproximadamente 20 % en 325 h sin cultivar | 46.8 % | NO reproducible. Con la tasa de §82 (0,6 %/h) y la lectura H8 de la revision de 2026-08 las malezas crecen solo durante las 78 h de GROWING, en el orden del ~20 % que §119 supone; con la lectura original acumulaban 246 h y saturaban el 100 %. |
| §119 frente a §78 y §82 | Rendimiento real del primer ciclo sin cultivar | aproximadamente 20.700 L y 4.554 $ | 18288 L y 16.459,20 $ | Consecuencia de la fila anterior y del precio revisado: la penalizacion de §78 es el 18,7 %, frente al 8 % que §119 supone, y el precio es 0,90 $/L. |
| §133 frente a §138 | Edad a la que se alcanza OLD_GROWTH | 960 h | 720 h | NO reproducible: cuatro fases tienen tres fronteras, de modo que 4 x 240 h cuenta una fase de mas. Registrado como lectura erronea en docs/erratas-gdd-stack.md. |
| §116 frente a §117 | realBuildingCost aplicado literalmente | purchasePrice mas huella x cellPrice | 32.600,00 $ para los tres edificios, frente a los 23.000,00 $ que §117 cobra | NO reproducible a la vez que §117: aplicar la formula al pie de la letra cobra el suelo dos veces al jugador que ya lo posee, que es exactamente el caso que §117 describe. El plan resuelve la contradiccion en la seccion 2.2 y ADR-0029. |

### 6.2 Reproducibles

Se enumeran porque un informe que solo listara los desajustes daria a entender que el
catalogo no sostiene el documento, y no es el caso: la mayor parte de las cifras del GDD
salen de sus propias constantes.

| Seccion | Concepto | Publicado | Calculado |
|---|---|---|---|
| §117 | Coste de la tierra, 330 celdas de pradera | 39.600 $ | 39.600,00 $ |
| §117 | Coste de los tres edificios de arranque | 23.000 $ | 23.000,00 $ |
| §117 | Coste de las cinco maquinas minimas | 83.500 $ | 83.500,00 $ |
| §117 | Coste total de arranque | 146.100 $ | 146.100,00 $ |
| §117 | Colchon de capital tras el setup | 13.900 $ | 13.900,00 $ |
| §118 | Duracion de PLOW sobre 250 celdas | aproximadamente 70 h | 70,03 h |
| §118 | Duracion de SEED sobre 250 celdas | aproximadamente 61 h | 61,27 h |
| §118 | Duracion de HARVEST sobre 250 celdas | aproximadamente 98 h | 98,04 h |
| §118 | Duracion total del ciclo | aproximadamente 325 h | 325,34 h |
| §119 | Rendimiento con la hipotesis de malezas del propio §119 | aproximadamente 20.700 L | 20700 L |
| §121 | Punto de equilibrio del setup minimo | formula; §119 anticipa que el primer ciclo no es rentable | 551,41 ciclos |
| §138 | Volumen de la primera tala de 250 celdas de bosque maduro | aproximadamente 382 m3 | 382,5 m3 |
| §138 | Ingreso de la primera tala | aproximadamente 17.190 $ | 17.212,50 $ |

## 7. Efecto de la tasa de malezas de GDD §82 sobre el primer ciclo

Es el hallazgo principal del informe y el que mas dinero mueve.

GDD §82 fija `weedGrowthRate` en 0,6 %/h. Desde la revision de 2026-08 las malezas crecen solo en los estados GROWING (lectura estricta del hallazgo H8), que en este ciclo suman 78 h de las 325,34 h totales: las tareas de arado y cosecha, durante las que el campo esta siendo trabajado, quedan excluidas, igual que las fases de sembrado y germinacion.

| Magnitud | Valor |
|---|---|
| Tasa de GDD §82 | 0,6 %/h |
| Horas del ciclo con crecimiento de malezas | 78 h |
| Horas necesarias para saturar al 100 % | 166,67 h |
| Nivel proyectado sin techo | 46,8 % |
| Nivel efectivo al cosechar | 46,8 % |
| Penalizacion de GDD §78 a ese nivel | 18,72 % |
| Rendimiento resultante | 18.288 L |
| Ingreso resultante | 16.459,20 $ |
| Rendimiento que supone GDD §119 | 20.700 L |
| Ingreso que supone GDD §119 | 18.630,00 $ |
| Diferencia de rendimiento | 2.412 L |
| Diferencia de ingreso | 2.170,80 $ |

### 7.1 CULTIVATE no cambia el ingreso del ciclo

La seccion 2.2 del plan preveia que `CULTIVATE`, que GDD §82 declara opcional para el trigo,
tuviera un uso estrategico real: resetear las malezas antes de sembrar. La calculadora mide
ese supuesto y, bajo la lectura H8 de la revision de 2026-08, no se sostiene.

Aunque el jugador cultive justo antes de sembrar, quedan 78 h de crecimiento de malezas hasta la cosecha, que a 0,6 %/h llevan el nivel a 46,8 %. Es exactamente el mismo nivel que sin cultivar: toda la acumulacion es posterior a la siembra, de modo que el reseteo no toca el ingreso del ciclo. Devolver a las malezas un papel de decision queda registrado como asunto abierto de la revision.

### 7.2 Que valor tendria que tener la tasa

Para que el nivel de malezas al cosechar fuera el 20 % que GDD §119 supone, la tasa tendria que ser 0,2564 %/h en lugar de 0,6 %/h, es decir unas 2,34 veces menos.

Se deja constancia y no se aplica: la revision de 2026-08 mantuvo la tasa de GDD §82 y
corrigio los estados de acumulacion, que era la desviacion de mas peso.

## 8. Punto de equilibrio de GDD §121 y magnitud de las palancas de GDD §120

```text
breakEvenCycles = totalUpfrontInvestment / (revenuePerCycle - holdingCostPerCycle)
```

GDD §121 declara que un denominador negativo significa que no hay equilibrio y que la granja
quiebra, y anade que es el KPI principal a vigilar. Con el catalogo literal era exactamente el
caso; con la revision de 2026-08 el margen es positivo en los dos escenarios: ajustado en la
compra completa, que es el episodio de deuda de caja buscado por diseno, y claro en la compra
escalonada, que es la estrategia que GDD §120 recomienda.

| Escenario | Ingreso por ciclo | Coste por ciclo | Margen | Ciclos hasta equilibrio |
|---|---|---|---|---|
| Setup minimo viable, compra completa el dia uno | 16.459,20 $ | 16.194,24 $ | 264,96 $ | 551,41 |
| Setup minimo viable, compra escalonada | 16.459,20 $ | 12.784,71 $ | 3.674,49 $ | 39,76 |

Magnitud de cada palanca de GDD §120 respecto del punto de equilibrio del ciclo, sobre el
escenario de compra completa. Son cifras informativas que situan el margen actual; ninguna se
aplica sobre el catalogo.

| Palanca | Que haria falta |
|---|---|
| A. Reducir el coste de posesion | Bajarlo de 16.194,24 $ a menos de 16.459,20 $, es decir un -1,64 % menos. |
| B1. Subir el precio de venta | De 0,90 $/L a 0,89 $/L con el rendimiento efectivo del ciclo. |
| B2. Subir el rendimiento | De 18.288 L a 17.993 L por ciclo al precio publicado, lo que con 90 L por celda exigiria un campo de 200 celdas si no hubiera penalizacion. |
| C. Acortar el ciclo economico | El multiplicador de tiempo es configuracion de servidor (plan seccion 6.1) y no cambia el balance: todos los costes del GDD estan por hora de juego, de modo que acelerar el reloj acelera por igual el ingreso y el gasto. Lo que si acorta el ciclo economico es `growthDuration` de GDD §82. |

## 9. Consecuencias ya implementadas

Tras la revision de 2026-08 el deficit ya no es el estado permanente del ciclo, pero el paso
por deuda sigue siendo parte del diseno: quien compra toda la flota el dia uno devenga mas que
el colchon de capital antes de vender la cosecha y atraviesa `IN_DEBT` durante la cosecha. Lo
que el juego hace con el saldo negativo esta implementado y probado, no pendiente:

- **Saldo negativo permitido.** El devengo continuo puede llevar el saldo por debajo de cero
  sin ninguna restriccion de base de datos que lo impida, porque impedirlo rechazaria el
  propio devengo (plan seccion 6.2).
- **`IN_DEBT` derivado.** Bloquea el gasto discrecional y no bloquea vender ni asignar tareas,
  que son la unica via de ingreso. Bloquearlas produciria un bloqueo permanente.
- **Interes de descubierto** como cuarto tipo de devengo, con tasa 0 % por hora de juego. Existe para ser una
  palanca disponible sin migracion; con el episodio de deuda de caja del primer ciclo como
  parte del diseno, cobrarlo es una decision de balance pendiente y no un valor olvidado.
- **Liquidacion forzosa** por encima del 30 % del valor liquidable, en el orden publicado (INVENTORY, IDLE_MACHINES, CANCEL_TASKS, WORKERS, BUILDINGS, UNUSED_LAND), con un asiento por activo vendido para que el resumen de
  regreso pueda explicar que se vendio y por que. La dispara el barrido periodico y no el
  login, de modo que nunca aparece como castigo retroactivo por haber estado ausente.
- **Factor de reventa** del 60 %, escalado ademas por la condicion en el caso de la maquinaria.
- **`BANKRUPT` reservado y nunca producido.** Terminar la partida de alguien que estaba
  desconectado no es aceptable en un juego asincrono.

Alcance real de la liquidacion en esta fase, para que el informe no prometa mas de lo que el
codigo hace: de los seis pasos del orden publicado estan activos INVENTORY, IDLE_MACHINES y
WORKERS. Los otros tres estan declarados y sin estrategia porque su semantica pertenece a otro
modulo: CANCEL_TASKS a `modules/tasks`, BUILDINGS a `modules/farms` y UNUSED_LAND a
`modules/world`. El motor recorre el orden completo y el asiento agregado de cada liquidacion
registra los pasos que ejecuto y los que no.
