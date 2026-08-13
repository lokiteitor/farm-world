// Client preferences: the handful of settings that belong to this browser and not to the
// world.
//
// Owner: W4-E.
//
// They are not server state and they are deliberately not in Pinia. Nothing here is reduced
// from a frame, nothing here is authoritative, and putting them in a store would invite the
// reducer to write them; the same reasoning `composables/useShellUi.ts` gives for its own
// module scoped state. What they do need is to survive a reload, because a preference the
// player has to set again on every page load is not a preference, so they are persisted in
// `localStorage` under one key and read back defensively: an unparsable or half written
// value falls back to the default rather than throwing on boot.
//
// Two of the five reach the DOM and take effect immediately. The other three are settings of
// the canvas, and the bridge of `composables/useGameBridge.ts` declares no event that carries
// them: the fifteen events it has are frozen and none means "the render settings changed".
// The change to make is recorded in `docs/handoff/NOTES-w4e.md`, section 1, following the
// same pattern W4-G used for `selection:confirmed`. Until it is applied the values are
// stored, published on `world:reload`, and read by whoever builds the scene.

import { NEAR_LOD_MIN_ZOOM, ZOOM_STEPS } from '~/game/world/config';

export const PREFERENCES_STORAGE_KEY = 'farm-world.preferences';

/** How much a wheel notch zooms, as a multiplier over the discrete step of the camera. */
export const ZOOM_SENSITIVITY_MIN = 0.5;
export const ZOOM_SENSITIVITY_MAX = 2;

export interface ClientPreferences {
  /** The grid of the canvas (plan section 9.3). Only drawn at the near level of detail. */
  readonly gridVisible: boolean;
  /** Property, field, farm and plot outlines (plan section 9.3). */
  readonly outlinesVisible: boolean;
  /** Zoom at or above which the near level of detail is used. */
  readonly lodThresholdZoom: number;
  /** Multiplier over one zoom step per wheel notch. */
  readonly zoomSensitivity: number;
  /** Suppresses the camera flight and the zoom transition. */
  readonly reducedMotion: boolean;
}

export const DEFAULT_PREFERENCES: ClientPreferences = {
  gridVisible: true,
  outlinesVisible: true,
  lodThresholdZoom: NEAR_LOD_MIN_ZOOM,
  zoomSensitivity: 1,
  reducedMotion: false,
};

/**
 * Thresholds the player may choose, one between each pair of consecutive zoom steps.
 *
 * Between and never on a step, which is the property `game/world/config.ts` protects when it
 * says that no step sits on `NEAR_LOD_MIN_ZOOM`: a threshold that coincided with a step would
 * make crossing it a float comparison on the exact value the camera lands on. The interval the
 * renderer already chose a value inside keeps that value, so the default of this module is the
 * constant of the renderer and not a second opinion about it.
 */
export const LOD_THRESHOLD_CHOICES: readonly number[] = ZOOM_STEPS.slice(0, -1)
  .map((step, index) => {
    const next = ZOOM_STEPS[index + 1] ?? step;
    return step < NEAR_LOD_MIN_ZOOM && NEAR_LOD_MIN_ZOOM < next
      ? NEAR_LOD_MIN_ZOOM
      : Math.round(((step + next) / 2) * 100) / 100;
  })
  .filter((choice) => choice <= 1);

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Coerces anything into a valid set of preferences.
 *
 * Total on purpose: the input is whatever was in `localStorage`, which may have been written
 * by an older version of this file or by hand. A field that does not parse takes its default
 * instead of rejecting the whole object, so one bad key cannot reset the other four.
 */
export function normalisePreferences(value: unknown): ClientPreferences {
  const source =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const threshold =
    typeof source.lodThresholdZoom === 'number' &&
    LOD_THRESHOLD_CHOICES.includes(source.lodThresholdZoom)
      ? source.lodThresholdZoom
      : DEFAULT_PREFERENCES.lodThresholdZoom;
  return {
    gridVisible:
      typeof source.gridVisible === 'boolean'
        ? source.gridVisible
        : DEFAULT_PREFERENCES.gridVisible,
    outlinesVisible:
      typeof source.outlinesVisible === 'boolean'
        ? source.outlinesVisible
        : DEFAULT_PREFERENCES.outlinesVisible,
    lodThresholdZoom: threshold,
    zoomSensitivity:
      typeof source.zoomSensitivity === 'number' && Number.isFinite(source.zoomSensitivity)
        ? clamp(source.zoomSensitivity, ZOOM_SENSITIVITY_MIN, ZOOM_SENSITIVITY_MAX)
        : DEFAULT_PREFERENCES.zoomSensitivity,
    reducedMotion:
      typeof source.reducedMotion === 'boolean'
        ? source.reducedMotion
        : DEFAULT_PREFERENCES.reducedMotion,
  };
}

/** The storage the module writes to. Injected so a test needs no browser global. */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): PreferenceStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // A browser with storage blocked throws on the property access itself.
    return null;
  }
}

export function loadPreferences(
  storage: PreferenceStorage | null = defaultStorage(),
): ClientPreferences {
  if (storage === null) {
    return DEFAULT_PREFERENCES;
  }
  const raw = storage.getItem(PREFERENCES_STORAGE_KEY);
  if (raw === null) {
    return DEFAULT_PREFERENCES;
  }
  try {
    return normalisePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(
  preferences: ClientPreferences,
  storage: PreferenceStorage | null = defaultStorage(),
): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // A full or blocked storage is not a reason to lose the setting for this session.
  }
}

/**
 * Applies the preferences the DOM owns.
 *
 * Only reduced motion is one of them today, and it is applied as an attribute on the root
 * element so that a stylesheet, and not a component, decides what "reduced" means.
 */
export function applyDocumentPreferences(
  preferences: ClientPreferences,
  root: {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  } | null,
): void {
  if (root === null) {
    return;
  }
  if (preferences.reducedMotion) {
    root.setAttribute('data-fw-reduced-motion', 'true');
    return;
  }
  root.removeAttribute('data-fw-reduced-motion');
}
