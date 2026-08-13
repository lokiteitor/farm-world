// The keyboard and the pointer, as the client actually binds them.
//
// Owner: W4-E.
//
// Every entry here is a binding that exists in code, and the module that owns it is named
// beside it: the camera of `game/world/camera.ts`, the world scene of
// `game/world/WorldScene.ts`, the selection tool of `game/selection/SelectionTool.ts` and
// the shell arbiter of `composables/useShellUi.ts`. A shortcut list that documents an
// intention rather than a binding is worse than no list, so this one is asserted against
// nothing but is kept beside the legend, which is the panel a player opens when the
// interface stops being self evident (GDD sections 59 and 60).

export interface ShortcutEntry {
  /** The gesture, written as the player performs it. */
  readonly keys: string;
  readonly action: string;
  /** Module that binds it, so a reviewer can find it. */
  readonly boundBy: string;
}

export interface ShortcutGroup {
  readonly id: string;
  readonly title: string;
  readonly entries: readonly ShortcutEntry[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    id: 'camera',
    title: 'Camara',
    entries: [
      { keys: 'Arrastrar con el boton primario', action: 'Desplazar el mapa', boundBy: 'camera' },
      { keys: 'W A S D o flechas', action: 'Desplazar el mapa', boundBy: 'camera' },
      { keys: 'Rueda del raton', action: 'Zoom por pasos, anclado al cursor', boundBy: 'camera' },
      { keys: '+ y -', action: 'Zoom por pasos, anclado al centro', boundBy: 'camera' },
      { keys: 'Inicio', action: 'Volver a la granja', boundBy: 'camera' },
      { keys: 'F3', action: 'Contador de depuracion del renderizado', boundBy: 'WorldScene' },
    ],
  },
  {
    id: 'selection',
    title: 'Seleccion',
    entries: [
      { keys: 'Arrastrar', action: 'Sustituir la seleccion por el rectangulo', boundBy: 'tool' },
      { keys: 'Mayusculas y arrastrar', action: 'Unir el rectangulo', boundBy: 'tool' },
      { keys: 'Alt y arrastrar', action: 'Restar el rectangulo', boundBy: 'tool' },
      { keys: 'Control y clic', action: 'Conmutar una sola celda', boundBy: 'tool' },
      { keys: 'Intro', action: 'Confirmar y abrir el panel de la operacion', boundBy: 'tool' },
      { keys: 'Escape', action: 'Cancelar la seleccion', boundBy: 'tool' },
    ],
  },
  {
    id: 'shell',
    title: 'Interfaz',
    entries: [
      {
        keys: 'Escape',
        action:
          'Cerrar el dialogo superior; sin dialogo, la bandeja de avisos; sin bandeja, el panel lateral',
        boundBy: 'useShellUi',
      },
    ],
  },
];
