import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateWireBassLevel,
  resolveFrequencyBinRange,
  smoothAttackRelease,
  smoothModeMix,
} from '../app/wireframe-audio.mjs';

test('maps 20–180Hz to actual FFT-bin centres without including out-of-band bins', () => {
  const range44100 = resolveFrequencyBinRange({
    sampleRate: 44100,
    fftSize: 1024,
    frequencyBinCount: 512,
  });
  assert.equal(range44100.start, 1);
  assert.equal(range44100.end, 4);
  assert.ok(range44100.start * range44100.hzPerBin >= 20);
  assert.ok(range44100.end * range44100.hzPerBin <= 180);

  const range48000 = resolveFrequencyBinRange({
    sampleRate: 48000,
    fftSize: 1024,
    frequencyBinCount: 512,
  });
  assert.equal(range48000.start, 1);
  assert.equal(range48000.end, 3);
});

test('returns a safe empty range for unusable analyser metadata', () => {
  assert.deepEqual(resolveFrequencyBinRange(), {
    start: 0,
    end: -1,
    count: 0,
    hzPerBin: 0,
  });
});

test('calculates a bounded RMS bass level and removes the idle noise floor', () => {
  const range = { start: 1, end: 4, count: 4 };
  assert.equal(calculateWireBassLevel(new Uint8Array([0, 4, 5, 4, 5]), range), 0);
  assert.equal(calculateWireBassLevel(new Uint8Array([0, 255, 255, 255, 255]), range), 1);
  const medium = calculateWireBassLevel(new Uint8Array([0, 96, 128, 96, 128]), range);
  assert.ok(medium > 0 && medium < 1);
});

test('attack is faster than release and both envelopes stay frame-rate independent', () => {
  const attack = smoothAttackRelease(0, 1, 1 / 60);
  const release = smoothAttackRelease(1, 0, 1 / 60);
  assert.ok(attack > 1 - release);
  assert.ok(attack > 0 && attack < 1);
  assert.ok(release > 0 && release < 1);

  let sixtyHz = 0;
  let oneTwentyHz = 0;
  for (let index = 0; index < 60; index += 1) sixtyHz = smoothAttackRelease(sixtyHz, 1, 1 / 60);
  for (let index = 0; index < 120; index += 1) oneTwentyHz = smoothAttackRelease(oneTwentyHz, 1, 1 / 120);
  assert.ok(Math.abs(sixtyHz - oneTwentyHz) < 1e-9);
});

test('mode mix is smooth, reversible, and snaps only near its target', () => {
  const entering = smoothModeMix(0, true, 1 / 60);
  const reversing = smoothModeMix(entering, false, 1 / 60);
  assert.ok(entering > 0 && entering < 1);
  assert.ok(reversing >= 0 && reversing < entering);
  assert.equal(smoothModeMix(0.9999, true, 1 / 60), 1);
});
