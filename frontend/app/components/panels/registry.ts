// The panel registry. Frozen after W3-C (plan section 11, rule 2 and rule 3).
//
// Owner: W3-C, once. The agents of W4, W5 and W6 replace the body of the stub that belongs
// to them, in its own directory, and never touch this file. That is the whole reason it
// exists: a registry that grows by addition is the classic conflict of parallel work,
// because the last agent to write it silently deletes the entries of the others.
//
// The twenty three panels are the surface of plan section 9.6, decomposed as follows. The
// prose of that section lists twenty two clauses; the top bar and the tab bar are shell
// components and not panels, authentication is a page and not a panel, and three clauses
// cover more than one panel each: the fields clause is an inspector and a listing, the
// field geometry clause is a creation and an edit, and the forestry clause is a listing of
// plots and the inspector of one. The count is recorded here because it is the kind of
// number a later reader will want to check against the plan.
//
// Each entry declares its surface, its tab, the agent that fills it and the sections of the
// GDD it answers to, so that the assignment of the three groups of panels is data and not a
// paragraph in a handoff. The component is loaded lazily: `import()` creates no static edge
// in the module graph, which is what keeps this file free of a dependency on twenty three
// components and keeps a panel out of the initial bundle until it is opened.

import { defineAsyncComponent, type Component } from 'vue';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

/**
 * The tab bar. A tab is a grouping of the side panel and nothing else: it holds no state
 * and selecting one opens its default panel.
 */
export const PANEL_TABS = [
  { id: 'world', label: 'Mundo', defaultPanel: 'cell-inspector' },
  { id: 'fields', label: 'Campos', defaultPanel: 'field-list' },
  { id: 'farm', label: 'Granja', defaultPanel: 'farm-overview' },
  { id: 'machinery', label: 'Maquinaria', defaultPanel: 'machinery' },
  { id: 'staff', label: 'Personal', defaultPanel: 'workers' },
  { id: 'tasks', label: 'Tareas', defaultPanel: 'task-list' },
  { id: 'economy', label: 'Economia', defaultPanel: 'market' },
  { id: 'forestry', label: 'Silvicultura', defaultPanel: 'forestry' },
  { id: 'help', label: 'Ayuda', defaultPanel: 'legend' },
] as const;

export type PanelTabId = (typeof PANEL_TABS)[number]['id'];
export const PANEL_TAB_IDS: readonly PanelTabId[] = PANEL_TABS.map((tab) => tab.id);

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

/** Where a panel is rendered. The arbiter of `useShellUi` reads this and nothing else. */
export const PanelSurface = {
  /** The collapsible column of the central area. Does not take input from the world. */
  SIDE: 'SIDE',
  /** The fixed modal layer. Takes the input away from the world while it is open. */
  MODAL: 'MODAL',
  /** Anchored over the canvas, without taking input: the legend and the minimap. */
  OVERLAY: 'OVERLAY',
} as const;
export type PanelSurface = (typeof PanelSurface)[keyof typeof PanelSurface];

/** The agent that replaces the stub. Matches the three groups of docs/ownership.md. */
export type PanelOwner = 'W4-E' | 'W5-F' | 'W6-D';

export type PanelId =
  | 'cell-inspector'
  | 'land-purchase'
  | 'field-list'
  | 'field-inspector'
  | 'field-create'
  | 'field-edit'
  | 'farm-overview'
  | 'building-placement'
  | 'building-inspector'
  | 'machinery'
  | 'workers'
  | 'labor-pool'
  | 'task-assign'
  | 'task-list'
  | 'market'
  | 'forestry'
  | 'forest-plot'
  | 'welcome-back'
  | 'legend'
  | 'minimap'
  | 'notices'
  | 'starting-guide'
  | 'settings';

export interface PanelDefinition {
  readonly id: PanelId;
  /** Heading of the panel, in Spanish, as the shell shows it. */
  readonly title: string;
  /** One line that says what the panel is for. Shown by the stub and by the help tab. */
  readonly summary: string;
  readonly surface: PanelSurface;
  /** Tab that opens it, or null for a panel only reached from another panel. */
  readonly tab: PanelTabId | null;
  readonly owner: PanelOwner;
  /** Sections of the GDD the panel answers to, for the reviewer of W7. */
  readonly gddSections: readonly number[];
  readonly component: Component;
}

function lazy(loader: () => Promise<unknown>): Component {
  return defineAsyncComponent(loader as () => Promise<Component>);
}

export const PANEL_REGISTRY: Readonly<Record<PanelId, PanelDefinition>> = {
  'cell-inspector': {
    id: 'cell-inspector',
    title: 'Inspector de celda',
    summary: 'Terreno, propiedad, uso y arbolado de la celda seleccionada.',
    surface: PanelSurface.SIDE,
    tab: 'world',
    owner: 'W4-E',
    gddSections: [7, 8, 15],
    component: lazy(() => import('~/components/panels/cell-inspector/CellInspectorPanel.vue')),
  },
  'land-purchase': {
    id: 'land-purchase',
    title: 'Compra de tierra',
    summary: 'Presupuesto de la seleccion, motivo por celda bloqueada y compra parcial.',
    surface: PanelSurface.SIDE,
    tab: 'world',
    owner: 'W4-E',
    gddSections: [13, 14, 115],
    component: lazy(() => import('~/components/panels/land-purchase/LandPurchasePanel.vue')),
  },
  'field-list': {
    id: 'field-list',
    title: 'Campos',
    summary: 'Listado de campos con su estado del ciclo y su rendimiento previsto.',
    surface: PanelSurface.SIDE,
    tab: 'fields',
    owner: 'W4-E',
    gddSections: [16, 41, 76],
    component: lazy(() => import('~/components/panels/field-list/FieldListPanel.vue')),
  },
  'field-inspector': {
    id: 'field-inspector',
    title: 'Inspector de campo',
    summary: 'Recorrido de los ocho estados, malezas, fertilidad y operaciones validas.',
    surface: PanelSurface.SIDE,
    tab: 'fields',
    owner: 'W4-E',
    gddSections: [76, 77, 78, 83],
    component: lazy(() => import('~/components/panels/field-inspector/FieldInspectorPanel.vue')),
  },
  'field-create': {
    id: 'field-create',
    title: 'Crear campo',
    summary: 'Confirmacion de una seleccion contigua de celdas propias como campo nuevo.',
    surface: PanelSurface.MODAL,
    tab: null,
    owner: 'W4-E',
    gddSections: [17, 19],
    component: lazy(() => import('~/components/panels/field-create/FieldCreatePanel.vue')),
  },
  'field-edit': {
    id: 'field-edit',
    title: 'Ampliar, dividir o fusionar',
    summary: 'Las tres operaciones de geometria sobre un campo existente.',
    surface: PanelSurface.MODAL,
    tab: null,
    owner: 'W4-E',
    gddSections: [20, 21, 22],
    component: lazy(() => import('~/components/panels/field-edit/FieldEditPanel.vue')),
  },
  'farm-overview': {
    id: 'farm-overview',
    title: 'Granja',
    summary: 'Granjas, edificios, capacidades y ocupacion de los almacenes.',
    surface: PanelSurface.SIDE,
    tab: 'farm',
    owner: 'W4-E',
    gddSections: [23, 24, 116],
    component: lazy(() => import('~/components/panels/farm-overview/FarmOverviewPanel.vue')),
  },
  'building-placement': {
    id: 'building-placement',
    title: 'Colocar edificio',
    summary: 'Huella, precio real y compra del suelo cuando no es del jugador.',
    // Side and not modal, which is the one surface of this table that was wrong rather
    // than debatable: a modal takes the input away from the canvas, and this panel is the
    // companion of a placement mode where the footprint has to follow the cursor and a
    // click has to place it. Declared modal, the panel disabled the very gesture it exists
    // to explain (docs/handoff/NOTES-w4f.md, section 2.2).
    surface: PanelSurface.SIDE,
    tab: null,
    owner: 'W4-E',
    gddSections: [24, 115, 116],
    component: lazy(
      () => import('~/components/panels/building-placement/BuildingPlacementPanel.vue'),
    ),
  },
  'building-inspector': {
    id: 'building-inspector',
    title: 'Inspector de edificio',
    summary: 'Tipo, capacidad, ocupacion y valor de reventa de un edificio.',
    surface: PanelSurface.SIDE,
    tab: 'farm',
    owner: 'W4-E',
    gddSections: [24, 96, 108],
    component: lazy(
      () => import('~/components/panels/building-inspector/BuildingInspectorPanel.vue'),
    ),
  },
  machinery: {
    id: 'machinery',
    title: 'Maquinaria',
    summary: 'Parque, catalogo y el motivo del bloqueo cuando no hay plaza de garaje.',
    surface: PanelSurface.SIDE,
    tab: 'machinery',
    owner: 'W5-F',
    gddSections: [88, 89, 93, 96],
    component: lazy(() => import('~/components/panels/machinery/MachineryPanel.vue')),
  },
  workers: {
    id: 'workers',
    title: 'Trabajadores',
    summary: 'Plantilla, habilidad, salario por hora de juego y estado de cada uno.',
    surface: PanelSurface.SIDE,
    tab: 'staff',
    owner: 'W5-F',
    gddSections: [34, 101, 103, 108],
    component: lazy(() => import('~/components/panels/workers/WorkersPanel.vue')),
  },
  'labor-pool': {
    id: 'labor-pool',
    title: 'Pool de contratacion',
    summary: 'Candidatos, salario pedido y momento del siguiente refresco.',
    surface: PanelSurface.SIDE,
    tab: 'staff',
    owner: 'W5-F',
    gddSections: [102, 108],
    component: lazy(() => import('~/components/panels/labor-pool/LaborPoolPanel.vue')),
  },
  'task-assign': {
    id: 'task-assign',
    title: 'Asignar tarea',
    summary: 'Trabajador, maquinaria, prevision de duracion y coste, y motivo del bloqueo.',
    surface: PanelSurface.MODAL,
    tab: null,
    owner: 'W6-D',
    gddSections: [90, 91, 104],
    component: lazy(() => import('~/components/panels/task-assign/TaskAssignPanel.vue')),
  },
  'task-list': {
    id: 'task-list',
    title: 'Tareas activas',
    summary: 'Cuenta atras por tarea y cancelacion advertida de lo ya operado.',
    surface: PanelSurface.SIDE,
    tab: 'tasks',
    owner: 'W6-D',
    gddSections: [105, 106, 111],
    component: lazy(() => import('~/components/panels/task-list/TaskListPanel.vue')),
  },
  market: {
    id: 'market',
    title: 'Mercado',
    summary: 'Precios fijos, existencias y venta, admisible con saldo negativo.',
    surface: PanelSurface.SIDE,
    tab: 'economy',
    owner: 'W5-F',
    gddSections: [46, 47, 123, 133],
    component: lazy(() => import('~/components/panels/market/MarketPanel.vue')),
  },
  forestry: {
    id: 'forestry',
    title: 'Silvicultura',
    summary: 'Parcelas forestales, arbolado en pie y volumen talable.',
    surface: PanelSurface.SIDE,
    tab: 'forestry',
    owner: 'W6-D',
    gddSections: [128, 130, 135],
    component: lazy(() => import('~/components/panels/forestry/ForestryPanel.vue')),
  },
  'forest-plot': {
    id: 'forest-plot',
    title: 'Parcela forestal',
    summary: 'Histograma de fases, tala por lote, replantacion y desmonte.',
    surface: PanelSurface.SIDE,
    tab: 'forestry',
    owner: 'W6-D',
    gddSections: [10, 131, 132, 137],
    component: lazy(() => import('~/components/panels/forest-plot/ForestPlotPanel.vue')),
  },
  'welcome-back': {
    id: 'welcome-back',
    title: 'Resumen de regreso',
    summary: 'Que ocurrio durante la ausencia, con enlaces que mueven la camara.',
    surface: PanelSurface.MODAL,
    tab: null,
    owner: 'W6-D',
    gddSections: [52, 68, 124],
    component: lazy(() => import('~/components/panels/welcome-back/WelcomeBackPanel.vue')),
  },
  legend: {
    id: 'legend',
    title: 'Leyenda',
    summary: 'Que significa cada color del lienzo. Requisito de jugabilidad, no adorno.',
    surface: PanelSurface.OVERLAY,
    tab: 'help',
    owner: 'W4-E',
    gddSections: [59, 60],
    component: lazy(() => import('~/components/panels/legend/LegendPanel.vue')),
  },
  minimap: {
    id: 'minimap',
    title: 'Minimapa',
    summary: 'Miniatura por chunk, la misma que alimenta el nivel de detalle lejano.',
    surface: PanelSurface.OVERLAY,
    tab: null,
    owner: 'W4-E',
    gddSections: [59, 63],
    component: lazy(() => import('~/components/panels/minimap/MinimapPanel.vue')),
  },
  notices: {
    id: 'notices',
    title: 'Avisos',
    summary: 'Consecuencias que ocurrieron sin el jugador delante, con su motivo.',
    surface: PanelSurface.OVERLAY,
    tab: null,
    owner: 'W6-D',
    gddSections: [67, 97],
    component: lazy(() => import('~/components/panels/notices/NoticesPanel.vue')),
  },
  'starting-guide': {
    id: 'starting-guide',
    title: 'Guia de arranque',
    summary: 'La secuencia de compra escalonada que el balance del arranque exige.',
    surface: PanelSurface.SIDE,
    tab: 'help',
    owner: 'W5-F',
    gddSections: [117, 120],
    component: lazy(() => import('~/components/panels/starting-guide/StartingGuidePanel.vue')),
  },
  settings: {
    id: 'settings',
    title: 'Ajustes',
    summary: 'Preferencias del cliente, diagnostico de conexion y cierre de sesion.',
    surface: PanelSurface.MODAL,
    tab: 'help',
    owner: 'W5-F',
    gddSections: [61],
    component: lazy(() => import('~/components/panels/settings/SettingsPanel.vue')),
  },
};

export const PANEL_IDS = Object.keys(PANEL_REGISTRY) as readonly PanelId[];

/** Panels of one surface, in declaration order. */
export function panelsOfSurface(surface: PanelSurface): readonly PanelDefinition[] {
  return PANEL_IDS.map((id) => PANEL_REGISTRY[id]).filter((panel) => panel.surface === surface);
}

/** Panels reachable from one tab, in declaration order. */
export function panelsOfTab(tab: PanelTabId): readonly PanelDefinition[] {
  return PANEL_IDS.map((id) => PANEL_REGISTRY[id]).filter((panel) => panel.tab === tab);
}

/** Panels an agent of a later phase is responsible for. */
export function panelsOfOwner(owner: PanelOwner): readonly PanelDefinition[] {
  return PANEL_IDS.map((id) => PANEL_REGISTRY[id]).filter((panel) => panel.owner === owner);
}

// The registry is also the default export, because Nuxt scans app/components for
// components and generates a declaration that reads the default export of every file it
// finds, this one included. Without it the generated declaration would not type check.
export default PANEL_REGISTRY;
