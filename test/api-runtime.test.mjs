import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  DEFAULT_API_PORT,
  resolveLoopbackApiBase,
} from '../app/api-endpoint.mjs';

const require = createRequire(import.meta.url);
const {
  LOOPBACK_HOST,
  buildRendererQuery,
  isValidPort,
  reserveLoopbackPort,
} = require('../api-runtime.js');

test('reserves a valid ephemeral loopback port for each app process', async () => {
  const port = await reserveLoopbackPort();
  assert.equal(LOOPBACK_HOST, '127.0.0.1');
  assert.equal(isValidPort(port), true);
});

test('passes the selected API port and optional performance flag to the renderer', () => {
  assert.deepEqual(buildRendererQuery(43123), { apiPort: '43123' });
  assert.deepEqual(buildRendererQuery(43123, { performanceDebug: true }), {
    apiPort: '43123',
    perf: '1',
  });
  assert.throws(() => buildRendererQuery(0), RangeError);
});

test('renderer accepts only valid loopback port query values', () => {
  assert.equal(resolveLoopbackApiBase('?apiPort=43123'), 'http://127.0.0.1:43123');
  assert.equal(
    resolveLoopbackApiBase('?apiPort=0'),
    `http://127.0.0.1:${DEFAULT_API_PORT}`,
  );
  assert.equal(
    resolveLoopbackApiBase('?apiPort=attacker.example'),
    `http://127.0.0.1:${DEFAULT_API_PORT}`,
  );
});
