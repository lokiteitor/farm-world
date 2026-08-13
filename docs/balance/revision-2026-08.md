# Revisión de balance de agosto de 2026

Registro de la primera intervención deliberada sobre el balance del MVP. Sustituye la decisión
de partida del proyecto —implementar los valores del GDD v0.4 literalmente y documentar la
desviación— por un conjunto de constantes revisadas. El estado que motivó la intervención está
medido en `docs/balance/informe-para-revision.md`, que se conserva sin modificar como registro
histórico; el informe generado (`docs/balance/informe-balance.md`, `make balance`) refleja
desde esta revisión el catálogo vigente.

## 1. Punto de partida

Con el catálogo literal del GDD, el primer ciclo agrícola producía 2.475 $ de ingreso frente a
25.688,78 $ de coste de posesión (ratio 0,096), no existía punto de equilibrio bajo ninguna
lectura de las ambigüedades del documento, y la comprobación de extremo a extremo necesitaba
inyectar capital ajeno al juego para completar el bucle. El déficit no era un artefacto de la
implementación: tomando los números publicados por el propio GDD, el ratio era 0,165 frente a
un objetivo declarado de 1,3 a 1,8 (§125).

## 2. Decisiones adoptadas

Tomadas por el propietario del proyecto sobre las alternativas presentadas, en este orden:

1. **Objetivo de balance: primer ciclo deficitario controlado**, en lugar del ratio 1,3–1,8 de
   §125. El sistema de deuda (`IN_DEBT`, liquidación forzosa) forma parte del diseño y debe
   ejercitarse en la partida normal, no quedar como código muerto.
2. **Malezas: lectura estricta del hallazgo H8** (`docs/revision-formulas.md`). Las malezas
   crecen únicamente en `GROWING`; durante el arado (`VIRGIN`) y la cosecha
   (`READY_TO_HARVEST`) el campo está siendo trabajado y queda excluido.
3. **Palancas autorizadas**: precio de venta del trigo, costes horarios de maquinaria y recta
   salarial. La duración del ciclo (`growthDuration`) no se tocó.
4. **Salario del escenario de KPIs**: el que la regla de contratación de §102 produce
   realmente para el trabajador inicial del 70 %, en lugar del 15 $/h de §117 que el informe
   histórico señalaba como sesgo optimista.
5. **Precio del trigo: 0,90 $/L**, la opción de tensión máxima entre las presentadas: la
   compra completa queda casi neutra y solo la compra escalonada es claramente rentable.
6. **Silvicultura escalada a la par** que la maquinaria agrícola, para no dejarla
   comparativamente inviable.

## 3. Cambios de constantes

| Constante | Fichero | Anterior (GDD) | Revisado |
|---|---|---:|---:|
| `sellPricePerLiter` (trigo) | `shared/config/crops.ts` | 0,22 $/L | 0,90 $/L |
| `WEED_GROWTH_STATES` | `shared/config/transitions.ts` | `GROWING`, `READY_TO_HARVEST`, `VIRGIN` | `GROWING` |
| Tractor, mantenimiento / operación | `shared/config/machines.ts` | 12 / 22 $/h | 6 / 10 $/h |
| Cosechadora, mantenimiento / operación | `shared/config/machines.ts` | 25 / 60 $/h | 15 / 30 $/h |
| Cosechadora forestal, mantenimiento / operación | `shared/config/machines.ts` | 30 / 70 $/h | 15 / 35 $/h |
| `SALARY_INTERCEPT` / `SALARY_PER_SKILL_POINT` | `shared/config/workers.ts` | −8,75 / 0,45 | −6 / 0,31 |
| Salario del escenario de KPIs | `shared/rules/balance.ts` | 15 $/h (§117) | 15,70 $/h (regla de §102 revisada al 70 %) |

Sin cambios: precios de compra de maquinaria, tierra y edificios; capital inicial y colchón;
tasa de malezas de §82 (0,6 %/h); duraciones y velocidades de trabajo; rendimiento base y
curvas de §77–§79; factor de reventa y umbral de liquidación; interés de descubierto (0 %).

## 4. Resultado medido

Cifras de `make balance` tras la revisión, frente a las del informe histórico:

| Escenario | Coste/ciclo | Ingreso/ciclo | Ratio | Neto/ciclo | Equilibrio |
|---|---:|---:|---:|---:|---:|
| Compra completa (antes) | 25.688,78 $ | 2.475,00 $ | 0,096 | −23.213,78 $ | No existe |
| Compra completa (después) | 16.194,24 $ | 16.459,20 $ | 1,016 | +264,96 $ | 551,4 ciclos |
| Compra escalonada (antes) | 20.006,22 $ | 2.475,00 $ | 0,124 | −17.531,22 $ | No existe |
| Compra escalonada (después) | 12.784,71 $ | 16.459,20 $ | 1,287 | +3.674,49 $ | 39,8 ciclos |

Malezas al cosechar: 46,8 % (penalización 18,72 %, 18.288 L), frente al 100 % saturado
(penalización 50 %, 11.250 L) de la lectura anterior y en el orden del ~20 % que §119 supone.

## 5. La estructura del déficit controlado

Con flota y campo fijos, el coste y el ingreso por ciclo son idénticos en todos los ciclos, de
modo que un primer ciclo con neto negativo y ciclos posteriores positivos es estructuralmente
imposible. El déficit del primer ciclo se materializa por caja:

- El jugador que compra toda la flota el día uno conserva un colchón de 13.900 $ y devenga
  16.194,24 $ durante el ciclo. El saldo entra en negativo unos 2.300 $ durante la cosecha,
  el jugador atraviesa `IN_DEBT` (gasto discrecional bloqueado, venta y tareas permitidas) y
  la venta de la cosecha lo rescata. La distancia al umbral de liquidación forzosa
  (aproximadamente 26.000 $ de deuda para ese patrimonio) es amplia.
- El jugador que sigue la compra escalonada que §120 recomienda no toca la deuda y obtiene
  un neto de +3.674,49 $ por ciclo. La diferencia entre ambas estrategias es la enseñanza
  que §120 pretende.
- La progresión real no está en repetir el ciclo (el neto de la compra completa es casi
  neutro) sino en ampliar campo, que reparte el coste fijo sobre más producción (§122).

## 6. Efectos colaterales aplicados

- Tests actualizados al balance revisado: `catalog.test.ts`, `yield.test.ts`,
  `holding.test.ts`, `pricing.test.ts`, `balance-golden.test.ts` (shared);
  `projection.test.ts`, `pool.test.ts`, `debt.int.test.ts`, `ledger.int.test.ts`,
  `liquidation.int.test.ts`, `market.int.test.ts`, `machinery.int.test.ts`,
  `repair.int.test.ts` (backend). La batería completa (`make test`) pasa.
- Prosa del generador del informe (`tools/balance/`) corregida: ya no afirma que ninguna
  constante se ajusta, y las causas de las desviaciones distinguen las internas del GDD de
  las introducidas por esta revisión.
- Comentarios de los catálogos (`crops.ts`, `machines.ts`, `workers.ts`, `transitions.ts`)
  actualizados con la referencia a este documento.

## 7. Asuntos abiertos

1. **`CULTIVATE` carece de uso económico.** Bajo la lectura H8 toda la acumulación de malezas
   es posterior a la siembra, de modo que resetearlas antes de sembrar no cambia el ingreso.
   Devolver a la operación un papel de decisión exige acumulación por tiempo ocioso (véase el
   punto siguiente) o un rediseño de la mecánica.
2. **El abandono no se castiga.** Al excluir `VIRGIN` y `READY_TO_HARVEST`, un campo listo y
   sin cosechar o virgen y desatendido no acumula malezas. La lectura fiel de §78 («sin
   cosechar», «sin trabajar») exigiría acumular en esos estados solo mientras no hay tarea
   activa sobre el campo, lo que requiere liquidación consciente de tareas en la proyección
   del servidor. Registrado como mejora, no implementado.
3. **Interés de descubierto al 0 %.** Con el episodio de deuda de caja como parte del diseño,
   activar una tasa moderada es ahora una decisión de balance con efecto real, disponible sin
   migración.
4. **La comprobación `make smoke` sigue inyectando capital marcado como ajeno al juego.**
   Con el balance revisado cabe reevaluar si el bucle completo se sostiene con los 160.000 $
   iniciales y retirar la inyección.
5. **El GDD v0.4 queda desactualizado** en §82 (precio), §89 y §134 (tasas), §102 (ejemplos
   salariales) y §78 (estados de malezas). Si el documento se revisa, esta tabla de la
   sección 3 es la lista de cambios que debe incorporar.
6. **El objetivo de §125 (ratio 1,3–1,8) no se adoptó.** El ratio de la compra escalonada
   (1,287) queda justo por debajo de la banda; el de la compra completa (1,016) muy por
   debajo, por decisión expresa. Si el playtesting mostrara que la tensión es excesiva, la
   palanca de ajuste fino es el precio del trigo (cada céntimo mueve el ingreso del ciclo en
   unos 183 $).
