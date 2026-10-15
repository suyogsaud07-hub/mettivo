#!/usr/bin/env node
/**
 * scripts/generate-locales.mjs — machine-translate the UI strings.
 *
 * WHAT THIS PRODUCES
 *   `src/lib/locale-data.ts`: every key in `translations.ts`, for every language
 *   in `src/lib/locales.ts`. Without it, adding a language to the picker would
 *   render English — a dropdown that looks global and does nothing, which is
 *   exactly the failure the picker exists to avoid.
 *
 * WHY MACHINE TRANSLATION, AND WHY IT IS LABELLED
 *   There is no translation vendor wired to this project and no budget line for
 *   one. The alternative was either a five-language picker or a ~45-language
 *   picker backed by English. Machine output that is *declared* as machine
 *   output is honest and useful; the same output presented as reviewed copy
 *   would not be. The generated file carries that declaration, and the picker
 *   shows a "machine-translated" note rather than implying human review.
 *
 * WHY MYMEMORY
 *   It is the only provider in the decision that needs no key at all, so this
 *   script runs in a fresh checkout with no configuration. Anonymous quota is
 *   ~5,000 characters/day, which is why the work is CACHED: a re-run resumes
 *   from `scripts/.locale-cache.json` instead of burning the quota again.
 *
 * QUALITY CONTROLS
 *   * Each batch is sent with a `\n` separator and the response must split back
 *     into the same number of lines, or the batch is retried and then skipped —
 *     a mis-split translation is worse than a missing one.
 *   * `en` is NEVER fetched: it is the source.
 *   * The five hand-written locales (ne, hi, es, fr) are preserved. Machine
 *     output does not overwrite reviewed copy.
 *   * Idempotent: existing cache entries are reused, so re-running costs nothing.
 *
 * Usage:
 *   node scripts/generate-locales.mjs            # fill in what is missing
 *   node scripts/generate-locales.mjs --force    # re-fetch cached entries too
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CACHE = join(ROOT, 'scripts', '.locale-cache.json');
const OUT = join(ROOT, 'src', 'lib', 'locale-data.ts');
const SOURCE = join(ROOT, 'src', 'lib', 'translations.ts');
const LOCALES = join(ROOT, 'src', 'lib', 'locales.ts');

/** Hand-written locales whose strings must not be replaced by machine output. */
const HUMAN_LOCALES = new Set(['en', 'ne', 'hi', 'es', 'fr']);

/** Language codes, read from the catalogue so the two cannot disagree. */
function readLocaleCodes() {
  const src = readFileSync(LOCALES, 'utf8');
  const block = /LOCALE_CODES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!block) throw new Error('could not read LOCALE_CODES from src/lib/locales.ts');
  return [...block[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
}

/** English keys and values, read from the English block of translations.ts. */
function readEnglish() {
  const src = readFileSync(SOURCE, 'utf8');
  const start = src.indexOf('en: {');
  if (start === -1) throw new Error('could not find the `en` block in translations.ts');
  const end = src.indexOf('\n  },', start);
  const block = src.slice(start, end);

  const pairs = [...block.matchAll(/^\s*([a-z_]+):\s*'((?:[^'\\]|\\.)*)',/gm)];
  if (pairs.length === 0) throw new Error('no keys parsed from the `en` block');
  return pairs.map(([, key, value]) => [key, value.replace(/\\'/g, "'")]);
}

/** Existing hand-written translations, so reviewed copy is not overwritten. */
function readExisting() {
  const src = readFileSync(SOURCE, 'utf8');
  const result = {};
  for (const code of HUMAN_LOCALES) {
    if (code === 'en') continue;
    const start = src.indexOf(`\n  ${code}: {`);
    if (start === -1) continue;
    const end = src.indexOf('\n  },', start);
    const block = src.slice(start, end);
    const entry = {};
    for (const [, key, value] of block.matchAll(/^\s*([a-z_]+):\s*'((?:[^'\\]|\\.)*)',/gm)) {
      entry[key] = value.replace(/\\'/g, "'");
    }
    result[code] = entry;
  }
  return result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Splits `keys` into batches whose joined English text stays well under
 * MyMemory's 500-byte `q` cap. The cap is BYTES, not characters, so it is
 * measured with TextEncoder.
 */
function batch(keys, english, limit = 380) {
  const batches = [];
  let current = [];
  let currentBytes = 0;

  for (const key of keys) {
    const size = new TextEncoder().encode(english[key]).length + 1;
    if (current.length > 0 && currentBytes + size > limit) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(key);
    currentBytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function translateBatch(texts, target) {
  const joined = texts.join('\n');
  const url =
    'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(joined) +
    '&langpair=en|' +
    encodeURIComponent(target);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const body = await response.json();
  if (body?.quotaFinished) throw new Error('QUOTA');
  if (body?.responseStatus !== 200) {
    throw new Error(`upstream ${body?.responseStatus ?? 'unknown'}`);
  }

  const translated = body?.responseData?.translatedText;
  if (typeof translated !== 'string' || !translated.trim()) {
    throw new Error('empty translation');
  }

  const lines = translated.split('\n').map((line) => line.trim());
  if (lines.length !== texts.length) {
    // A separator that did not survive means the mapping is unreliable.
    throw new Error(`split ${lines.length} !== ${texts.length}`);
  }
  return lines;
}

async function main() {
  const force = process.argv.includes('--force');
  const codes = readLocaleCodes();
  const english = Object.fromEntries(readEnglish());
  const keys = Object.keys(english);
  const existing = readExisting();

  const cache = !force && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};

  console.log(`${codes.length} languages x ${keys.length} keys; ${keys.length} are the English source.`);

  let requests = 0;
  let skipped = 0;
  const failed = [];

  for (const code of codes) {
    if (code === 'en') continue;
    cache[code] ??= {};

    // Hand-written locales: keep every string we already have.
    const preserved = existing[code] ?? {};
    for (const [key, value] of Object.entries(preserved)) cache[code][key] = value;

    const missing = keys.filter((key) => !cache[code][key]);
    if (missing.length === 0) continue;

    for (const group of batch(missing, english)) {
      const texts = group.map((key) => english[key]);
      try {
        const lines = await translateBatch(texts, code);
        group.forEach((key, index) => {
          cache[code][key] = lines[index];
        });
        requests += 1;
        writeFileSync(CACHE, JSON.stringify(cache, null, 2));
        process.stdout.write(`  ${code}: ${Object.keys(cache[code]).length}/${keys.length}\r`);
      } catch (error) {
        const message = String(error.message ?? error);
        if (message === 'QUOTA') {
          console.error('\nMyMemory anonymous daily quota reached. Progress is cached; re-run tomorrow.');
          writeFileSync(CACHE, JSON.stringify(cache, null, 2));
          process.exitCode = 1;
          break;
        }
        failed.push(`${code} ${group.join(',')}: ${message}`);
        skipped += 1;
      }
      // Anonymous quota is per-day; a small gap keeps the requests civil.
      await sleep(140);
    }
  }

  writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  writeFileSync(OUT, render(codes, keys, cache, english));
  console.log(`\nwrote ${OUT.split('/').pop()} — ${requests} requests, ${skipped} skipped`);
  if (failed.length) {
    console.error(`${failed.length} batch(es) failed, left as English fallback:`);
    for (const line of failed.slice(0, 20)) console.error('  ' + line);
  }
}

/** Emits the TypeScript data module. */
function render(codes, keys, cache, english) {
  const header = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Machine translations of every UI string, produced by
 * \`node scripts/generate-locales.mjs\` via the MyMemory public API.
 *
 * WHY THIS IS A GENERATED DATA MODULE
 *   The language picker offers every language in \`src/lib/locales.ts\`. Each one
 *   needs strings for all ${keys.length} keys, or selecting it would render
 *   English and the picker would be a decoration. These translations have NOT
 *   been reviewed by a human speaker: treat them as a working baseline to be
 *   corrected, and prefer a native review before marketing in a given language.
 *   The \`ne\`, \`hi\`, \`es\` and \`fr\` entries were written by hand and are
 *   preserved by the generator.
 *
 * Re-generate with:
 *   npm run generate:locales
 */

export const LOCALE_DATA = {
`;

  const body = codes
    .map((code) => {
      const entries = keys
        .map((key) => {
          // `en` is the source of truth and never machine-translated.
          const value = code === 'en' ? english[key] : (cache[code]?.[key] ?? english[key]);
          return `    ${key}: ${quote(value)},`;
        })
        .join('\n');
      return `  ${code}: {\n${entries}\n  },`;
    })
    .join('\n');

  return `${header}${body}\n} as const;\n`;
}

/** Single-quoted TS string literal, escaping what must be escaped. */
function quote(value) {
  const escaped = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, '\\n');
  return `'${escaped}'`;
}

main().catch((error) => {
  console.error('locale generation failed:', error);
  process.exit(1);
});
