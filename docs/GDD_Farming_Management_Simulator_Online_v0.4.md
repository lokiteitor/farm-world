# Game Design Document — Farming Management Simulator Online

**Versión:** 0.4
**Estado:** Diseño conceptual consolidado + sistemas detallados (agrícola, maquinaria, trabajadores, economía, silvicultura)
**Plataforma:** Web
**Motor frontend:** Phaser.js
**Perspectiva:** Top-down 2D
**Género:** Farming / Forestry / Management / Simulation / Idle
**Modelo:** Online, persistente, server-authoritative
**Multiplayer:** No necesariamente interacción directa entre jugadores en el MVP; arquitectura preparada para ello.

**Notas de esta versión:** Se integran los addenda de Sistema Agrícola (§75-86), Maquinaria (§87-99), Trabajadores (§100-112), Economía y Balance (§113-127) y Silvicultura (§128-142) directamente como continuación numerada del documento base. Los valores numéricos marcados como "ilustrativos" en las secciones de economía requieren validación mediante playtesting y no son balance final.

---

# PARTE I — VISIÓN, PILARES Y MUNDO

## 1. Visión del juego

El juego es un **simulador de gestión agrícola y forestal online**, inspirado en sistemas de planificación y gestión de juegos como *Farming Simulator* y *Farm Planner*, pero diseñado alrededor de un mundo procedural persistente y una economía completamente gestionada por el jugador.

El jugador comienza con un **capital inicial limitado**.

Debe utilizarlo para:

1. Comprar tierras vírgenes.
2. Construir su primera granja.
3. Comprar maquinaria.
4. Contratar trabajadores.
5. Crear campos agrícolas.
6. Cultivar y cosechar.
7. Gestionar bosques.
8. Vender producción.
9. Reinvertir las ganancias.
10. Expandir progresivamente su explotación.

La maquinaria no es controlada directamente por el jugador.

Los **trabajadores contratados conducen la maquinaria y realizan las labores**.

El juego continúa funcionando cuando el jugador está desconectado. El backend mantiene la simulación y calcula el progreso cuando corresponde.

---

## 2. Fantasía del jugador

La fantasía central es:

> **Comenzar como un pequeño propietario rural y convertir una extensión de terreno virgen en una empresa agrícola y forestal rentable.**

```text
Pequeño propietario
       ↓
Primera granja
       ↓
Primer campo
       ↓
Primera cosecha
       ↓
Más maquinaria
       ↓
Más trabajadores
       ↓
Más tierras
       ↓
Más infraestructura
       ↓
Explotación agrícola
       ↓
Empresa agrícola / forestal
```

---

## 3. Pilares de diseño

### 3.1 Expansión territorial

La tierra es un recurso estratégico limitado por capital, ubicación, terreno, accesibilidad e infraestructura.

### 3.2 Creación y gestión de campos

Comprar tierra no crea automáticamente un campo. El jugador decide dónde, con qué forma y tamaño crear campos, cuándo ampliarlos, dividirlos o fusionarlos. Los campos pueden ocupar múltiples chunks.

### 3.3 Gestión de maquinaria

El jugador debe **poseer la maquinaria necesaria**. No existe contratación de servicios agrícolas.

```text
Más campos → Más trabajo → Más maquinaria + Más trabajadores + Más infraestructura
```

### 3.4 Gestión de trabajadores

Los trabajadores operan físicamente las máquinas. El jugador administra contratación, salarios, alojamiento, asignaciones, tareas y capacidad de trabajo.

### 3.5 Gestión de infraestructura

La granja ocupa terreno físico: garajes, silos, hogares, talleres y otras estructuras futuras, cada una con footprint físico que consume tierra productiva.

### 3.6 Simulación persistente

El tiempo continúa transcurriendo aunque el jugador cierre el navegador; el servidor calcula el progreso al volver.

---

## 4. Tipo de experiencia

El juego será: Web-based, 2D, Top-down, Idle, Persistente, Server-authoritative, Procedural, Orientado a gestión.

No será inicialmente: un simulador de conducción, un juego de acción, un multiplayer competitivo, un sandbox de física, un simulador hiperrealista.

---

## 5. Mundo

```text
WORLD
│
├── Chunk
│   ├── Cell
│   ├── Cell
│   └── ...
├── Chunk
└── Chunk
```

El mundo puede ser virtualmente infinito, con generación procedural basada en una **seed**. Con la misma seed y coordenadas se debe poder reconstruir el mismo terreno.

---

## 6. Chunks

Propuesta inicial: `32 × 32 celdas` (sujeto a validación técnica). Permiten generación procedural, carga bajo demanda, descarga de zonas lejanas, sincronización parcial, persistencia eficiente y mundos muy grandes.

---

## 7. Celdas

```text
Cell
├── worldX
├── worldY
├── terrainType
├── ownership
└── occupation
```

El backend puede reconstruir un chunk mediante `worldSeed + chunkX + chunkY`, persistiendo solo las modificaciones de los jugadores.

---

## 8. Tipos de terreno

| Terreno | Comprable | Agricultura | Silvicultura | Construcción |
| ------- | --------: | -----------: | ------------: | ------------: |
| Pradera |        Sí |            Sí |            No |            Sí |
| Bosque  |        Sí | No directamente |          Sí | Sí, según estado |
| Montaña |        No |            No |            No |            No |
| Agua    |        No |            No |            No |            No |

---

## 9. Pradera

```text
PRADERA VIRGEN → Comprar → Terreno del jugador → Crear campo → Agricultura
```

---

## 10. Bosques

Recurso económico independiente, no un simple obstáculo.

```text
BOSQUE → Comprar → Gestionar → Trabajos forestales → Madera → Venta
```

Conversión futura a terreno agrícola (desmonte):

```text
BOSQUE → Desmonte → Terreno despejado → Campo
```

Con coste económico y de maquinaria. Decisión estratégica: *¿Mantener el bosque como activo forestal o sacrificarlo para aumentar la superficie agrícola?* (Ver Parte VI — Silvicultura para el sistema completo.)

---

## 11. Montañas

Barreras naturales permanentes: no cultivables, no comprables, no talables, no construibles. Dividen territorios, crean cuellos de botella y modifican la generación procedural.

---

## 12. Agua

Barrera natural: no comprable, no cultivable, no construible encima. Futuro: riego, puentes, pesca, transporte acuático (fuera del MVP).

---

# PARTE II — TIERRA Y CAMPOS

## 13. Tierra virgen

```text
Terrain: GRASS
Ownership: UNOWNED
Agricultural State: VIRGIN
```

Comprar la tierra solo cambia su propiedad; no la convierte automáticamente en campo.

---

## 14. Compra de tierras

```text
UNOWNED → PURCHASE → PLAYER OWNED
```

Precio inicial dependiente de tipo de terreno y valor base; futuro: distancia a granjas, accesibilidad, calidad, proximidad a mercados, recursos. (Fórmula formalizada en §115.)

---

## 15. Uso de tierra

```text
OWNED LAND
│
├── Field
├── Farm
├── Forestry
├── Road
└── Future structures
```

Una celda ocupada por infraestructura no puede usarse simultáneamente para agricultura.

---

## 16. Campos

Un campo es una entidad lógica independiente de los chunks; puede ocupar varios chunks a la vez.

```text
┌───────────────┬───────────────┐
│    █████████████████████      │
│    █████████████████████      │
│    █████████████████████      │
└───────────────┴───────────────┘
       Chunk A        Chunk B
```

---

## 17. Geometría de los campos

Formas arbitrarias, no necesariamente rectángulos. Reglas iniciales: todas las celdas deben pertenecer al jugador, ser compatibles con agricultura, formar un campo contiguo, no contener agua ni montaña, no atravesar infraestructura, y no usar celdas forestales sin haber sido despejadas.

---

## 18. Campos multi-chunk

```text
Field #42
├── Chunk (10,20) → 120 cells
├── Chunk (11,20) → 240 cells
└── Chunk (12,20) → 60 cells
```

La superficie del campo se calcula a partir de las celdas que lo componen.

---

## 19. Creación de campos

```text
Seleccionar área → Validar celdas → Crear Field → Asignar Field ID
```

Las celdas pasan de `OWNED LAND` a `FIELD`.

---

## 20. Ampliación de campos

Requiere tierra adyacente, propiedad del jugador, terreno compatible y ausencia de infraestructura.

---

## 21. División de campos

```text
Field original → Field #1 + Field #2
```

Permite gestionar diferentes cultivos o estrategias de producción por separado.

---

## 22. Fusión de campos

```text
Field #1 + Field #2 → Field #3
```

Valida contigüidad, compatibilidad, propiedad y estado agrícola. No debería destruir progreso agrícola sin razón explícita.

---

# PARTE III — GRANJA E INFRAESTRUCTURA

## 23. Granja

Entidad física dentro del mundo, no un simple menú. Ocupa celdas reales.

```text
┌──────────────────────────┐
│        FARM              │
│ GARAGE       SILO        │
│ HOME         WORKSHOP    │
└──────────────────────────┘
```

---

## 24. Construcción de granjas

Requiere terreno suficiente. Su ubicación determina espacio disponible, proximidad a campos, futuras rutas, expansión y logística.

---

## 25. Slots físicos

Inicialmente: Garage Slot, Silo Slot, Worker Home Slot, Workshop Slot. Cada slot tiene tamaño, coste, capacidad, posición y función.

---

## 26. Garajes

```text
Garage #1
Capacity: 4 machines
Footprint: 6 × 8 cells
```

Más capacidad requiere construir garajes adicionales. (Valores de referencia MVP en §89 y §96.)

---

## 27. Silos

```text
Silo #1
Capacity: 100,000 L
```

El producto cosechado requiere almacenamiento físico; no desaparece automáticamente.

---

## 28. Hogares de trabajadores

```text
Worker Home #1 — Capacity: 4 workers
Worker Home #2 — Capacity: 6 workers
```

```text
Más trabajadores → Más viviendas → Más espacio → Más inversión
```

---

## 29. Talleres

Permiten reparar y mantener maquinaria (§93). Funciones futuras: mejoras, personalización, modificaciones, reparación avanzada.

---

## 30. Expansión de la granja

```text
FASE 1: GARAGE + HOME
FASE 2: GARAGE + GARAGE + HOME + SILO + WORKSHOP
```

Requiere adquirir terreno adicional.

---

## 31. Múltiples granjas

```text
Farm #1 — Agricultura
Farm #2 — Silvicultura
```

Cada granja puede tener sus propios edificios, maquinaria, trabajadores y almacenamiento, permitiendo explotaciones especializadas. (Ver §108 sobre el vínculo trabajador-granja.)

---

# PARTE IV — MAQUINARIA (visión general + sistema detallado)

## 32. Maquinaria

El jugador debe comprar toda su maquinaria; no existen servicios externos.

```text
Tractors, Plows, Cultivators, Seeders, Harvesters, Trailers, Forestry Equipment
```

---

## 33. Propiedades de maquinaria

```text
Machine
├── type
├── purchasePrice
├── maintenanceCost
├── operatingCost
├── workSpeed
├── workWidth
├── capacity
├── requiredPower
├── condition
└── location
```

---

### 33.1 Sistema de maquinaria — detalle

*(Addendum integrado — extiende §32-33 y §43)*

#### 87. Objetivo del sistema

La maquinaria es el "verbo" del sistema agrícola: sin ella, ninguna transición de estado de campo puede ejecutarse. El sistema define qué máquina puede hacer qué operación, cómo se calcula la duración real de una tarea, cómo se desgasta y qué pasa si falla, y cómo se combinan máquinas (tractor + implemento).

#### 88. Máquinas propulsadas vs. implementos

```text
Powered Machine (autopropulsada)
├── Tractor
└── Harvester (autopropulsada, no necesita tractor)

Implement (remolcado / enganchado)
├── Plow
├── Cultivator
├── Seeder
└── Trailer
```

```text
Tractor + Implement = Unidad de trabajo válida
Harvester = Unidad de trabajo válida por sí sola
```

Para el MVP: cada implemento requiere un tractor libre asignado; no se modela potencia/HP como restricción numérica todavía.

#### 89. Catálogo de maquinaria del MVP

```text
Machine: TRACTOR
├── role: powered
├── purchasePrice: $18,000
├── maintenanceCost: $12/game hour idle
├── operatingCost: $22/game hour working
├── condition: 100% → 0%
└── compatibleWith: [plow, cultivator, seeder, trailer]

Machine: PLOW
├── role: implement
├── purchasePrice: $6,500
├── workWidth: 3m
├── workSpeed: 4.2 cells/hour
├── enablesTransition: VIRGIN → PLOWED

Machine: CULTIVATOR
├── role: implement
├── purchasePrice: $5,200
├── workWidth: 4m
├── workSpeed: 5.5 cells/hour
├── enablesTransition: PLOWED → CULTIVATED
├── sideEffect: weedLevel → 0

Machine: SEEDER
├── role: implement
├── purchasePrice: $9,800
├── workWidth: 3m
├── workSpeed: 4.8 cells/hour
├── enablesTransition: CULTIVATED/PLOWED → SEEDED
├── requiresCropSelection: true

Machine: HARVESTER
├── role: powered (autopropulsada)
├── purchasePrice: $42,000
├── maintenanceCost: $25/game hour idle
├── operatingCost: $60/game hour working
├── workWidth: 6m
├── workSpeed: 3.0 cells/hour
├── enablesTransition: READY_TO_HARVEST → HARVESTED
├── requiresTrailerOrSilo: true

Machine: TRAILER
├── role: implement (pasivo)
├── purchasePrice: $7,200
├── capacity: 12,000 L
├── function: transporte de cosecha hasta el silo
```

Nota de balance: `workSpeed` en "celdas/hora" es una simplificación de MVP; se recalculará como hectáreas/hora cuando el tamaño real de la celda se defina técnicamente.

#### 90. Compatibilidad operación ↔ maquinaria

| Transición | Máquina requerida | Implemento adicional |
|---|---|---|
| VIRGIN → PLOWED | Tractor | Plow |
| PLOWED → CULTIVATED | Tractor | Cultivator |
| CULTIVATED/PLOWED → SEEDED | Tractor | Seeder |
| READY_TO_HARVEST → HARVESTED | Harvester | Trailer (transporte) |

El servidor valida esta tabla antes de aceptar cualquier `AssignTask`. Combinaciones inválidas se rechazan sin ejecución parcial.

#### 91. Cálculo de duración de una tarea

```text
taskDuration (horas) = fieldCellCount / effectiveWorkSpeed
effectiveWorkSpeed = machine.workSpeed × conditionFactor × skillFactor
```

```text
conditionFactor: 100%→1.0 · 50%→0.75 · 10%→0.4
skillFactor:      100%→1.0 · 50%→0.8
```

Se calcula una sola vez al iniciar la tarea, generando un evento con `completionTime = startTime + taskDuration` (simulación basada en eventos, §53/§154).

#### 92. Campos multi-chunk y maquinaria

La tarea se ata al `Field` completo, no a un chunk. El movimiento visual de la máquina entre chunks es cosmético a nivel de frontend, sin efecto en la simulación.

#### 93. Condición y desgaste (Condition)

```text
Condition: 100% (nueva) ────────── 0% (inservible)
```

Cada hora de trabajo reduce `condition` según `wearRatePerHour` (propio de cada tipo). Bajo un umbral (ej. 20%) debería mostrar advertencias. La reparación en el Workshop restaura condición:

```text
repairCost = (100 - condition) × repairCostPerPoint
```

Fuera del MVP: degradación por inactividad, desgaste según terreno, mantenimiento preventivo vs. correctivo.

#### 94. Mantenimiento vs. operación (costes)

```text
maintenanceCost → se paga SIEMPRE, trabaje o no la máquina (posesión)
operatingCost   → se paga SOLO mientras la máquina ejecuta una tarea
```

Comprar una máquina no es gratis aunque esté parada — refuerza el pilar de restricciones estratégicas (§64).

#### 95. Fallos de maquinaria (propuesta, evaluar para MVP)

```text
Condition < 20% → breakdownChance por hora trabajada
Si ocurre: Task se pausa, Machine → BROKEN, requiere reparación en Workshop
```

Recomendación: **fuera del MVP estricto** (frustrante en modo idle si el jugador no puede reaccionar), pero el estado `BROKEN` debe existir en el enum desde el principio:

```text
MachineStatus: IDLE / WORKING / BROKEN (reservado) / IN_REPAIR (reservado)
```

#### 96. Capacidad de garaje y maquinaria

```text
Garage.capacity = número máximo de máquinas almacenadas
```

Para el MVP: bloqueo simple — no se puede comprar maquinaria sin slot de garaje libre.

#### 97. Interacción Harvester + Trailer + Silo

```text
HARVEST inicia → Harvester trabaja el Field → producción se acumula en Trailer.currentLoad
Si Trailer se llena → debe descargar en Silo antes de continuar
Al completar el Field → HARVESTED, Trailer descarga remanente en Silo
```

Para el MVP: simplificado — la producción va directa al silo sin modelar el llenado incremental del Trailer (el Trailer existe como requisito de posesión, no como restricción de capacidad activa).

#### 98. Modelo de datos resumido (Machine)

```text
Machine
├── id
├── ownerId
├── type
├── purchasePrice
├── maintenanceCost
├── operatingCost
├── workWidth
├── workSpeed
├── condition (0-100)
├── status (IDLE / WORKING / BROKEN / IN_REPAIR)
├── location (garageId o farmId)
├── assignedWorkerId (nullable)
├── currentTaskId (nullable)
└── purchasedAt
```

#### 99. Qué entra en el MVP de este sistema

```text
✔ Catálogo: Tractor, Plow, Cultivator, Seeder, Harvester, Trailer
✔ Tabla de compatibilidad operación ↔ máquina
✔ Cálculo de duración vía workSpeed + condition + skill
✔ Desgaste (condition) por hora trabajada
✔ maintenanceCost vs operatingCost como costes separados
✔ Reparación en Workshop
✔ Límite de garaje bloqueando compras

✘ Fallos aleatorios (BROKEN) — estado reservado, no activo
✘ Llenado incremental del Trailer — simplificado a transporte directo
✘ requiredPower / HP como restricción numérica
✘ Degradación por inactividad
```

---

# PARTE V — TRABAJADORES (visión general + sistema detallado)

## 34. Trabajadores

```text
Worker #15
Salary: $X / game hour
Skill: 85%
Status: IDLE
```

---

## 35. Gestión de trabajadores

Contratar, despedir, asignar tareas, reasignar, gestionar salarios. Estados iniciales: `IDLE`, `WORKING`. Futuros: `TRAVELING`, `RESTING`, `UNAVAILABLE`, `INJURED`.

---

## 36. Salarios

```text
Worker: $30 / game hour
```

Se aplica también durante la simulación offline, obligando a gestionar la plantilla con cuidado.

---

## 37. Capacidad laboral

```text
5 machines + 2 workers → solo 2 máquinas pueden trabajar simultáneamente
Productividad = maquinaria disponible + trabajadores disponibles + infraestructura
```

---

## 38. Asignación de maquinaria

```text
Worker + Machine + Task + Target
```

```text
Worker #5 → Tractor #3 → Plow #2 → Field #12
```

El servidor valida la compatibilidad. (Detalle completo en §104.)

---

### 38.1 Sistema de trabajadores — detalle

*(Addendum integrado — extiende §34-38)*

#### 100. Objetivo del sistema

El trabajador conecta una máquina con una tarea; sin trabajador, una máquina no puede operar sin importar cuán buena sea (`Productividad = maquinaria + trabajadores + infraestructura`, §37).

#### 101. Modelo de datos resumido (Worker)

```text
Worker
├── id
├── ownerId
├── name
├── skill (0-100%)
├── salaryPerHour
├── status (IDLE / WORKING / TRAVELING* / UNAVAILABLE*)
├── assignedMachineId (nullable)
├── currentTaskId (nullable)
├── homeId (Worker Home donde reside)
├── hiredAt
└── farmId

* reservados, inactivos en MVP
```

#### 102. Mercado de contratación

```text
Labor Pool (regional o global, a definir)
├── Worker candidate #A1 — Skill 62% — Asking $18/h
├── Worker candidate #A2 — Skill 45% — Asking $12/h
├── Worker candidate #A3 — Skill 88% — Asking $31/h
```

Reglas del MVP: pool generado proceduralmente (skill 30-90%, salario correlacionado con skill + ruido); al contratar, el candidato se retira y aparece uno nuevo tras `poolRefreshInterval`; sin negociación de salario.

```text
HIRE(candidateId) → validar dinero + espacio en Worker Home → Worker creado (IDLE) → candidato removido del pool
```

Fuera del MVP: negociación, rechazo de ofertas bajas, reputación afectando el pool, renuncias.

#### 103. Skill y su efecto (skillFactor)

```text
skillFactor = 0.5 + (worker.skill / 100) × 0.5
```

```text
Skill 0%   → factor 0.5 (nunca inútil)
Skill 50%  → factor 0.75
Skill 100% → factor 1.0
```

Decisión de diseño: el skill nunca reduce el factor a cero, dejando espacio a la estrategia "muchos trabajadores baratos" vs. "pocos expertos" (§65).

Progresión de skill (recomendada para MVP, bajo coste de implementación): cada tarea completada otorga `+X% skill` con techo (ej. 95%), incentivando retención de plantilla.

#### 104. Asignación Worker + Machine + Task

```text
CLIENT: AssignTask(workerId, machineId, operation, targetFieldId)

SERVER valida:
1. Worker existe, pertenece al jugador, status == IDLE
2. Machine existe, pertenece al jugador, status == IDLE
3. Machine.type compatible con `operation` (tabla §90)
4. Implemento adicional libre y asignado (si aplica)
5. Field existe, pertenece al jugador, cropCycleState permite la transición
6. (Si SEED) cropId válido especificado

SERVER ejecuta:
- worker.status = WORKING / machine.status = WORKING
- Task creada, completionTime = now + taskDuration
- Evento agendado: CompleteTask(taskId) @ completionTime
```

Un trabajador solo puede estar vinculado a una máquina y una tarea a la vez (sin multitasking en el MVP).

#### 105. Qué pasa al completar una tarea

```text
CompleteTask(taskId)
   ↓
Field.cropCycleState → siguiente estado
Worker.status → IDLE
Machine.status → IDLE
Task archivada
   ↓
(si skill progression activa) Worker.skill += incremento
```

El trabajador no se reasigna automáticamente — queda `IDLE`, alimentando el resumen de regreso (§68/§161).

#### 106. Interrupción de tareas

```text
CancelTask(taskId)
   ↓
Validar que la tarea es cancelable
   ↓
Field permanece en el estado ANTERIOR (progreso parcial se pierde)
Worker → IDLE / Machine → IDLE
```

Decisión de diseño: modelo "todo o nada" — sin progreso parcial persistente, para mantener el MVP pequeño. Revisable tras playtesting.

#### 107. Salarios y coste continuo

```text
Worker.salaryPerHour se cobra SIEMPRE, esté IDLE o WORKING
```

```text
Coste horario total =
Σ worker.salaryPerHour
+ Σ machine.maintenanceCost
+ Σ machine.operatingCost (solo máquinas WORKING)
```

Se calcula analíticamente entre eventos, no mediante tick continuo.

#### 108. Alojamiento (Worker Home) como restricción dura

```text
Σ workers.length ≤ Σ (worker homes).capacity
```

Un trabajador pertenece a una granja específica vía `homeId`. Relevante para múltiples granjas (§31): un trabajador de Farm #1 no puede operar maquinaria de Farm #2 sin reasignarse (mudanza — fuera del MVP, pero soportado por el modelo vía `farmId`).

#### 109. Despido

```text
FireWorker(workerId)
   ↓
Validar: worker.status == IDLE
   ↓
Worker eliminado, Home slot liberado
```

No se puede despedir a mitad de tarea. Fuera del MVP: indemnización, impacto en reputación del pool.

#### 110. Ejemplo narrativo completo

```text
Estado inicial: Worker #7 (Skill 70%) IDLE — Tractor #2 IDLE — Plow #1 IDLE — Field #12 VIRGIN

AssignTask(worker=7, machine=tractor2+plow1, op=PLOW, field=12)
taskDuration = 300 / (4.2 × 0.95 × 0.85) ≈ 84h
Worker #7 → WORKING / Tractor #2 → WORKING
Evento agendado: CompleteTask @ +84h

--- Desconexión, 84h después el servidor procesa el evento ---

Field #12 → PLOWED
Worker #7 → IDLE (skill 70% → 71%)
Tractor #2 → IDLE

WELCOME BACK: "Field #12 finished plowing. Worker #7 is idle."
```

#### 111. Modelo de datos resumido (Task, generalizado)

```text
Task
├── id
├── workerId
├── machineIds[]
├── operation (PLOW / CULTIVATE / SEED / HARVEST / FELL / REPLANT)
├── targetFieldId (o targetForestPlotId)
├── cropId (solo si operation == SEED)
├── startTime
├── completionTime
├── cancelable (bool)
└── status (IN_PROGRESS / COMPLETED / CANCELED)
```

#### 112. Qué entra en el MVP de este sistema

```text
✔ Pool de contratación procedural con refresh
✔ Contratar / despedir (solo si IDLE)
✔ skillFactor con piso de 0.5
✔ Progresión simple de skill al completar tareas
✔ Asignación Worker+Machine+Task con validación server-side
✔ Salario continuo como coste de oportunidad
✔ Cancelación de tarea (todo-o-nada)
✔ Alojamiento como restricción dura
✔ Vínculo worker ↔ farm vía homeId

✘ Negociación de salario
✘ Renuncias / reputación del pool
✘ Multitasking de trabajadores
✘ Progreso parcial persistente al cancelar
✘ Mudanza de trabajador entre granjas
✘ Estados TRAVELING / UNAVAILABLE / INJURED
```

---

# PARTE VI — SISTEMA AGRÍCOLA (visión general + sistema detallado)

## 39. Core loop agrícola

```text
Comprar tierra → Crear campo → Comprar maquinaria → Contratar trabajador
→ Asignar máquina → Ejecutar labor → Siguiente estado → Crecimiento
→ Cosecha → Almacenamiento → Venta → Reinvertir
```

---

## 40. Sistema agrícola

```text
Field
├── Geometry
├── Crop
├── Soil
├── Fertility
├── WeedState
├── Fertilization
├── Growth
├── HarvestState
└── CurrentTask
```

---

## 41. Estados agrícolas

Referencia conceptual: Farming Simulator 25.

```text
VIRGIN → PLOWED → CULTIVATED → SEEDED → GERMINATING → GROWING → READY_TO_HARVEST → HARVESTED
```

Más estados/condiciones independientes: fertilización, malezas, fertilidad, condiciones del suelo, daño, rendimiento. (Matriz completa desarrollada en §75-86.)

---

## 42. Cultivos

Primer cultivo: `WHEAT`. Posteriormente: Barley, Canola, Corn, Soybean, Sunflower, Potato, Sugar Beet...

Cada cultivo tendrá tiempo de crecimiento, rendimiento, precio, maquinaria requerida, condiciones de cultivo, almacenamiento y temporada. (Formalizado en §82.)

---

## 43. Agricultura basada en maquinaria

```text
PLOW → requiere arado
CULTIVATE → requiere cultivador
SEED → requiere sembradora
HARVEST → requiere cosechadora
```

No se puede ejecutar una operación sin combinación válida de `Machine + Worker + Target`.

---

## 44. No existe contratación de servicios

> El jugador no puede pagar a una empresa externa para realizar una operación agrícola o forestal. Toda actividad se ejecuta mediante maquinaria propia + trabajador propio.

---

### 44.1 Sistema agrícola — detalle

*(Addendum integrado — extiende §40-42)*

#### 75. Objetivo del sistema

Un campo no es un booleano ("sembrado/no sembrado") sino un conjunto de atributos independientes que evolucionan con el tiempo y las acciones del jugador:

```text
Field
├── CropCycleState (máquina de estados principal)
├── Fertility (0-100%)
├── SoilCondition (PLOWED / CULTIVATED / UNTOUCHED / COMPACTED)
├── WeedLevel (0-100%)
├── Fertilization (0-100%, con decaimiento)
├── Moisture (futuro, fuera de MVP)
├── GrowthProgress (0-100% dentro de GROWING)
├── Damage (0-100%, futuro)
└── ExpectedYield (calculado, no almacenado)
```

El estado principal indica en qué fase del ciclo está el campo; los atributos secundarios indican qué tan bien va esa fase, y juntos determinan el rendimiento final.

#### 76. Máquina de estados principal (CropCycleState)

```text
VIRGIN → [PLOW] → PLOWED → [CULTIVATE] → CULTIVATED → [SEED] → SEEDED
   → (tiempo) → GERMINATING → (tiempo) → GROWING
   → (GrowthProgress=100%) → READY_TO_HARVEST → [HARVEST] → HARVESTED
   → (vuelve a VIRGIN o PLOWED, según config)
```

| Transición | Disparador | Requiere maquinaria | Automático |
|---|---|---|---|
| VIRGIN → PLOWED | Acción jugador | Arado | No |
| PLOWED → CULTIVATED | Acción jugador | Cultivador | No |
| CULTIVATED → SEEDED | Acción jugador | Sembradora | No |
| SEEDED → GERMINATING | Tiempo | — | Sí |
| GERMINATING → GROWING | Tiempo | — | Sí |
| GROWING → READY_TO_HARVEST | GrowthProgress ≥ 100% | — | Sí |
| READY_TO_HARVEST → HARVESTED | Acción jugador | Cosechadora | No |
| HARVESTED → VIRGIN/PLOWED | Config del cultivo | — | Sí |

Nota: `CULTIVATED` es opcional para el MVP (se puede sembrar directo tras `PLOWED`), controlado por el flag `requiresCropSelection`/`requiresCultivation` del cultivo.

#### 77. Estado paralelo: Fertilidad (Fertility)

```text
Fertility: 0% (suelo agotado) ────── 100% (suelo óptimo)
```

Cada cosecha reduce la fertilidad (ej. `-15%` por ciclo). Se restaura mediante barbecho, fertilización, o rotación de cultivos (futuro). Afecta el rendimiento esperado:

```text
Fertility 100% → Yield multiplier 1.0
Fertility 50%  → Yield multiplier 0.65
Fertility 10%  → Yield multiplier 0.25
```

Curva exacta: función configurable `fertilityToYieldCurve(fertility)`, tema de balance.

#### 78. Estado paralelo: Malezas (WeedLevel)

```text
WeedLevel: 0% (limpio) ────────── 100% (invadido)
```

Aumenta automáticamente mientras el campo está en `GROWING`, `READY_TO_HARVEST` sin cosechar, o `VIRGIN` sin trabajar. `CULTIVATE` lo reduce a 0.

```text
WeedLevel 0%   → sin penalización
WeedLevel 50%  → -20% yield
WeedLevel 100% → -50% yield
```

Fuera del MVP: herbicidas como alternativa a la cultivación.

#### 79. Estado paralelo: Fertilización (Fertilization)

```text
Fertilization: 0% ────────────── 100%
```

Aplicado mediante `FERTILIZE` (requiere abonadora, fuera del MVP inicial). Decae con el tiempo. Aumenta el yield multiplier independientemente de Fertility:

```text
Yield final ≈ base × fertilityMultiplier × fertilizationMultiplier × (1 - weedPenalty) × conditionMultiplier
```

Para el MVP: multiplicador fijo en 1.0, pero el campo de datos existe desde el inicio para evitar migración de esquema.

#### 80. GrowthProgress (dentro de GROWING)

```text
GrowthProgress = min(100, elapsedGameHours / cropGrowthDuration × 100)
```

Se agenda mediante evento `CompleteGrowth` con `timestamp = startTime + cropGrowthDuration` (simulación basada en eventos, no tick continuo). Al llegar a 100% → transición automática a `READY_TO_HARVEST`.

#### 81. Condición del suelo (SoilCondition)

```text
UNTOUCHED → PLOWED → CULTIVATED → COMPACTED (futuro)
```

Afecta la validez de ciertas operaciones. `COMPACTED` queda reservado en el modelo para uso futuro (uso repetido de maquinaria pesada), fuera del MVP.

#### 82. Datos del cultivo (Crop definition)

Entidad de configuración, no de instancia; `Field` referencia `cropId`.

```text
Crop: WHEAT
├── growthDuration: 96 game hours
├── baseYieldPerCell: 90 L  (revisado, ver §119)
├── requiresCultivation: false
├── sellPricePerLiter: $0.22 (revisado, ver §119)
├── requiredMachinery: [plow, seeder, harvester]
├── weedGrowthRate: 0.6 %/hour
├── fertilityDrainPerCycle: 15%
└── season: [SPRING, SUMMER] (futuro, fuera de MVP estricto)
```

#### 83. Fórmula de rendimiento final

```text
cellCount = número de celdas del Field
baseYield = crop.baseYieldPerCell × cellCount

fertilityMult     = fertilityToYieldCurve(field.fertility)
fertilizationMult = fertilizationToYieldCurve(field.fertilization)
weedPenalty       = weedToYieldPenalty(field.weedLevel)

finalYield = baseYield × fertilityMult × fertilizationMult × (1 - weedPenalty)
```

El resultado se añade al inventario del silo (sujeto a capacidad disponible).

#### 84. Ciclo completo — ejemplo narrativo

```text
Día 1 — Field #12: VIRGIN, Fertility 100%, WeedLevel 0%
Jugador ejecuta PLOW → Field #12: PLOWED
Jugador ejecuta SEED (Wheat) → Field #12: SEEDED, GrowthProgress 0%

--- 6h después (offline) --- Field #12: GERMINATING
--- 96h después --- Field #12: GROWING → GrowthProgress 100% → READY_TO_HARVEST
WeedLevel subió a 34% (no se cultivó)

Jugador ejecuta HARVEST
Yield = base × fertility(1.0) × (1 - weedPenalty(~14%))
Field #12: HARVESTED → VIRGIN, Fertility baja a 85%
```

Este ejemplo debería incorporarse al "resumen de regreso" (§161), ya que ilustra por qué el WeedLevel importa incluso en modo idle.

#### 85. Modelo de datos resumido (Field extendido)

```text
Field
├── id
├── ownerId
├── cellIds[]
├── cropId (nullable si VIRGIN sin cultivo asignado)
├── cropCycleState
├── fertility
├── soilCondition
├── weedLevel
├── fertilization
├── growthStartedAt
├── growthProgress (derivado o cacheado)
├── currentTaskId (nullable)
└── lastUpdatedAt
```

`growthProgress` se calcula on-demand a partir de `growthStartedAt` y `crop.growthDuration` — sin tick continuo.

#### 86. Qué entra en el MVP de este sistema

```text
✔ CropCycleState completo (8 estados)
✔ Fertility con decaimiento por cosecha
✔ WeedLevel con crecimiento por tiempo
✔ GrowthProgress basado en eventos
✔ Fórmula de yield con fertility + weeds
✔ Un solo cultivo (Wheat)

✘ Fertilization activa (queda modelada, no jugable)
✘ SoilCondition → COMPACTED
✘ Season / clima
✘ Riego / Moisture
```

---

# PARTE VII — SILVICULTURA

## 45. Silvicultura (visión general)

Segundo sistema productivo.

```text
Bosque → Comprar → Trabajador + maquinaria forestal → Tala → Madera → Almacenamiento / venta
```

---

### 45.1 Sistema de silvicultura — detalle

*(Addendum integrado — extiende §10, §32, §45)*

#### 128. Objetivo del sistema

Sistema productivo paralelo a la agricultura, no una variación de ella. Reutiliza la arquitectura Máquina + Trabajador + Servidor autoritativo + Eventos, con reglas propias: no tiene un ciclo único de siembra-cosecha sino árboles individuales con estados propios; el bosque puede empezar ya poblado; la unidad de trabajo puede ser parcelable árbol a árbol.

#### 129. Diferencia estructural: Field vs. Forest Plot

```text
Field (agricultura)
├── Un único estado de ciclo para toda el área
└── Se trabaja como unidad completa

ForestPlot (silvicultura)
├── Colección de Tree entities individuales
└── Se puede trabajar árbol a árbol o por lote
```

```text
ForestPlot
├── id
├── ownerId
├── cellIds[] (multi-chunk permitido, igual que Field)
└── trees[]
```

#### 130. La entidad Tree

Cada celda forestal puede contener cero o un árbol (sin múltiples árboles por celda en el MVP).

```text
Tree
├── id
├── forestPlotId
├── cellId
├── species
├── growthStage (SAPLING → YOUNG → MATURE → OLD_GROWTH)
├── age (game hours)
├── woodVolume (m³, calculado según growthStage)
├── status (STANDING / MARKED_FOR_HARVEST / FELLED)
└── plantedAt / generatedAt
```

Origen: al comprar bosque por primera vez, se genera proceduralmente ya poblado con árboles en distintas fases (mezcla coherente con un bosque salvaje). Tras tala + replantación, los nuevos árboles nacen como `SAPLING`.

#### 131. Ciclo de vida del árbol (growthStage)

```text
SAPLING → YOUNG → MATURE → OLD_GROWTH
```

| Estado | woodVolume aprox. | Talable | Nota |
|---|---|---|---|
| SAPLING | ~0.05 m³ | No | sin valor comercial |
| YOUNG | ~0.4 m³ | Sí (bajo rendimiento) | talable pero desaconsejado |
| MATURE | ~1.8 m³ | Sí (óptimo) | punto ideal de tala |
| OLD_GROWTH | ~2.5 m³ | Sí | máximo volumen, deja de crecer |

A diferencia del trigo, un árbol maduro no se pierde si no se tala a tiempo: sigue acumulando volumen hasta `OLD_GROWTH`, donde se estanca. Refuerza la silvicultura como inversión de largo plazo y bajo mantenimiento, en contraste con la agricultura de ciclos cortos e intensivos.

#### 132. Tala (Harvest de árbol)

```text
MARK_FOR_HARVEST(treeId) → status: MARKED_FOR_HARVEST
FELL(treeId) [requiere maquinaria forestal + trabajador]
   → status: FELLED
   → wood generado = tree.woodVolume
   → tree eliminado del ForestPlot
```

```text
Opción A — Tala individual (target = un solo Tree)
Opción B — Tala por lote / clear-cut (target = todos los Tree de un área)
```

Para el MVP: solo **Opción B simplificada** (seleccionar ForestPlot completo o subárea desde la UI, reutilizando el patrón de §19). El modelo de datos individual por árbol se mantiene igual; solo se simplifica la interacción.

#### 133. Especie de árbol (MVP)

```text
Species: PINE
├── growthDurationPerStage: 240 game hours (×4 stages ≈ 960h total hasta OLD_GROWTH)
├── maxWoodVolume: 2.5 m³ (en OLD_GROWTH)
├── sellPricePerM3: $45
└── requiredMachinery: [chainsaw_harvester, forwarder]
```

El ciclo de vida completo (~960h) es ~3x más largo que un ciclo agrícola (~325h, §118) — intencional para que la silvicultura se sienta como inversión a largo plazo.

#### 134. Maquinaria forestal

```text
Machine: HARVESTER_FORESTRY (chainsaw harvester)
├── role: powered
├── purchasePrice: $65,000
├── maintenanceCost: $30/game hour idle
├── operatingCost: $70/game hour working
├── workSpeed: 0.8 trees/hour (por lote)
├── enablesOperation: FELL
└── condition: 100% → 0%

Machine: FORWARDER
├── role: powered
├── purchasePrice: $38,000
├── capacity: 15 m³ de madera
└── function: transporte de madera talada hasta el almacén
```

Deliberadamente no se reutiliza Tractor+Plow para silvicultura: catálogo de maquinaria separado, aunque comparte la estructura de datos `Machine`. Expandirse a silvicultura es una inversión de capital nueva.

#### 135. Cálculo de duración de tala (por lote)

```text
taskDuration (horas) = treeCount / effectiveWorkSpeed
effectiveWorkSpeed = machine.workSpeed × conditionFactor × skillFactor
woodProduced = Σ tree.woodVolume (árboles talados en el lote)
```

`treeCount` = árboles con `status != FELLED` dentro del área seleccionada.

#### 136. Almacenamiento de madera

```text
WoodStorage (equivalente forestal del Silo)
├── purchasePrice: $12,000
├── capacity: 500 m³
└── currentStock: X m³
```

Se modela como edificio distinto (no un flag de tipo sobre `Silo`) porque son inversiones de infraestructura conceptualmente separadas — coherente con el pilar 3.5.

#### 137. Replantación

```text
REPLANT(cellId) [requiere maquinaria forestal + trabajador, operación separada de FELL]
   → Nuevo Tree creado, growthStage = SAPLING, age = 0
```

No es automática. Si el jugador no replanta, la celda queda vacía permanentemente dentro del `ForestPlot`, igual que un `Field` en `VIRGIN`. El jugador puede optar por convertir esas celdas a terreno agrícola en su lugar (desmonte, §10), cerrando el ciclo de decisión bosque-vs-campo en una dirección (bosque → campo).

```text
Fuera del MVP: conversión Field → Forest (reforestación de tierra agrícola)
```

#### 138. Economía forestal — orden de magnitud

```text
Setup forestal mínimo (adicional al agrícola, §117):
├── ForestPlot: 250 celdas × $70 = $17,500
├── Harvester forestry: $65,000
├── Forwarder: $38,000
├── WoodStorage: $12,000
                              Total: $132,500
```

Comparable al setup agrícola completo (~$146,100, §117) — silvicultura no es "el sistema barato secundario", sino una inversión alternativa igualmente seria (§65).

```text
Primera tala (bosque ya maduro, mezcla MATURE/OLD_GROWTH):
woodProduced ≈ 250 árboles × ~1.8m³ promedio × 0.85 ≈ 382 m³
Revenue = 382 × $45 ≈ $17,190
```

A diferencia del primer ciclo agrícola (deficitario, §119), la primera tala de un bosque ya maduro es rentable de inmediato, porque el jugador no paga por el "crecimiento" — lo compra ya crecido. Silvicultura tiene mejor liquidez inicial pero peor liquidez a largo plazo (el ciclo tras replantar tarda ~960h en madurar). Tensión de diseño deliberada, a validar en playtesting.

#### 139. Interacción con trabajadores

Sin cambios estructurales respecto al sistema de trabajadores (§100-112): un `Worker` asignado a maquinaria forestal sigue el mismo modelo de `AssignTask`, `skillFactor`, salario continuo. No se introduce skill diferenciada "forestal" vs. "agrícola" en el MVP; el modelo podría extenderse a `skills: { farming: X, forestry: Y }` en una fase posterior si se implementa como mapa desde el inicio.

#### 140. Modelo de datos resumido (ForestPlot + Tree)

```text
ForestPlot
├── id
├── ownerId
├── cellIds[]
└── currentTaskId (nullable)

Tree
├── id
├── forestPlotId
├── cellId
├── species
├── growthStage
├── age
├── woodVolume (derivado)
└── status (STANDING / MARKED_FOR_HARVEST / FELLED)
```

#### 141. Qué entra en el MVP de este sistema

```text
✔ ForestPlot como entidad separada de Field, multi-chunk
✔ Tree individual con growthStage de 4 fases
✔ Generación procedural de bosque ya poblado al comprar
✔ Tala por lote (no árbol por árbol vía UI)
✔ Una sola especie (Pine)
✔ Maquinaria forestal separada
✔ WoodStorage como edificio separado del Silo
✔ Replantación manual (no automática)
✔ Reutilización del modelo Worker/skillFactor sin skill separada

✘ Tala árbol por árbol desde la UI
✘ Múltiples especies
✘ Conversión Forest → Field más allá del desmonte ya descrito
✘ Reforestación de campos agrícolas
✘ Skill forestal diferenciada de skill agrícola
```

#### 142. Nota sobre roadmap

La silvicultura, aunque comparte arquitectura con agricultura, tiene suficiente superficie propia (entidad `Tree`, ciclo de vida en 4 fases, maquinaria dedicada, almacenamiento separado) como para justificar su posición en **Fase 8** del roadmap (§166), después de que el triángulo agrícola Campo-Máquina-Trabajador esté probado y balanceado.

---

# PARTE VIII — ECONOMÍA (visión general + sistema detallado)

## 46. Economía

```text
Money, Land Cost, Machine Cost, Building Cost, Worker Salary,
Maintenance, Operating Cost, Crop Revenue, Wood Revenue
```

---

## 47. Capital inicial

Debe ser suficiente para comenzar pero insuficiente para comprarlo todo. El jugador decide entre más tierra, más maquinaria, más trabajadores, infraestructura, y capital disponible. (Valor propuesto y justificación en §117.)

---

## 48. Economía de producción

```text
Inversión → Producción → Venta → Beneficio → Reinversión
```

```text
Profit = Revenue - Machine Operating Cost - Maintenance - Worker Salaries - Other Costs
```

---

## 49. Almacenamiento

```text
Wheat: 24,500 L / Silo: 100,000 L → Used: 24.5%
```

Futuro: diferentes tipos de silos, almacenamiento especializado, precios variables, transporte.

---

## 50. Mercado

```text
Wheat → Sell → Money
```

Futuro: fluctuación de precios, demanda, contratos, mercados regionales, productos forestales, cadenas productivas. (Modelo de precio fijo del MVP formalizado en §123.)

---

### 50.1 Economía y balance — detalle

*(Addendum integrado — extiende §46-50 y §64-68)*

> **Nota:** los valores numéricos de esta sección son **ilustrativos**, no definitivos. Su función es verificar que el modelo produce resultados con sentido económico, no fijar el balance final — requiere playtesting.

#### 113. Objetivo del sistema

Verificar que las mecánicas de los sistemas de agricultura, maquinaria y trabajadores funcionan juntas como una economía jugable: si el capital inicial permite arrancar, si el ciclo agrícola es rentable, y qué variables controla el diseñador para ajustar la dificultad.

#### 114. Los tres niveles de coste

```text
COSTE DE ADQUISICIÓN (una vez): Tierra, Maquinaria, Edificios
COSTE DE POSESIÓN (continuo): maintenanceCost, salaryPerHour
COSTE DE OPERACIÓN (solo durante tareas activas): operatingCost
```

El jugador razona en dos escalas: inversión (decisión puntual) y cashflow (supervivencia hora a hora).

#### 115. Precio de la tierra

```text
cellPrice = basePriceByTerrain[terrainType] × locationMultiplier × accessibilityMultiplier

basePriceByTerrain:
├── GRASS:  $120 / celda
└── FOREST: $70 / celda
```

Para el MVP: multiplicadores fijos en 1.0.

#### 116. Coste de infraestructura

```text
Building        Purchase    Footprint    Capacity
Garage          $8,000      6×8 = 48     4 machines
Silo            $10,000     4×4 = 16     100,000 L
Worker Home     $5,000      4×4 = 16     4 workers
Workshop        $9,000      5×5 = 25     (repair access)
```

```text
realBuildingCost = building.purchasePrice + (building.footprint × cellPrice)
```

#### 117. Setup mínimo viable — ejemplo de arranque

```text
Tierra necesaria
├── Footprint de granja (Garage+Silo+Home): 80 celdas
└── Campo inicial: 250 celdas
                          Total: 330 celdas × $120 = $39,600

Edificios: Garage $8,000 + Silo $10,000 + Worker Home $5,000 = $23,000
(Workshop se pospone)

Maquinaria mínima:
Tractor $18,000 + Plow $6,500 + Seeder $9,800 + Harvester $42,000 + Trailer $7,200
                          Subtotal: $83,500
(Cultivator omitido — requiresCultivation=false para Wheat)

Trabajador: 1 Worker (skill ~60%, solo salario continuo)

TOTAL DE ARRANQUE: $39,600 + $23,000 + $83,500 = $146,100
```

**Capital inicial propuesto: $160,000**

```text
$160,000 - $146,100 = $13,900 de colchón
```

El jugador no puede permitirse Workshop, segundo trabajador, ni Cultivator en el arranque — cumple la regla de "suficiente para empezar, insuficiente para comprarlo todo" (§47).

#### 118. Coste de sostener el primer ciclo

```text
PLOW:     250 / (4.2 × 0.85) ≈ 70h
SEED:     250 / (4.8 × 0.85) ≈ 61h
GROWING:  96h (fijo)
HARVEST:  250 / (3.0 × 0.85) ≈ 98h
                    Duración total ≈ 325 horas de juego
```

```text
Worker salary:        $15/h × 325h            = $4,875
Machine maintenance:  ~$70/h combinado × 325h  = $22,750
                                        Total ≈ $27,625
```

Supera el colchón de $13,900 — señal de balance intencional: el jugador no puede mantener las 5 máquinas ociosas simultáneamente durante todo el ciclo sin ingresos. Opciones ya habilitadas por el propio sistema: compra progresiva de maquinaria (ej. Harvester solo cerca de `READY_TO_HARVEST`), campo inicial más pequeño, o tiempo acelerado (§151).

#### 119. Ingreso de la primera cosecha

```text
Crop: WHEAT (revisado)
├── baseYieldPerCell: 90 L
└── sellPricePerLiter: $0.22
```

```text
finalYield = 250 × 90 × fertilityMult(1.0) × (1 - weedPenalty)
weedLevel ~20% acumulado en 325h sin cultivar → penalización ~8%

finalYield ≈ 250 × 90 × 0.92 ≈ 20,700 L
Revenue = 20,700 × $0.22 ≈ $4,554
```

Insuficiente frente al coste de posesión (~$27,625, §118): el primer ciclo aislado, con estos valores ilustrativos, **no es rentable**. Este resultado debe detectarse en diseño, no en producción.

#### 120. Implicación de diseño

```text
Palanca A — Reducir costes de posesión (maintenance más bajo, compra escalonada)
Palanca B — Aumentar ingreso por ciclo (precio, yield, o campo más grande)
Palanca C — Acortar el ciclo económico (growthDuration menor, o multiplicador de tiempo más agresivo)
```

Recomendación: combinar A + C. El jugador no debería comprar la Harvester el día 1 (no la necesita hasta ~230h después) — el flujo de compra escalonada ya resuelve buena parte del problema. El onboarding/tutorial debe guiar explícitamente esta secuencia.

#### 121. Punto de equilibrio (break-even)

```text
breakEvenCycles = totalUpfrontInvestment / (revenuePerCycle - holdingCostPerCycle)
```

Si el denominador es negativo, no existe break-even — la granja quiebra. KPI principal de balance a monitorizar durante desarrollo.

#### 122. Escalado — por qué los campos grandes ganan

```text
Campo de 250 celdas, maquinaria ya amortizada:
  Solo operatingCost + maintenanceCost fijo → coste "por celda" BAJA con el tamaño

Campo de 500 celdas, misma maquinaria:
  El mismo Harvester procesa el doble sin coste adicional de compra
  → mejor ratio ingreso/coste
```

Formaliza matemáticamente el trade-off de §66: crecer no es solo "más contenido", es la única forma de amortizar la inversión fija en maquinaria.

#### 123. Mercado — modelo de precio

```text
sellPrice = crop.sellPricePerLiter × quantitySold
```

Precio fijo, sin fluctuación, para evitar volatilidad sin herramientas de reacción en el MVP. El jugador puede posponer la venta (almacenamiento, §49) pero el precio no cambia por ello hasta fases posteriores.

```text
Fuera del MVP: fluctuación oferta/demanda, mercados regionales, contratos a futuro
```

#### 124. Resumen de regreso — versión económica

```text
elapsedHours = now - lastLogin

totalSalaries    = Σ worker.salaryPerHour × elapsedHours
totalMaintenance = Σ machine.maintenanceCost × elapsedHours
totalOperating   = Σ machine.operatingCost × (horas WORKING dentro del intervalo)
totalRevenue     = Σ (harvests completados → finalYield × sellPrice)

netChange = totalRevenue - totalSalaries - totalMaintenance - totalOperating
```

`totalOperating` requiere revisar los eventos agendados (qué tareas se completaron y cuándo), no una simple multiplicación.

#### 125. KPIs de balance para diseño/QA

```text
1. Coste total de setup mínimo viable
2. Coste de posesión por ciclo completo
3. Ingreso por ciclo completo
4. Ratio ingreso/coste del primer ciclo (objetivo: >1, idealmente 1.3-1.8)
5. Horas de juego hasta el primer breakeven
6. Colchón de capital tras el setup inicial
```

Objetivo recomendado para el MVP: primer ciclo con margen positivo modesto (~15-30%), jugado de forma eficiente (compra escalonada).

#### 126. Qué entra en el MVP de este sistema

```text
✔ Modelo de coste de tierra (sin multiplicadores)
✔ Modelo de coste de infraestructura (purchase + footprint)
✔ Separación adquisición / posesión / operación
✔ Fórmula de break-even para validar balance
✔ Precio de venta fijo
✔ Resumen de regreso con fórmula analítica exacta
✔ KPIs de balance como herramienta de diseño/QA

✘ Multiplicadores de ubicación/accesibilidad
✘ Fluctuación de mercado
✘ Contratos a futuro
✘ Reputación afectando precios
```

#### 127. Recomendación de herramienta

Convertir las secciones 117-121 en una hoja de cálculo de balance (fuera del GDD) donde las fórmulas se ajusten interactivamente, para evitar descubrir problemas de rentabilidad ya en producción.

---

# PARTE IX — TIEMPO, SIMULACIÓN Y ARQUITECTURA

## 51. Tiempo

```text
1 real hour = X game hours
```

Multiplicador configurable en el servidor.

---

## 52. Simulación offline

```text
lastSimulationTimestamp
currentTimestamp - lastSimulationTimestamp = elapsedTime
```

El servidor procesa las consecuencias al regreso del jugador.

---

## 53. Simulación basada en eventos

```text
Events + Timestamps + State transitions
```

```text
Field #15 — Task: PLOW — Started: 12:00 — Expected completion: 12:42
```

Si el jugador desconecta a las 12:05 y regresa a las 18:00, el servidor determina que la tarea se completó a las 12:42 y continúa con el siguiente evento. (Este patrón es la base de §80, §91, §104-105, §135.)

---

## 54. Servidor autoritativo

El backend es la fuente definitiva de verdad. El cliente nunca modifica directamente dinero, propiedad, maquinaria, trabajadores, campos, cultivos, inventario ni tiempos; solo solicita acciones.

```text
CLIENT → BUY_MACHINE → SERVER (validate money, validate machine, create machine, update balance) → CLIENT
```

---

## 55. Separación frontend/backend

```text
FRONTEND (Phaser.js, HTML/CSS, UI, Rendering, Input)
BACKEND (Game API, Simulation, Economy, Persistence, Validation)
              ↓
          Database
```

---

## 56. Frontend

Responsable de Phaser.js, renderizado, cámara, zoom, input, selección, animaciones, UI, mapas, representación de máquinas/trabajadores, visualización de progreso. No tiene autoridad sobre el estado.

---

## 57. Backend

Responsable de autenticación, jugadores, tierras, chunks modificados, campos, granjas, edificios, maquinaria, trabajadores, cultivos, inventario, mercado, economía, tiempo, simulación, persistencia y validación.

---

## 58. Persistencia procedural

```text
Chunk = Seed + Coordinates
```

Se persisten solo las modificaciones:

```text
Chunk (20,15)
Generated: Grass, Forest, Water...
Modifications: Cell 102 → owned, Cell 103 → owned, Cell 104 → Field #15
```

---

## 59. Cámara

Top-down 2D: desplazamiento, zoom, selección de celdas/campos, seguimiento de trabajadores/máquinas, carga dinámica de chunks. No isométrica inicialmente.

---

## 60. Presentación visual

Debe distinguirse claramente: Water, Forest, Mountain, Grass, Owned Land, Fields, Farm Buildings, Machines, Workers. Los estados agrícolas y forestales necesitan representación visual suficiente para lectura rápida del jugador.

---

## 61. Interfaz

```text
┌─────────────────────────────────────────────────────────┐
│ $125,400 | Day 18 | Spring | 2x | Workers 4/6         │
├───────────────────────────────────────────────┬─────────┤
│                    WORLD                      │ FIELD   │
│                 🚜                            │ Status  │
│         🌾🌾🌾                                  │ Crop    │
│ ~~~~~~~~~                                     │ Task    │
├───────────────────────────────────────────────┴─────────┤
│ World | Fields | Machines | Workers | Farm | Market    │
└─────────────────────────────────────────────────────────┘
```

HTML/CSS sobre el canvas de Phaser.

---

# PARTE X — PROGRESIÓN Y DECISIONES ESTRATÉGICAS

## 62. Progresión

```text
START (small land, small farm, few machines, few workers)
   ↓ EXPANSION (more fields, machines, workers, buildings)
LARGE FARM
   ↓
AGRICULTURAL COMPANY
```

---

## 63. Progresión de infraestructura

```text
Nivel inicial: 1 Garage, 1 Home, 1 Silo
   ↓
Expansión: 2 Garages, 2 Homes, 2 Silos, 1 Workshop
   ↓
Empresa: Multiple farms, large garages/silos, multiple workshops, large worker housing
```

No necesariamente "niveles" explícitos — progresión económica y espacial.

---

## 64. Restricciones estratégicas

```text
Capital + Land + Machines + Workers + Housing + Garage Capacity + Storage Capacity + Time
```

Evita que el crecimiento sea simplemente "tengo dinero → compro todo" (confirmado numéricamente en §118-120).

---

## 65. Decisiones estratégicas principales

* **Tierra:** ¿Compro más superficie o ahorro capital?
* **Agricultura vs bosque:** ¿Conservo el bosque o lo convierto en campo? (ver §138 para el análisis de liquidez)
* **Maquinaria:** ¿Compro una máquina adicional o amplío mi terreno?
* **Trabajadores:** ¿Contratar más o utilizar menos maquinaria simultáneamente?
* **Infraestructura:** ¿Construyo otro garaje o uso el capital para expansión?
* **Campos:** ¿Muchos campos pequeños o pocos grandes? (ver §122 sobre escalado)
* **Almacenamiento:** ¿Vendo inmediatamente o almaceno esperando mejores precios?

---

## 66. Campos pequeños vs grandes

```text
Campo pequeño: + fácil de gestionar, + menor inversión, + menor riesgo
               - menor producción, - más campos que administrar

Campo grande:  + mayor producción, + mejor utilización de maquinaria
               - mayor inversión, - mayor maquinaria necesaria, - mayor tiempo de trabajo
```

---

## 67. Idle gameplay

```text
Worker A → Field 1 / Worker B → Field 2 / Worker C → Field 3 / Logout

Al regresar:
Field 1 → Growing / Field 2 → Growing / Field 3 → Ready
Worker A → Idle / Worker B → Working / Worker C → Harvesting
```

---

## 68. Resumen de regreso

```text
WELCOME BACK
While you were away:
+ $18,420 revenue
- $4,320 salaries
- $1,250 maintenance
Net: + $12,850

Field #12 is ready to harvest.
Field #14 finished seeding.
Worker #5 is idle.
Silo is 72% full.
```

(Fórmula analítica exacta en §124.)

---

# PARTE XI — MVP Y ROADMAP

## 69. MVP

**Mundo:** Procedural generation, Seed, Chunks, Grass, Forest, Mountain, Water, Top-down camera, Zoom, Pan.

**Tierra:** Comprar terreno, Ownership, Celdas, Creación de campos, Campos multi-chunk.

**Agricultura:** Un cultivo (Wheat), ciclo agrícola completo (§75-86), estados inspirados en FS25, siembra, crecimiento, cosecha.

**Maquinaria:** Tractor, Plow, Cultivator, Seeder, Harvester, Trailer (catálogo y fórmulas en §87-99).

**Trabajadores:** Contratar, salario, asignar, trabajar, idle (sistema completo en §100-112).

**Granja:** Farm footprint, Garage, Silo, Worker Home, Workshop.

**Economía:** Capital inicial ($160,000 propuesto, §117), compra de tierra, compra de maquinaria, construcción, salarios, mantenimiento básico, venta de trigo.

**Persistencia:** Cuenta, Save game, Offline simulation.

---

## 70. Fuera del MVP

Animales, ganadería, multiplayer directo, PvP, vehículos controlados por jugador, clima complejo, contratos, préstamos, producción industrial, cadenas de producción, fertilizantes avanzados, herbicidas, trabajadores con habilidades avanzadas, transporte entre granjas, carreteras avanzadas, minería, pesca, modding, mercado global complejo.

La silvicultura (§128-142, ya diseñada en detalle) puede implementarse inmediatamente después del MVP agrícola para mantener el primer milestone pequeño.

---

## 71. Roadmap conceptual

```text
Fase 0 — Foundation: Frontend, Backend, Authentication, Database, World seed, Chunk generation
Fase 1 — World: Grass, Forest, Mountain, Water, Chunks, Camera
Fase 2 — Land: Land ownership, Land purchase, Field creation, Multi-chunk fields
Fase 3 — Farming: Crop, Field states, Planting, Growth, Harvest
Fase 4 — Machinery: Machines, Machine ownership, Workers, Assignments, Tasks
Fase 5 — Farm: Garage, Silo, Homes, Workshop, Farm footprint
Fase 6 — Economy: Starting capital, Costs, Salaries, Maintenance, Market
Fase 7 — Idle: Game clock, Offline simulation, Task completion, Return summary
Fase 8 — Forestry: Trees, Forest management, Logging equipment, Wood, Forestry economy
Fase 9 — Expansion: Multiple farms, More crops, More machinery, More buildings, Advanced economy
```

---

## 72. Principios técnicos derivados del GDD

```text
El mundo debe ser determinista:        Seed + Coordinates → Terrain
Los campos son independientes de chunks: Field ≠ Chunk
La granja tiene geometría:              Farm = Buildings + Footprint
La maquinaria es entidad persistente:    Machine
Los trabajadores son entidades persistentes: Worker
Las tareas son persistentes:            Task { worker, machine, target, startTime, completionTime }
El servidor es autoritativo:            Client → Request → Server → Validate → Mutate → Response
La simulación se ejecuta sin cliente:   Server → Time → Simulation
```

---

## 73. Arquitectura conceptual de dominio

```text
                         WORLD
                           │
             ┌─────────────┴─────────────┐
          CHUNKS                     PLAYERS
             │                           │
           CELLS                         │
             │                    ┌──────┴──────┐
      ┌──────┴──────┐             │             │
    LAND          TERRAIN       FARMS        ECONOMY
      │                           │
      │                    ┌──────┼───────┐
      │                    │      │       │
    FIELDS              BUILDINGS MACHINES WORKERS
      │                    │
      │              ┌─────┼──────┐
      │              │     │      │
      │            GARAGE SILO   HOME
      │                         WORKSHOP
      │
   CROPS
      │
   GROWTH

    FORESTPLOTS (paralelo a FIELDS, bajo LAND)
      │
    TREES
```

---

## 74. Visión a largo plazo

```text
Una pequeña granja → Un imperio agrícola y forestal
```

con múltiples granjas, grandes campos, explotación forestal, maquinaria especializada, trabajadores especializados, logística, almacenamiento, producción, mercado, economía dinámica, territorios enormes, interacción entre jugadores.

> **El jugador construye su empresa utilizando tierra, maquinaria, trabajadores e infraestructura, y obtiene rentabilidad mediante una planificación eficiente.**

---

# Índice de secciones detalladas (referencia rápida)

| Sistema | Visión general | Detalle técnico |
|---|---|---|
| Mundo, tierra, campos | §1-22 | — |
| Granja e infraestructura | §23-31 | — |
| Maquinaria | §32-33 | §87-99 |
| Trabajadores | §34-38 | §100-112 |
| Sistema agrícola | §39-44 | §75-86 |
| Silvicultura | §45 | §128-142 |
| Economía y balance | §46-50 | §113-127 |
| Tiempo y simulación | §51-53 | §80, §91, §104-105, §135, §124 |
| Arquitectura técnica | §54-61 | — |
| Progresión y estrategia | §62-68 | §118-122 |
| MVP y roadmap | §69-74 | — |

---
