import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/observability/route';

/**
 * R-08 — the client error sink.
 *
 * The property that matters is that a report from an untrusted browser cannot
 * put personal data into the log pipeline. The sender redacts, but the sender is
 * the browser, so the route redacts again.
 */

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('https://mettivo.test/api/observability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );
}

let logged: string[] = [];
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logged = [];
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('R-08 — /api/observability', () => {
  it('accepts a report and answers 204', async () => {
    const response = await post({
      event: 'app.route_error',
      message: 'render failed',
      route: '/discover',
      context: { errorName: 'Error' },
    });

    expect(response.status).toBe(204);
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0])).toMatchObject({
      level: 'error',
      event: 'app.route_error',
      message: 'render failed',
    });
  });

  it('redacts personal data the client failed to strip', async () => {
    // Simulating a browser that sent raw values in the context.
    await post({
      event: 'client.exception',
      context: {
        email: 'sujata@example.com',
        phone: '+9779800000000',
        birth_date: '1998-05-04',
        bio: 'I live in Kathmandu',
      },
    });

    const line = logged.join('\n');
    expect(line).not.toContain('sujata@example.com');
    expect(line).not.toContain('+9779800000000');
    expect(line).not.toContain('1998-05-04');
    expect(line).not.toContain('I live in Kathmandu');
    expect(line).toContain('[redacted]');
  });

  it('truncates an oversized event name and message', async () => {
    await post({ event: 'e'.repeat(500), message: 'm'.repeat(2_000) });

    const record = JSON.parse(logged[0]) as { event: string; message: string };
    expect(record.event.length).toBeLessThanOrEqual(80);
    expect(record.message.length).toBeLessThanOrEqual(300);
  });

  it('rejects malformed JSON', async () => {
    expect((await post('not json')).status).toBe(400);
  });

  it('rejects a non-object body', async () => {
    expect((await post('"a string"')).status).toBe(400);
    expect((await post('[]')).status).toBe(400);
  });

  it('rejects an oversized declared payload before parsing it', async () => {
    const response = await post({ event: 'x' }, { 'content-length': '999999' });
    expect(response.status).toBe(413);
  });

  it('still logs when the event name is missing, so nothing is silently dropped', async () => {
    const response = await post({ message: 'no event' });
    expect(response.status).toBe(204);
    expect(JSON.parse(logged[0]).event).toBe('client.unknown');
  });
});
