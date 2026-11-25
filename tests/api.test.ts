import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server.ts';

describe('Express API routes & security headers', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    const app = createApp({ serveFrontend: false });
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('serves GET /health with 200 and security headers', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');

    const body = (await res.json()) as { status: string };
    assert.deepEqual(body, { status: 'healthy' });
  });

  it('reports signed_in: false on GET /auth/session without bearer token', async () => {
    const res = await fetch(`${baseUrl}/auth/session`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { required: boolean; signed_in: boolean; providers: string[] };
    assert.equal(body.required, true);
    assert.equal(body.signed_in, false);
    assert.deepEqual(body.providers, ['google', 'github']);
  });

  it('enforces authentication on protected workspace routes', async () => {
    for (const endpoint of ['/projects', '/tasks', '/evaluation/leaderboard']) {
      const res = await fetch(`${baseUrl}${endpoint}`);
      assert.equal(res.status, 401, `Expected 401 for unauthenticated GET ${endpoint}`);
    }
  });
});
