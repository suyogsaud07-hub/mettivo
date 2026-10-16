import { type Page } from '@playwright/test';

/**
 * §3.3 — shared fixtures for the browser journeys.
 *
 * Every Supabase call the browser would make is intercepted here. Combined with
 * the `e2e.invalid` URL the dev server is started with, this means an
 * un-intercepted request fails harmlessly instead of reaching — or writing to —
 * the production project.
 */

export const E2E_USER_ID = '11111111-1111-1111-1111-111111111111';
export const E2E_OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
export const E2E_EMAIL = 'e2e@mettivo.test';

export const e2eUser = {
  id: E2E_USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: E2E_EMAIL,
  email_confirmed_at: '2026-01-01T00:00:00Z',
  phone: '',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const session = {
  access_token: 'e2e-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'e2e-refresh-token',
  user: e2eUser,
};

/**
 * Seeds a signed-in session before any script runs.
 *
 * Cookies, NOT localStorage: the browser client is `createBrowserClient` from
 * `@supabase/ssr`, which stores the session in cookies so that it shares one
 * session with `/auth/callback` and the refresh middleware. Seeding
 * localStorage would leave every guard seeing "no user" — the exact failure
 * this suite exists to catch.
 *
 * The value format is the library's own: `base64-` + base64url(JSON).
 * supabase-js derives the key from the project ref, which for
 * `https://e2e.invalid.supabase.co` is `e2e`.
 */
export async function signedIn(page: Page): Promise<void> {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;

  await page.context().addCookies([
    {
      // Playwright wants either `url` or `domain` + `path` — not both.
      name: 'sb-e2e-auth-token',
      value,
      url: 'http://localhost:3100',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);
}

export interface RecordedWrite {
  table: string;
  method: string;
  body: unknown;
}

export interface StubOptions {
  /** `null` makes the auth endpoint report "no session". */
  user?: Record<string, unknown> | null;
  /**
   * Table name -> response.
   *
   * An ARRAY is returned as a list (narrowed to a single object when the client
   * asks for one via `.single()`/`.maybeSingle()`); a plain OBJECT is returned
   * verbatim, which is the reliable way to stub a single-row read.
   */
  /**
   * Table name -> response.
   *
   * An ARRAY is returned as a list (narrowed to a single object when the client
   * asks for one via `.single()`/`.maybeSingle()`); a plain OBJECT is returned
   * verbatim, which is the reliable way to stub a single-row read. A FUNCTION
   * receives the query URL, which is how one table can serve two different
   * shapes — a single-row gatekeeper read and a list read with names.
   */
  tables?: Record<
    string,
    unknown[] | Record<string, unknown> | ((url: URL) => unknown)
  >;
  /** RPC name -> payload, or a function of the request URL. */
  rpc?: Record<string, unknown | ((url: URL) => unknown)>;
}

export interface SupabaseStub {
  /** Every non-GET request the app made, in order. */
  writes: RecordedWrite[];
}

/** Intercepts the Supabase Auth and REST endpoints with deterministic data. */
export async function stubSupabase(page: Page, options: StubOptions = {}): Promise<SupabaseStub> {
  const writes: RecordedWrite[] = [];

  await page.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/auth/v1/authorize')) {
      // Where `signInWithOAuth` navigates. Fulfilled locally so the journey can
      // assert it left the app without contacting a provider.
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>provider</title>ok',
      });
    }

    if (url.includes('/auth/v1/user')) {
      if (options.user === null) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Auth session missing!' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...e2eUser, ...(options.user ?? {}) }),
      });
    }

    if (url.includes('/auth/v1/token')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(session),
      });
    }

    if (url.includes('/auth/v1/logout')) {
      return route.fulfill({ status: 204, body: '' });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/rest/v1/', '');
    const method = request.method();

    // `supabase.rpc()` is a POST to /rest/v1/rpc/<fn>, so it must be resolved
    // BEFORE the write branch below or stubbed RPCs would return an empty array.
    if (path.startsWith('rpc/')) {
      const name = path.slice(4);
      const handler = options.rpc?.[name];

      // RPC calls are recorded alongside table writes: they are how the app
      // mutates state, so a journey that "did something" must be able to prove
      // which function it called.
      let body: unknown = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
      writes.push({ table: path, method, body });

      if (handler === undefined) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'PGRST202', message: `no stub for rpc ${name}` }),
        });
      }
      const value = typeof handler === 'function' ? handler(url) : handler;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(value),
      });
    }

    if (method !== 'GET') {
      let body: unknown = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
      writes.push({ table: path, method, body });
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }

    const handler = options.tables?.[path];
    const resolved: unknown = typeof handler === 'function' ? handler(url) : (handler ?? []);

    // A plain object means "return exactly this row", which makes a stubbed
    // `.single()` independent of the Accept header supabase-js chooses.
    if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(resolved),
      });
    }

    const rows: unknown[] = Array.isArray(resolved) ? resolved : [];

    // `.single()` / `.maybeSingle()` ask PostgREST for an object, not an array.
    const accept = request.headers()['accept'] ?? '';
    if (accept.includes('vnd.pgrst.object')) {
      if (rows.length !== 1) {
        return route.fulfill({
          status: 406,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'PGRST116',
            message: 'JSON object requested, multiple (or no) rows returned',
            details: `Results contain ${rows.length} rows`,
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rows[0]),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rows),
    });
  });

  return { writes };
}

/** A discovery row shaped exactly like `discover_profiles()` returns. */
export function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: E2E_OTHER_USER_ID,
    display_name: 'Bo',
    age: 30,
    gender: 'Man',
    city: 'Pokhara',
    country: 'Nepal',
    avatar_url: null,
    photos: [],
    bio: 'Hello',
    intention: 'dating',
    looking_for: ['Women'],
    hobbies: [],
    pets: [],
    personality: [],
    interests: ['coffee'],
    prompts: {},
    is_online: true,
    is_verified: false,
    ...overrides,
  };
}

/**
 * Intercepts the M24 verification routes with deterministic passing verdicts.
 *
 * These are same-origin Next route handlers, not Supabase calls, so
 * `stubSupabase` does not cover them; against the real handler the dev server has
 * no AI key and the fail-closed classifier would correctly refuse. Stubbing the
 * route is what lets the journey exercise the UI flow without a camera, an AI
 * provider, or a real face.
 */
export async function stubVerification(page: Page): Promise<void> {
  await page.route('**/api/verification/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.endsWith('/challenge')) return json({ phrase: 'amber orchid 42' });
    if (path.endsWith('/face')) {
      return json({ passed: true, complete: false, reason: null, apparentGender: 'woman' });
    }
    if (path.endsWith('/photo')) {
      return json({ passed: true, complete: false, gallery: 0, avatar: 0, reasons: [] });
    }
    if (path.endsWith('/voice')) {
      return json({ passed: true, complete: true, reason: null, transcript: 'amber orchid 42' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

/**
 * Provides a deterministic camera, microphone, pitch and recorder in the page.
 *
 * `FaceVoiceVerificationModal` needs `getUserMedia`, an analyser that yields a
 * pitch, and a `MediaRecorder`. Chromium in CI has no real devices, so each is
 * replaced with a stand-in that behaves like the real thing for the code under
 * test: the camera is a canvas `captureStream` (a genuine `MediaStream`, so
 * assigning it to `srcObject` is valid), the analyser returns a steady 200 Hz
 * tone, and the recorder emits one chunk of audio on stop.
 */
export async function stubBrowserMedia(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    canvas.getContext('2d')?.fillRect(0, 0, canvas.width, canvas.height);
    const cameraStream = canvas.captureStream(5);

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => cameraStream },
    });

    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get: () => 640,
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      get: () => 480,
    });

    class FakeAnalyser {
      fftSize = 2048;
      getFloatTimeDomainData(buffer: Float32Array): void {
        for (let i = 0; i < buffer.length; i += 1) {
          buffer[i] = Math.sin((2 * Math.PI * 200 * i) / 48000);
        }
      }
    }

    class FakeAudioContext {
      sampleRate = 48000;
      createAnalyser(): FakeAnalyser {
        return new FakeAnalyser();
      }
      createMediaStreamSource(): { connect: () => void } {
        return { connect: () => undefined };
      }
      close(): Promise<void> {
        return Promise.resolve();
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });

    class FakeMediaRecorder {
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start(): void {
        this.state = 'recording';
        setTimeout(() => {
          this.ondataavailable?.({ data: new Blob([new Uint8Array([0, 1, 2, 3])]) });
        }, 20);
      }
      stop(): void {
        this.state = 'inactive';
        this.onstop?.();
      }
    }
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    });
  });
}
