#!/usr/bin/env node
//
// Appends a numbered entry to docs/adr.md.
//
// All architecture decision records live in a single document (plan section 1).
// Because the workflows are sequential, at the close of each one a single
// designated agent adds that phase's decisions with this script, so there are
// never two concurrent writers on the file.
//
// Usage:
//   node scripts/adr-append.mjs --file entry.md
//   node scripts/adr-append.mjs < entry.md
//   node scripts/adr-append.mjs --file entry.md --dry-run
//
// The entry must start with a heading of the form:
//   ## ADR-0006 — Titulo de la decision
//
// and must contain the five sections of the template: Estado, Contexto,
// Decision, Consecuencias, Alternativas descartadas.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADR_PATH = resolve(ROOT, 'docs/adr.md');

const INDEX_START = '<!-- adr-index:start -->';
const INDEX_END = '<!-- adr-index:end -->';
const ENTRIES_MARKER = '<!-- adr-entries -->';

const REQUIRED_SECTIONS = [
  'Estado',
  'Contexto',
  'Decision',
  'Consecuencias',
  'Alternativas descartadas',
];

const HEADING = /^##\s+ADR-(\d{4})\s+—\s+(.+?)\s*$/m;

function fail(message) {
  process.stderr.write(`adr-append: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { file: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') {
      i += 1;
      options.file = argv[i] ?? null;
      if (options.file === null) fail('--file requires a path.');
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'Usage: adr-append.mjs [--file <path>] [--dry-run]\n' +
          '       adr-append.mjs < entry.md\n',
      );
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function readEntry(file) {
  if (file !== null) {
    try {
      return readFileSync(resolve(process.cwd(), file), 'utf8');
    } catch (error) {
      fail(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const stdin = readFileSync(0, 'utf8');
  if (stdin.trim() === '') {
    fail('no entry provided. Pass --file <path> or pipe the entry on stdin.');
  }
  return stdin;
}

/** Normalises accents so that "Decisión" and "Decision" both match. */
function fold(text) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function validateEntry(entry) {
  const match = HEADING.exec(entry);
  if (match === null) {
    fail(
      'the entry must start with a heading of the form "## ADR-0006 — Titulo" ' +
        '(four digits, em dash).',
    );
  }
  const [, digits, title] = match;
  const folded = fold(entry);
  const missing = missingSections(folded);
  if (missing.length > 0) {
    fail(`the entry is missing required sections: ${missing.join(', ')}.`);
  }
  return { number: Number.parseInt(digits, 10), digits, title };
}

function missingSections(foldedEntry) {
  return REQUIRED_SECTIONS.filter((section) => {
    const pattern = new RegExp(`^###\\s+${section}\\b`, 'm');
    return !pattern.test(foldedEntry);
  });
}

function existingNumbers(document) {
  const numbers = [];
  const pattern = /^##\s+ADR-(\d{4})\s+—/gm;
  let match = pattern.exec(document);
  while (match !== null) {
    numbers.push(Number.parseInt(match[1], 10));
    match = pattern.exec(document);
  }
  return numbers;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  let document;
  try {
    document = readFileSync(ADR_PATH, 'utf8');
  } catch {
    fail(`docs/adr.md not found at ${ADR_PATH}.`);
  }

  for (const marker of [INDEX_START, INDEX_END, ENTRIES_MARKER]) {
    if (!document.includes(marker)) {
      fail(`docs/adr.md has lost the marker ${marker}; restore it before appending.`);
    }
  }

  const entry = readEntry(options.file).trim();
  const { number, digits, title } = validateEntry(entry);

  const taken = existingNumbers(document);
  if (taken.includes(number)) {
    fail(`ADR-${digits} already exists in docs/adr.md. Choose the next free number.`);
  }

  const highest = taken.length > 0 ? Math.max(...taken) : 0;
  if (number !== highest + 1) {
    fail(
      `ADR-${digits} is not the next number: the highest recorded is ` +
        `${String(highest).padStart(4, '0')}, so the next one is ` +
        `${String(highest + 1).padStart(4, '0')}.`,
    );
  }

  const indexRow = `| ADR-${digits} | ${title} | ${anchorOf(digits, title)} |\n`;
  const withIndex = document.replace(INDEX_END, `${indexRow}${INDEX_END}`);
  const updated = `${withIndex.trimEnd()}\n\n---\n\n${entry}\n`;

  if (options.dryRun) {
    process.stdout.write(`adr-append: ADR-${digits} "${title}" would be appended.\n`);
    return;
  }

  writeFileSync(ADR_PATH, updated, 'utf8');
  process.stdout.write(`adr-append: ADR-${digits} "${title}" appended to docs/adr.md.\n`);
}

/** GitHub-style anchor for the entry heading, used by the index. */
function anchorOf(digits, title) {
  const slug = fold(`ADR-${digits} — ${title}`)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    // One hyphen per space, not per run of spaces: that is what GitHub does,
    // and the em dash of the heading leaves two spaces behind.
    .replace(/\s/g, '-');
  return `[Ver](#${slug})`;
}

main();
