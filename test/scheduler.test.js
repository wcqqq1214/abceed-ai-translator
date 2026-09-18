import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestScheduler } from '../src/scheduler.js';
const turn = () => new Promise(resolve => setImmediate(resolve));

test('interactive work has a reserved slot and priority over queued background work', async () => {
  const scheduler = new RequestScheduler(), started = [], releases = {};
  const task = name => () => new Promise(resolve => { started.push(name); releases[name] = resolve; });
  const bg1 = scheduler.run(task('bg1'));
  const bg2 = scheduler.run(task('bg2'));
  const word1 = scheduler.run(task('word1'), { priority: 1 });
  const word2 = scheduler.run(task('word2'), { priority: 1 });
  await turn(); assert.deepEqual(started, ['bg1', 'word1']);
  releases.word1('one'); await word1; await turn();
  assert.deepEqual(started, ['bg1', 'word1', 'word2']);
  releases.word2('two'); await word2;
  releases.bg1('background'); await bg1; await turn();
  assert.equal(started.at(-1), 'bg2');
  releases.bg2('done'); await bg2; await turn();
  assert.equal(scheduler.active, 0);
});

test('canceled queued work is never sent and a rejected request does not block the queue', async () => {
  const scheduler = new RequestScheduler(); let release, called = false;
  const first = scheduler.run(() => new Promise(resolve => release = resolve));
  const controller = new AbortController();
  const queued = scheduler.run(() => { called = true; }, { signal: controller.signal });
  controller.abort(); await assert.rejects(queued, /暂停/);
  await turn(); release(); await first;
  await assert.rejects(scheduler.run(() => { throw new Error('failure'); }), /failure/);
  assert.equal(await scheduler.run(() => 'next'), 'next');
  assert.equal(called, false);
});
