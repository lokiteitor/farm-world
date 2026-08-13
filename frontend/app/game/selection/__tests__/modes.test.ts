// The mode table, crossed with the purposes of the shared rules.
//
// Owner: workflow W4-G. The cross is the point: a mode that claimed a purpose the shared
// rules do not define, or a shared purpose no mode can reach, would be a hole nobody sees
// until a panel opens the wrong tool. It is the same reason ADR-0011 gives for crossing
// the compatibility matrix of GDD section 90 with the crop cycle state machine.

import { describe, expect, it } from 'vitest';
import {
  SELECTION_TOOL_MODES,
  SelectionShape,
  SelectionToolMode,
  bridgePurposeOfMode,
  modeDrawsSelection,
  modeOfBridgePurpose,
} from '../modes';
import { SELECTION_PURPOSE_RULES, SelectionPurpose } from '~/shared/index';

describe('the mode table', () => {
  it('has one entry per mode and no more', () => {
    expect(Object.keys(SELECTION_TOOL_MODES).sort()).toEqual(
      Object.values(SelectionToolMode).sort(),
    );
  });

  it('names only purposes the shared rules define', () => {
    for (const rule of Object.values(SELECTION_TOOL_MODES)) {
      if (rule.purpose === null) {
        continue;
      }
      expect(SELECTION_PURPOSE_RULES[rule.purpose]).toBeDefined();
    }
  });

  it('reaches every shared purpose from exactly one mode', () => {
    const byPurpose = new Map<SelectionPurpose, number>();
    for (const rule of Object.values(SELECTION_TOOL_MODES)) {
      if (rule.purpose === null) {
        continue;
      }
      byPurpose.set(rule.purpose, (byPurpose.get(rule.purpose) ?? 0) + 1);
    }
    for (const purpose of Object.values(SelectionPurpose)) {
      expect(byPurpose.get(purpose)).toBe(1);
    }
  });

  it('cites the GDD for every mode', () => {
    for (const rule of Object.values(SELECTION_TOOL_MODES)) {
      expect(rule.gddSections.length).toBeGreaterThan(0);
    }
  });

  it('draws a set in every mode but inspection', () => {
    for (const mode of Object.values(SelectionToolMode)) {
      expect(modeDrawsSelection(mode)).toBe(mode !== SelectionToolMode.INSPECT);
    }
  });

  it('places a fixed footprint only where a catalogue fixes the shape', () => {
    for (const [mode, rule] of Object.entries(SELECTION_TOOL_MODES)) {
      expect(rule.shape === SelectionShape.FIXED_FOOTPRINT).toBe(
        mode === SelectionToolMode.BUILDING,
      );
      expect(rule.requiresBuildingType).toBe(mode === SelectionToolMode.BUILDING);
    }
  });

  it('asks for the cells of the subject exactly where the operation acts on one', () => {
    for (const [mode, rule] of Object.entries(SELECTION_TOOL_MODES)) {
      expect(rule.requiresTargetCells).toBe(
        mode === SelectionToolMode.FIELD_EXTEND || mode === SelectionToolMode.FIELD_SPLIT,
      );
    }
  });
});

describe('the mapping to and from the bridge', () => {
  it('returns to inspection for a null purpose', () => {
    expect(modeOfBridgePurpose(null)).toBe(SelectionToolMode.INSPECT);
    expect(bridgePurposeOfMode(SelectionToolMode.INSPECT)).toBeNull();
  });

  it('round trips every mode whose purpose is its own', () => {
    for (const mode of Object.values(SelectionToolMode)) {
      const purpose = SELECTION_TOOL_MODES[mode].purpose;
      if (purpose === null) {
        continue;
      }
      expect(modeOfBridgePurpose(purpose)).toBe(mode);
      expect(bridgePurposeOfMode(mode)).toBe(purpose);
    }
  });

  it('gives the two modes without a purpose one that still frees the primary button', () => {
    // The camera only reads whether the purpose is null (`WorldCamera.setPanWithPrimary`),
    // so a borrowed purpose is enough and is what keeps a split or a felling from panning
    // the camera under the drag.
    expect(bridgePurposeOfMode(SelectionToolMode.FIELD_SPLIT)).not.toBeNull();
    expect(bridgePurposeOfMode(SelectionToolMode.FELL_AREA)).not.toBeNull();
  });
});
