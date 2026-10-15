#!/usr/bin/env node
/**
 * scripts/generate-icons.mjs — rasterise the Mettivo logo into every app icon.
 *
 * WHY THIS EXISTS
 *   `public/icons/*.png` and the favicon are binary artefacts derived from the
 *   brand mark. Without a generator, changing the logo means hand-exporting six
 *   files, and the icons silently drift from `public/logo-mark.svg` — the exact
 *   failure mode that leaves an app showing last year's logo on the home screen.
 *
 * WHY CHROMIUM AND NOT AN IMAGE LIBRARY
 *   The mark is an SVG with gradients and a filter. A correct rasterisation
 *   needs a real SVG renderer; the repository already ships Chromium for the
 *   Playwright suite, so this reuses it rather than adding a dependency.
 *
 * Usage:
 *   node scripts/generate-icons.mjs            # write the icons
 *   node scripts/generate-icons.mjs --preview  # also write /tmp/mettivo-preview.png
 *
 * Fonts: the favicon and the badge render the mark only, so the output never
 * depends on a font being installed on the machine that runs this.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = process.cwd();
const MARK_SVG = readFileSync(join(ROOT, 'public', 'logo-mark.svg'), 'utf8');

/** The mark's own coordinate system, read from the file so the two cannot drift. */
const VIEW_BOX = /\bviewBox="([^"]+)"/.exec(MARK_SVG)?.[1] ?? '180 0 640 870';
const [, vbX, vbY, vbW, vbH] = VIEW_BOX.split(/\s+/).map(Number);
const MARK_ASPECT = vbW / vbH;

/** Brand background; matches the manifest's `background_color`. */
const BRAND_BG = '#131017';

const ICONS = [
  { file: 'public/icons/icon-192.png', size: 192, bg: BRAND_BG, pad: 0.08, round: false },
  { file: 'public/icons/icon-512.png', size: 512, bg: BRAND_BG, pad: 0.08, round: false },
  // Android crops maskable icons to a circle or squircle: everything that must
  // survive lives inside the middle 80%, so the mark is padded to ~60% of the
  // canvas rather than 84%.
  { file: 'public/icons/icon-maskable-192.png', size: 192, bg: BRAND_BG, pad: 0.2, round: false },
  { file: 'public/icons/icon-maskable-512.png', size: 512, bg: BRAND_BG, pad: 0.2, round: false },
  { file: 'public/icons/apple-touch-icon.png', size: 180, bg: BRAND_BG, pad: 0.1, round: false },
  // Notification badge: tiny, and drawn larger in its box because a 96px badge
  // has no room for generous padding.
  { file: 'public/icons/badge-96.png', size: 96, bg: BRAND_BG, pad: 0.06, round: true },
  // Favicon bitmaps. TRANSPARENT on purpose, for two reasons: a favicon is
  // composited onto the browser's own chrome, which may be light or dark; and
  // Next's ICO decoder refuses an RGB PNG ("The PNG is not in RGBA format"),
  // which turns the whole app into a 500 at build time. Rasterising these with
  // an opaque background is what produced that failure the first time.
  { file: 'public/icons/favicon-16.png', size: 16, bg: 'transparent', pad: 0.04, transparent: true },
  { file: 'public/icons/favicon-32.png', size: 32, bg: 'transparent', pad: 0.04, transparent: true },
  { file: 'public/icons/favicon-48.png', size: 48, bg: 'transparent', pad: 0.04, transparent: true },
];

/** An HTML document that paints the mark centred in a square canvas. */
function pageHtml(size, { bg, pad, round }) {
  const target = size * (1 - pad * 2);
  const width = MARK_ASPECT >= 1 ? target : target * MARK_ASPECT;
  const height = MARK_ASPECT >= 1 ? target / MARK_ASPECT : target;

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: ${size}px; height: ${size}px; background: transparent; }
  .canvas {
    width: ${size}px; height: ${size}px;
    background: ${bg};
    display: flex; align-items: center; justify-content: center;
    ${round ? 'border-radius: 22%;' : ''}
  }
  svg { width: ${width}px; height: ${height}px; display: block; }
</style></head>
<body><div class="canvas">${MARK_SVG}</div></body></html>`;
}

async function render(browser, spec) {
  const page = await browser.newPage({
    viewport: { width: spec.size, height: spec.size },
    deviceScaleFactor: 1,
  });
  // `omitBackground` is required for the transparent favicon bitmaps: without
  // it Chromium composites onto white and emits an RGB PNG, which the ICO
  // decoder rejects. Opaque icons keep their brand background.
  await page.setContent(pageHtml(spec.size, spec), { waitUntil: 'load' });
  const buffer = await page.screenshot({
    type: 'png',
    omitBackground: Boolean(spec.transparent),
  });
  await page.close();
  return buffer;
}

/**
 * Packs PNG-encoded images into a single `.ico`.
 *
 * The ICO container allows PNG payloads (Vista and every current browser), so
 * there is no need to write BMP/DIB data by hand — and no need for an image
 * library, which this repository deliberately does not add for a build artefact.
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(entries.length * 16);
  let offset = 6 + directory.length;

  entries.forEach((entry, index) => {
    const at = index * 16;
    // 0 means 256 in the ICO format; these icons are all <= 48 so the value is
    // written literally.
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 0);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2); // palette colours
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

async function main() {
  const preview = process.argv.includes('--preview');
  const browser = await chromium.launch();
  const written = [];

  try {
    const rendered = new Map();
    for (const spec of ICONS) {
      const png = await render(browser, spec);
      rendered.set(spec.file, png);
      mkdirSync(join(ROOT, 'public', 'icons'), { recursive: true });
      writeFileSync(join(ROOT, spec.file), png);
      written.push(`${spec.file}  ${spec.size}x${spec.size}  ${png.length} bytes`);
    }

    // The favicon. Next 16 serves `app/favicon.ico` for `/favicon.ico`, and a
    // multi-resolution icon is what stops a browser scaling one bitmap into a
    // blurry tab icon on a HiDPI display.
    const ico = buildIco([
      { size: 16, png: rendered.get('public/icons/favicon-16.png') },
      { size: 32, png: rendered.get('public/icons/favicon-32.png') },
      { size: 48, png: rendered.get('public/icons/favicon-48.png') },
    ]);
    writeFileSync(join(ROOT, 'src', 'app', 'favicon.ico'), ico);
    written.push(`src/app/favicon.ico  16/32/48  ${ico.length} bytes`);

    if (preview) {
      // A visual check sheet: the mark large, plus the 192 icon for scale.
      const page = await browser.newPage({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 1 });
      await page.setContent(
        `<!doctype html><html><head><style>
          body { margin: 0; background: ${BRAND_BG}; display: flex; align-items: center; gap: 40px; padding: 40px; font-family: sans-serif; }
          svg { height: 300px; }
        </style></head><body>${MARK_SVG}
        <img src="data:image/png;base64,${(await render(browser, ICONS[0])).toString('base64')}" style="height:192px;width:192px;border-radius:12px" />
        </body></html>`,
        { waitUntil: 'load' }
      );
      writeFileSync('/tmp/mettivo-preview.png', await page.screenshot({ type: 'png' }));
      await page.close();
      written.push('/tmp/mettivo-preview.png  (preview)');
    }
  } finally {
    await browser.close();
  }

  console.log(written.join('\n'));
}

main().catch((err) => {
  console.error('icon generation failed:', err);
  process.exit(1);
});
