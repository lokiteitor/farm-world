# Balance del MVP: informe para revisión externa

> **Nota (agosto de 2026).** Este informe describe el estado anterior a la revisión de
> balance registrada en `docs/balance/revision-2026-08.md`, que ajustó el precio de venta,
> las tasas de maquinaria, la recta salarial y los estados de crecimiento de malezas. Se
> conserva sin modificar como registro del estado que motivó dicha revisión; sus cifras ya
> no describen el catálogo vigente.

Documento redactado para que un revisor sin contexto previo pueda auditar el balance económico del
juego y las decisiones tomadas alrededor de él. No requiere haber seguido la implementación.

Fuentes que el revisor puede necesitar, todas en este repositorio:

| Documento | Contenido |
|---|---|
| `docs/GDD_Farming_Management_Simulator_Online_v0.4.md` | Diseño del juego. Las secciones citadas con § son suyas |
| `docs/balance/informe-balance.md` | Informe generado por la calculadora, con el detalle completo |
| `docs/balance/kpis.json` | Los mismos datos en formato legible por máquina |
| `docs/erratas-gdd-stack.md` | Contradicciones detectadas en el GDD y su resolución adoptada |
| `docs/revision-formulas.md` | Revisión adversarial previa de las fórmulas, con nueve hallazgos |
| `shared/config/` | Todas las constantes de balance, con la sección del GDD citada en cada una |
| `shared/rules/` | Las fórmulas puras, compartidas por servidor, cliente y calculadora |
| `tools/balance/` | La calculadora que genera el informe |

Reproducción: `make balance`. Es determinista, produce bytes idénticos entre ejecuciones y no lleva
marca de tiempo, de modo que el fichero solo cambia si cambia una constante.

---

## 1. Qué se pide revisar

Cuatro preguntas concretas, en orden de importancia. Las tres primeras son de análisis; la cuarta es
de diseño.

1. **¿Es correcta la conclusión de que el balance publicado en el GDD no es viable?** Se sostiene aquí
   que sí, y que además es robusta frente a cualquier interpretación razonable de las ambigüedades del
   documento. La sección 4 da el argumento y la sección 6 los puntos donde podría estar equivocado.
2. **¿Es correcta la interpretación adoptada sobre en qué fases crecen las malezas?** Es la decisión
   con más peso económico del sistema y la más discutible. La sección 5 la expone con las lecturas
   alternativas ya calculadas.
3. **¿Hay algún error de cálculo o de atribución en la comparación entre lo publicado y lo
   calculado?** La sección 3 lista las 9 cifras del GDD que su propio catálogo no reproduce.
4. **Si hubiera que ajustar el balance, ¿qué constante debería moverse y cuánto?** La sección 7 mide
   la magnitud de cada palanca. No se ha aplicado ninguna, por decisión expresa del propietario del
   proyecto.

---

## 2. Contexto y decisión de partida

El juego es un simulador de gestión agrícola y forestal online, con servidor autoritativo y simulación
basada en eventos. El GDD especifica el balance del MVP en sus secciones §113 a §127, y advierte en la
cabecera de esa parte que los valores numéricos son ilustrativos y requieren validación mediante
playtesting.

El propio GDD detecta el problema en §119 y §120: calcula que el primer ciclo agrícola produce unos
4.554 $ de ingreso frente a unos 27.625 $ de coste de posesión, concluye que no es rentable, y
recomienda combinar dos palancas correctoras. §125 fija además el objetivo de balance del MVP: un
ratio ingreso/coste del primer ciclo entre 1,3 y 1,8.

**Decisión tomada al planificar el proyecto, y que condiciona todo lo que sigue: implementar los
valores del GDD literalmente, sin ajustar ninguno, y documentar la desviación.** La alternativa
—aplicar las palancas de §120 hasta alcanzar el objetivo de §125— se descartó expresamente. Por tanto
este informe no es una propuesta de ajuste: es la medición de lo que el catálogo del GDD produce.

Consecuencia metodológica: cuando el GDD se contradice consigo mismo, la regla adoptada es que **las
constantes de catálogo mandan** (§82 cultivos, §89 y §134 maquinaria, §115 tierra, §116 edificios,
§133 especies), y los números derivados que aparecen en los ejemplos (§117, §118, §119, §138) son
aritmética ilustrativa que se comprueba, se reproduce cuando es posible y se documenta cuando no.

---

## 3. Datos

### 3.1 Los seis KPI de §125

Tres escenarios. El primero es la lectura literal de §117 y §118; el segundo aplica la compra
escalonada que §120 recomienda; el tercero fija el nivel de malezas en el 20 % que §119 supone, para
aislar el efecto de esa única variable.

| Escenario | 1. Setup mínimo | 2. Coste por ciclo | 3. Ingreso por ciclo | 4. Ratio | 5. Equilibrio | 6. Colchón |
|---|---:|---:|---:|---:|---|---:|
| Compra completa el día uno | 146.100,00 $ | 25.688,78 $ | 2.475,00 $ | **0,096** | No existe | 13.900,00 $ |
| Compra escalonada (§120) | 146.100,00 $ | 20.006,22 $ | 2.475,00 $ | **0,124** | No existe | 13.900,00 $ |
| Con la hipótesis de malezas de §119 | 146.100,00 $ | 25.688,78 $ | 4.554,00 $ | **0,177** | No existe | 13.900,00 $ |

Objetivo de §125: ratio entre 1,3 y 1,8. El mejor de los tres escenarios queda un orden de magnitud
por debajo.

Desglose del coste por ciclo en el escenario de compra completa, sobre una ventana de 325,34 horas de
juego: salarios 4.880,13 $, mantenimiento 12.037,64 $, operación 8.771,01 $, interés de descubierto
0,00 $.

Desglose del rendimiento: 250 celdas × 90 L/celda = 22.500 L base; multiplicador de fertilidad 1,0;
multiplicador de fertilización 1,0; penalización por malezas 50 %; resultado 11.250 L a 0,22 $/L.

### 3.2 Lo que el catálogo del GDD sí reproduce

De 24 cifras publicadas que la calculadora comprueba, 15 se reproducen exactamente. Entre ellas todo
§117 (tierra 39.600 $, edificios 23.000 $, maquinaria 83.500 $, total 146.100 $, colchón 13.900 $),
las cuatro duraciones de §118 (70,03 h de arado, 61,27 h de siembra, 98,04 h de cosecha, 325,34 h de
ciclo), el rendimiento y el ingreso de §119 bajo su propia hipótesis de malezas (20.700 L y 4.554 $), y
el volumen e ingreso de la primera tala de §138 (382,5 m³ y 17.212,50 $).

Se señala porque un informe que solo enumerase los desajustes daría a entender que el catálogo no
sostiene el documento, y no es el caso: la mayor parte de las cifras del GDD salen de sus propias
constantes.

### 3.3 Lo que el catálogo del GDD no reproduce

Nueve cifras. Ordenadas por impacto económico.

| § | Concepto | Publicado | Calculado | Causa |
|---|---|---:|---:|---|
| §119 vs §82 | Malezas al cosechar | ~20 % | 100 % (147,6 % sin techo) | La tasa de §82 es 0,6 %/h y el ciclo tiene 246,07 h de crecimiento: satura a las 166,67 h |
| §119 vs §78 | Rendimiento e ingreso reales | 20.700 L / 4.554 $ | 11.250 L / 2.475,00 $ | Consecuencia de la anterior: penalización máxima del 50 % en vez del 8 % |
| §118 vs §89 | Mantenimiento combinado | ~70 $/h | 37,00 $/h | §89 solo asigna `maintenanceCost` al tractor (12 $/h) y a la cosechadora (25 $/h). Arado, sembradora y remolque no tienen ninguno |
| §118 | Mantenimiento del ciclo | 22.750 $ | 12.037,64 $ | Consecuencia directa de la anterior |
| §118 | Coste de posesión del ciclo | 27.625 $ | 16.917,77 $ sin operación · 25.688,78 $ con ella | Dos desviaciones que se compensan en parte: el mantenimiento del catálogo es la mitad del supuesto, y §118 omite el `operatingCost` que §107 y §114 declaran aditivo |
| §117 vs §36 vs §102 | Salario del trabajador inicial | 15 $/h · 30 $/h · 12-31 $/h | 22,75 $/h para habilidad 70 % | Las tres cifras del GDD son incompatibles entre sí |
| §117 vs §118 | Habilidad del trabajador inicial | ~60 % | 70 % | Las duraciones de §118 exigen un factor de 0,85, que en la curva de §103 corresponde al 70 % |
| §133 vs §138 | Edad al alcanzar `OLD_GROWTH` | 960 h | 720 h | Cuatro fases tienen tres fronteras: 4 × 240 h cuenta una fase de más |
| §116 vs §117 | `realBuildingCost` literal | fórmula con huella | 32.600 $ frente a los 23.000 $ que §117 cobra | Aplicar la fórmula al pie de la letra cobra el suelo dos veces al jugador que ya lo posee |

---

## 4. La conclusión y por qué es robusta

El argumento central de este informe no depende de ninguna de las interpretaciones discutibles de la
sección 6, y conviene enunciarlo por separado para que el revisor pueda atacarlo directamente.

**Tomando los números del GDD enteramente al pie de la letra, sin ninguna intervención de esta
implementación, el ratio de §125 es 0,165.** Es decir: 4.554 $ de ingreso, que es el número que §119
publica, dividido entre 27.625 $ de coste de posesión, que es el número que §118 publica. Frente a un
objetivo declarado de 1,3 a 1,8.

De ahí se sigue que:

- El déficit no es un artefacto de esta implementación. Está en la aritmética del propio documento, y
  el documento lo reconoce en §119 y §120.
- Ninguna de las discrepancias de la sección 3.3 explica la brecha. Todas juntas mueven el ratio entre
  0,096 y 0,177; el objetivo está entre 1,3 y 1,8. Faltan aproximadamente **un orden de magnitud**.
- Por tanto, la pregunta útil no es si el cálculo es correcto, sino qué constante del catálogo está mal
  dimensionada y en qué factor. La sección 7 lo cuantifica.

---

## 5. El punto más discutible: en qué fases crecen las malezas

§78 dice que el nivel de malezas aumenta automáticamente mientras el campo está en `GROWING`, en
`READY_TO_HARVEST` sin cosechar, o en `VIRGIN` sin trabajar.

La implementación cuenta 246,07 h de las 325,34 h del ciclo, que se descomponen así:

| Tramo | Horas | Estado del campo |
|---|---:|---|
| Duración de la tarea de arado | 70,03 | `VIRGIN`, mientras se ara |
| Fase de crecimiento | 78,00 | `GROWING` |
| Duración de la tarea de cosecha | 98,04 | `READY_TO_HARVEST`, mientras se cosecha |
| **Total** | **246,07** | |

**La objeción, que el revisor debería sopesar:** durante la tarea de arado el campo está siendo
trabajado, y durante la tarea de cosecha está siendo cosechado. Una lectura literal de «`VIRGIN` sin
trabajar» y «`READY_TO_HARVEST` sin cosechar» excluiría ambos tramos y dejaría solo las 78 h de
`GROWING`. Esta objeción está registrada como hallazgo H8 en `docs/revision-formulas.md` y **no se ha
aplicado**, precisamente por ser interpretativa y no un defecto claro.

Efecto medido de cada lectura, calculado con las reglas puras del propio juego
(`shared/rules/yield.ts`), no a mano:

| Lectura | Horas | Malezas | Penalización | Litros | Ingreso | Ratio | Neto por ciclo |
|---|---:|---:|---:|---:|---:|---:|---:|
| A. Implementada (arado + `GROWING` + cosecha) | 246,07 | 100,0 % | 50,00 % | 11.250 | 2.475,00 $ | 0,096 | −23.213,78 $ |
| B. Solo `GROWING` | 78,00 | 46,8 % | 18,72 % | 18.288 | 4.023,36 $ | 0,157 | −21.665,42 $ |
| C. `GROWING` más 24 h de espera antes de cosechar | 102,00 | 61,2 % | 26,72 % | 16.488 | 3.627,36 $ | 0,141 | −22.061,42 $ |
| D. El 20 % que supone §119 | 33,33 | 20,0 % | 8,00 % | 20.700 | 4.554,00 $ | 0,177 | −21.134,78 $ |

Obsérvese que ni siquiera la lectura más favorable al jugador, que es la que el propio §119 supone,
acerca el ratio al objetivo. **La interpretación de las malezas mueve el ingreso en un factor de 1,84 y
el objetivo exige un factor de 13,5.**

### 5.1 Un supuesto de diseño que la medición desmiente

Al planificar el proyecto se anticipó que implementar la tasa literal de §82 tendría una consecuencia
positiva: daría a la operación `CULTIVATE`, que §82 declara opcional para el trigo, un uso estratégico
real, el de resetear las malezas antes de sembrar.

La calculadora mide ese supuesto y **no se sostiene con estas constantes**. Aunque el jugador cultive
justo antes de sembrar, quedan 176,04 h de crecimiento hasta la cosecha —la fase `GROWING` más la
propia tarea de cosecha—, que a 0,6 %/h vuelven a llevar el nivel al 100 %. Cultivar no cambia el
ingreso del ciclo: solo adelanta el instante en que el campo queda limpio.

Bajo la lectura B de la tabla anterior, cultivar tampoco cambiaría nada, porque las 78 h de `GROWING`
son posteriores a la siembra en cualquier caso.

---

## 6. Dónde puede estar equivocado este informe

Se enumeran los puntos débiles conocidos para que la revisión pueda atacarlos directamente en lugar de
tener que descubrirlos.

1. **La interpretación de las malezas** de la sección 5. Es la más consecuente y la menos cerrada.
2. **El salario usado en el escenario.** La cifra de salarios del ciclo, 4.880,13 $, corresponde a
   15 $/h, que es el valor de §117. Pero la regla procedural de contratación de §102, que es la que el
   juego usa realmente para generar candidatos, produce 22,75 $/h para una habilidad del 70 %. Si el
   escenario usara el salario que el jugador encontraría de verdad en el pool, el coste del ciclo
   subiría en unos 2.521 $ y el ratio bajaría a 0,088. **El informe, en este punto, es optimista.**
3. **La inclusión del coste de operación en el KPI 2.** §114 define «coste de posesión» como
   mantenimiento más salarios, y separa el coste de operación como una tercera categoría. El KPI 2
   publicado (25.688,78 $) incluye la operación; sin ella serían 16.917,77 $ y el ratio subiría a
   0,146. La inclusión se justifica porque §125 pide «coste de posesión por ciclo completo» y lo que el
   jugador soporta durante el ciclo incluye la operación, pero es discutible y está señalado como
   hallazgo H7 en `docs/revision-formulas.md`.
4. **El mantenimiento nulo de los implementos.** Se implementa el catálogo de §89 literalmente. Cabe la
   lectura contraria: que la cifra de ~70 $/h de §118 sea evidencia de que el catálogo está incompleto
   y de que los implementos deberían tener mantenimiento. Adoptarla empeoraría el ratio, no lo
   mejoraría, porque sube el coste.
5. **La habilidad del 70 %.** Se eligió para reproducir las duraciones de §118. Con el ~60 % que §117
   menciona, las duraciones crecen un 6 % aproximadamente, el ciclo se alarga y el coste sube.
6. **El campo de 250 celdas.** Es el tamaño de §117. Un campo mayor mejora el ratio, porque el coste
   fijo de maquinaria se reparte sobre más producción, que es exactamente el mecanismo que §122
   describe. La sección 7 cuantifica cuánto haría falta.

---

## 7. Magnitud de las palancas, si hubiera que ajustar

Cifras informativas. **Ninguna se ha aplicado.** Todas calculadas sobre el escenario de compra completa
el día uno.

| Palanca | Qué haría falta | Factor |
|---|---|---:|
| A. Reducir el coste de posesión | De 25.688,78 $ a menos de 2.475,00 $ por ciclo | −90,4 % |
| B1. Subir el precio de venta | De 0,22 $/L a 2,28 $/L | ×10,4 |
| B2. Subir el rendimiento base | De 11.250 L a 116.767 L por ciclo, lo que con 90 L/celda exigiría un campo de 1.297 celdas | ×10,4 |
| C. Acortar el ciclo económico | Reduciendo `growthDuration` de §82. El multiplicador de tiempo **no** sirve: todos los costes del GDD están por hora de juego, de modo que acelerar el reloj acelera por igual el ingreso y el gasto | — |
| Malezas | Bajar la tasa de §82 de 0,6 %/h a 0,0813 %/h para alcanzar el 20 % que supone §119 | ÷7,38 |

Nota sobre la palanca C, que merece atención del revisor: **§120 recomienda un «multiplicador de tiempo
más agresivo» como palanca de balance, y eso es un error de razonamiento del GDD.** El multiplicador
convierte horas de juego en horas reales; como el ingreso y todos los costes están expresados por hora
de juego, cambiarlo no altera ninguna ratio económica. Solo cambia cuánto tarda el jugador en vivir el
ciclo en tiempo real. Lo que sí acorta el ciclo económico es reducir la duración de crecimiento del
cultivo.

Las palancas no son independientes: combinar A al 50 % con B2 duplicando el tamaño del campo daría un
ratio de 0,39, todavía lejos del objetivo. Para alcanzar 1,3 hace falta una combinación agresiva de al
menos dos de ellas, o revisar el precio de venta del trigo, que es la constante que más
desproporcionada parece frente al coste de la maquinaria que lo produce.

---

## 8. Qué hace el juego hoy con el déficit

Se detalla porque condiciona la respuesta a la pregunta 4: el sistema está preparado para que el
déficit sea jugable, no para ignorarlo. Todo lo siguiente está implementado y probado.

- **Saldo negativo permitido.** El devengo continuo puede llevar el saldo por debajo de cero. No hay
  restricción de base de datos que lo impida, porque impedirlo rechazaría el propio devengo.
- **Estado `IN_DEBT` derivado.** Bloquea el gasto discrecional (tierra, maquinaria, edificios,
  contratación, reparación) y no bloquea vender ni asignar tareas, que son la única vía de ingreso.
  Bloquearlas produciría un bloqueo permanente en un juego asíncrono.
- **Interés de descubierto** como cuarto tipo de devengo, con tasa 0 % por hora de juego. Existe para
  ser una palanca disponible sin migración de esquema.
- **Liquidación forzosa** por encima del 30 % del valor liquidable, en orden determinista y publicado
  (inventario, máquinas ociosas, cancelación de tareas, trabajadores, edificios, tierra sin campo), con
  un asiento contable por activo vendido para que el resumen de regreso pueda explicar qué se vendió y
  por qué. La dispara el barrido periódico y no el inicio de sesión, de modo que no aparezca como
  castigo retroactivo por haber estado ausente.
- **Factor de reventa** del 60 %, escalado además por la condición en el caso de la maquinaria.
- **Estado `BANKRUPT` reservado y nunca producido.** Terminar la partida de alguien que estaba
  desconectado se consideró inaceptable en un juego asíncrono.

Hay además una comprobación de extremo a extremo, `make smoke`, que recorre el bucle completo del juego
por HTTP contra la pila real. Es relevante para esta discusión por un detalle: **para completar el
bucle tiene que inyectar capital marcado explícitamente como ajeno al juego.** Con los 160.000 $ de
capital inicial de §117, la partida no llega al final del primer ciclo. Es la demostración operativa
más directa del problema que este informe describe.

---

## 9. Resumen para el revisor

- El balance publicado en el GDD no alcanza su propio objetivo declarado, por aproximadamente un orden
  de magnitud, y esto se puede comprobar sin salir del documento: 4.554 $ entre 27.625 $ da 0,165
  frente a un objetivo de 1,3 a 1,8.
- La implementación reproduce 15 de las 24 cifras comprobables del GDD. Las 9 que no reproduce están
  documentadas con su causa, y ninguna explica la brecha.
- La decisión de no ajustar las constantes es del propietario del proyecto y es deliberada. Este
  informe mide, no propone.
- El punto más frágil del análisis es la interpretación de en qué fases crecen las malezas, y aun así
  las cuatro lecturas posibles dejan el ratio entre 0,096 y 0,177.
- El punto donde el informe es demasiado benévolo consigo mismo es el salario: usa el de §117 y no el
  que la regla de contratación del propio juego produciría, lo que mejora artificialmente el ratio.
