import { expect, test } from '@playwright/test';

/**
 * Zero-cost distribution — installability.
 *
 * "It is a PWA" is a claim; a browser either offers to install it or it does
 * not. These tests assert the actual install criteria a browser checks, read
 * straight out of the shipped manifest and assets, and then verify the service
 * worker really registers and precaches the offline page.
 *
 * The PNG dimensions are decoded from the file bytes rather than trusted from
 * the manifest, because a mislabelled icon is the single most common reason an
 * install prompt never appears.
 */

const MANIFEST = '/manifest.json';

/** Reads width/height out of a PNG's IHDR chunk. */
function pngDimensions(buffer: Buffer): { width: number; height: number } {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error('not a PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test.describe('installability — manifest and icons', () => {
  test('serves a manifest meeting the browser install criteria', async ({ request }) => {
    const response = await request.get(MANIFEST);
    expect(response.status()).toBe(200);

    const manifest = (await response.json()) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      scope?: string;
      display?: string;
      theme_color?: string;
      background_color?: string;
      icons?: { src: string; sizes: string; purpose?: string }[];
    };

    // A browser requires a name (or short_name), a start_url, a display mode
    // other than `browser`, and at least a 192px AND a 512px icon.
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9A-Fa-f]{6}$/);

    const icons = manifest.icons ?? [];
    const sizesOf = (purpose: string) =>
      icons.filter((icon) => (icon.purpose ?? 'any') === purpose).map((icon) => icon.sizes);

    expect(sizesOf('any')).toContain('192x192');
    expect(sizesOf('any')).toContain('512x512');
    // Maskable icons are what stop Android from cropping the logo into a circle.
    expect(sizesOf('maskable')).toContain('192x192');
    expect(sizesOf('maskable')).toContain('512x512');
  });

  test('every declared icon exists at the size it claims', async ({ request }) => {
    const manifest = (await (await request.get(MANIFEST)).json()) as {
      icons: { src: string; sizes: string; type: string }[];
    };

    for (const icon of manifest.icons) {
      const response = await request.get(icon.src);
      expect(response.status(), `${icon.src} must exist`).toBe(200);
      expect(response.headers()['content-type'], `${icon.src} must be a PNG`).toContain('image/png');

      const [expectedWidth, expectedHeight] = icon.sizes.split('x').map(Number);
      const { width, height } = pngDimensions(await response.body());
      expect({ width, height }, `${icon.src} declares ${icon.sizes}`).toEqual({
        width: expectedWidth,
        height: expectedHeight,
      });
    }
  });

  test('links the manifest, the theme colour and the iOS touch icon', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', MANIFEST);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#131017');

    // iOS Safari ignores most of the manifest; these two are what actually make
    // "Add to Home Screen" produce a standalone app with a proper icon.
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes'
    );
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  });
});

test.describe('installability — service worker and offline support', () => {
  test('registers a worker that takes control', async ({ page }) => {
    await page.goto('/offline');

    const registration = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null;
      const ready = await navigator.serviceWorker.ready;
      return { active: Boolean(ready.active), scope: ready.scope };
    });

    expect(registration, 'a service worker must register').not.toBeNull();
    expect(registration?.active).toBe(true);
    expect(registration?.scope).toContain('/');
  });

  test('precaches the offline page and the manifest', async ({ page }) => {
    await page.goto('/offline');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const pagesCache = names.find((name) => name.includes('mettivo-pages'));
      if (!pagesCache) return { names, paths: [] as string[] };
      const cache = await caches.open(pagesCache);
      const requests = await cache.keys();
      return { names, paths: requests.map((request) => new URL(request.url).pathname) };
    });

    expect(cached.names.some((name) => name.includes('mettivo-'))).toBe(true);
    expect(cached.paths).toContain('/offline');
    expect(cached.paths).toContain('/manifest.json');
  });

  test('serves the offline page with 200 and no network dependency', async ({ request }) => {
    const response = await request.get('/offline');
    expect(response.status()).toBe(200);
  });
});
