import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPerformanceDebugEnabled,
  summarizeFrameSamples,
} from '../app/frame-budget.mjs';

test('summarizes a stable 120Hz stream', () => {
  const intervals = Array.from({ length: 240 }, () => 1000 / 120);
  const cpu = Array.from({ length: 240 }, () => 3.2);
  const summary = summarizeFrameSamples(intervals, cpu);

  assert.equal(summary.deliveredFps, 120);
  assert.equal(summary.estimatedRefreshHz, 120);
  assert.equal(summary.p95FrameMs, 8.33);
  assert.equal(summary.p99MainThreadMs, 3.2);
  assert.equal(summary.missedRefreshRatio, 0);
});

test('summarizes the display ceiling rather than inventing 120fps', () => {
  const intervals = Array.from({ length: 120 }, () => 1000 / 60);
  const summary = summarizeFrameSamples(intervals);

  assert.equal(summary.deliveredFps, 60);
  assert.equal(summary.estimatedRefreshHz, 60);
});

test('counts missed refresh periods', () => {
  const interval = 1000 / 120;
  const summary = summarizeFrameSamples([
    interval,
    interval,
    interval * 2,
    interval,
  ]);

  assert.equal(summary.missedRefreshRatio, 0.2);
});

test('returns an empty snapshot for no valid samples', () => {
  assert.deepEqual(summarizeFrameSamples([0, Number.NaN, -1]), {
    deliveredFps: 0,
    estimatedRefreshHz: 0,
    averageFrameMs: 0,
    p95FrameMs: 0,
    p99MainThreadMs: 0,
    missedRefreshRatio: 0,
    sampleCount: 0,
  });
});

test('enables debug mode through query or persisted preference', () => {
  const storageOn = { getItem: () => '1' };
  const storageOff = { getItem: () => null };

  assert.equal(isPerformanceDebugEnabled({ search: '?perf=1' }, storageOff), true);
  assert.equal(isPerformanceDebugEnabled({ search: '' }, storageOn), true);
  assert.equal(isPerformanceDebugEnabled({ search: '' }, storageOff), false);
});
