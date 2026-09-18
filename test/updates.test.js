import test from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, newerVersion } from '../src/updates.js';

test('update check resolves an immutable installer without sending API credentials', async () => {
  const requests = [], sha = 'a'.repeat(40);
  const result = await checkForUpdate(options => {
    requests.push(options);
    queueMicrotask(() => options.onload({ status: 200, responseText: requests.length === 1 ? JSON.stringify([{ sha }]) : '// ==UserScript==\n// @version      1.6.0\n' }));
  }, '1.5.0');
  assert.equal(result.available, true);
  assert.ok(result.url.includes(`/${sha}/`));
  assert.ok(requests.every(request => request.anonymous && !request.headers.Authorization));
  assert.equal(newerVersion('1.10.0', '1.9.9'), true);
  assert.equal(newerVersion('1.5.0', '1.6.0'), false);
  assert.equal(newerVersion('invalid', '1.6.0'), false);
});

test('malformed commit metadata cannot produce an installer URL', async () => {
  await assert.rejects(checkForUpdate(options => queueMicrotask(() => options.onload({ status: 200, responseText: '[{"sha":"../../bad"}]' })), '1.5.0'), /确认/);
});
