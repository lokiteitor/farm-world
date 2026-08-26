// The key capture of the camera against the input arbiter.
//
// Owner: workflow W4-D. The camera pans with WASD and the arrows, and Phaser captures a key
// by calling `preventDefault` from its own `window` listener, before any code of this class
// and without consulting `inputEnabled`. Left permanently on, that capture swallows the
// character of every text field of the client: the panels are HTML and the world is a canvas,
// and both live under the same window.
//
// So what is pinned here is not the panning, which needs a real scene, but the one boolean the
// panning shares with the forms: the capture follows the verdict of the arbiter and it does not
// outlive the camera.

import { describe, expect, it, vi } from 'vitest';
import { WorldCamera } from '../camera';
import { CELL_PX } from '~/shared/index';

// `vitest.config.ts` states that Phaser is not unit tested, and this test does not test it:
// the double below stands in for the five event names `camera.ts` reads, so that the class can
// be built in jsdom, where the real Phaser aborts on a canvas it cannot get a context for.
// Vitest hoists `vi.mock` above the imports, so the import of `../camera` already sees it.
// What is asserted below belongs entirely to this class.
vi.mock('phaser', () => ({
  default: {
    Input: {
      Events: {
        POINTER_DOWN: 'pointerdown',
        POINTER_MOVE: 'pointermove',
        POINTER_UP: 'pointerup',
        POINTER_UP_OUTSIDE: 'pointerupoutside',
        GAMEOBJECT_WHEEL: 'gameobjectwheel',
      },
    },
  },
}));

const PAN_KEYS = ['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT'];

/** The set of captured keys, which is all of Phaser this test needs to be honest about. */
function keyboardStub() {
  const captured = new Set<string>();
  const split = (keys: string): string[] => keys.split(',').map((key) => key.trim());
  const addKeys = vi.fn(() => ({}));
  return {
    captured,
    addKeys,
    plugin: {
      addKeys,
      addCapture: (keys: string): void => {
        for (const key of split(keys)) {
          captured.add(key);
        }
      },
      removeCapture: (keys: string): void => {
        for (const key of split(keys)) {
          captured.delete(key);
        }
      },
      on: (): void => undefined,
      off: (): void => undefined,
    },
  };
}

function cameraOn(keyboard: ReturnType<typeof keyboardStub>): WorldCamera {
  const scene = {
    scale: { gameSize: { width: 800, height: 600 } },
    input: { on: (): void => undefined, off: (): void => undefined, keyboard: keyboard.plugin },
  };
  return new WorldCamera({
    scene: scene as never,
    cellPx: CELL_PX,
    onChanged: () => undefined,
  });
}

describe('the key capture of the camera', () => {
  it('creates the keys without the capture addKeys turns on by default', () => {
    const keyboard = keyboardStub();
    cameraOn(keyboard);
    // The second argument is `enableCapture`, and omitting it is what produced the bug.
    expect(keyboard.addKeys).toHaveBeenCalledWith(expect.any(String), false);
  });

  it('captures the eight keys while the world holds the input', () => {
    const keyboard = keyboardStub();
    cameraOn(keyboard);
    expect([...keyboard.captured].sort()).toEqual([...PAN_KEYS].sort());
  });

  it('releases the capture when a text field or a modal takes the input', () => {
    const keyboard = keyboardStub();
    const camera = cameraOn(keyboard);
    camera.setInputEnabled(false);
    // Empty, and not "the keys are ignored": the keystroke has to reach the panel input.
    expect([...keyboard.captured]).toEqual([]);
    camera.setInputEnabled(true);
    expect([...keyboard.captured].sort()).toEqual([...PAN_KEYS].sort());
  });

  it('leaves no capture behind when destroyed, because the capture is global', () => {
    const keyboard = keyboardStub();
    const camera = cameraOn(keyboard);
    camera.destroy();
    expect([...keyboard.captured]).toEqual([]);
  });
});
