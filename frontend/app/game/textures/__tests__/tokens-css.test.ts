// Guard on the generated block of app/assets/tokens.css.
//
// Owner: workflow W3-D (rendering core). Plan section 9.4 asks that the legend, the
// panels and the canvas be unable to diverge. Two mechanisms make that true, and this
// test is what turns the second one from an intention into a check:
//
//   1. At run time, `applyPaletteCssVariables` writes the palette onto the document
//      root when the game boots, so what the panels read is what the textures were
//      drawn with, whatever the stylesheet says.
//   2. In the repository, the palette block of `app/assets/tokens.css` is generated
//      from `paletteCssBlock()`. This test compares the file with the generator, so a
//      value edited by hand in the stylesheet fails the suite instead of quietly
//      making the legend lie until somebody notices the shade is off.
//
// The file is read from disc on purpose rather than imported: what has to be verified
// is the artefact the browser downloads before the canvas boots.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { paletteCssBlock, PALETTE_BLOCK_END, PALETTE_BLOCK_START } from '../palette';

// Resolved from this file and not from the working directory, so the test does not
// depend on whether the suite was started in frontend/ or at the repository root.
// Deliberately `path.resolve` and not `new URL(relative, import.meta.url)`: Vite
// rewrites that pattern into an asset URL, which under the jsdom environment resolves
// against `http://localhost` and never reaches the file system.
const TOKENS_CSS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../assets/tokens.css');

describe('generated palette block of tokens.css', () => {
  const source = readFileSync(TOKENS_CSS, 'utf8');

  it('keeps the two markers that delimit what this workflow owns', () => {
    // The interface block of the same file belongs to another agent of this phase, so
    // the markers are the whole reason two owners can share one file.
    expect(source).toContain(PALETTE_BLOCK_START);
    expect(source).toContain(PALETTE_BLOCK_END);
    expect(source.indexOf(PALETTE_BLOCK_START)).toBeLessThan(source.indexOf(PALETTE_BLOCK_END));
  });

  it('holds exactly what the palette generates', () => {
    const start = source.indexOf(PALETTE_BLOCK_START);
    const end = source.indexOf(PALETTE_BLOCK_END);
    const between = source.slice(source.indexOf('*/', start) + 2, source.lastIndexOf('/* =', end));
    expect(between.trim()).toBe(paletteCssBlock().trim());
  });

  it('does not declare a shell token inside the generated block', () => {
    const start = source.indexOf(PALETTE_BLOCK_START);
    const end = source.indexOf(PALETTE_BLOCK_END);
    const between = source.slice(start, end);
    for (const shellToken of ['--fw-bg', '--fw-surface', '--fw-text', '--fw-border', '--fw-font']) {
      expect(between).not.toContain(shellToken);
    }
  });
});
