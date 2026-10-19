import { describe, expect, it } from 'vitest';
import { POST } from './route';

describe('POST /api/verification/face', () => {
  it('returns the service body and status verbatim', async () => {
    const request = new Request('https://mettivo.test/api/verification/face', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selfieUrl: 'data:image/png;base64,aGk=', gender: 'Woman' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorised' });
  });
});
