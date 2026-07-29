import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PlaybackProgressController,
  clamp,
  createPlaybackProgressController,
  progressRatio,
  progressTransform,
} from '../app/playback-progress.mjs';

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ type, target: this });
    }
  }

  listenerCount() {
    return [...this.listeners.values()]
      .reduce((total, listeners) => total + listeners.size, 0);
  }
}

class FakeMedia extends FakeEventTarget {
  constructor(overrides = {}) {
    super();
    this.currentTime = 0;
    this.duration = 100;
    this.playbackRate = 1;
    this.paused = true;
    this.ended = false;
    this.seeking = false;
    Object.assign(this, overrides);
  }
}

class FakeVisibility extends FakeEventTarget {
  constructor() {
    super();
    this.hidden = false;
    this.visibilityState = 'visible';
  }

  setHidden(hidden) {
    this.hidden = hidden;
    this.visibilityState = hidden ? 'hidden' : 'visible';
    this.dispatch('visibilitychange');
  }
}

class FakeFrameClock {
  constructor() {
    this.time = 0;
    this.nextId = 1;
    this.callbacks = new Map();
    this.cancelled = [];
  }

  now = () => this.time;

  request = (callback) => {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    return id;
  };

  cancel = (id) => {
    this.cancelled.push(id);
    this.callbacks.delete(id);
  };

  step(milliseconds) {
    this.time += milliseconds;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback(this.time);
  }

  get pendingCount() {
    return this.callbacks.size;
  }
}

function setup(overrides = {}) {
  const media = overrides.media ?? new FakeMedia();
  const visibility = overrides.visibility ?? new FakeVisibility();
  const clock = overrides.clock ?? new FakeFrameClock();
  const writes = [];
  const style = {};
  Object.defineProperty(style, 'transform', {
    configurable: true,
    get: () => writes.at(-1),
    set: value => writes.push(value),
  });
  const target = { style };

  const controller = createPlaybackProgressController({
    media,
    visibility,
    target,
    now: clock.now,
    requestAnimationFrame: clock.request,
    cancelAnimationFrame: clock.cancel,
    reducedMotion: overrides.reducedMotion,
  });

  return { media, visibility, clock, writes, target, controller };
}

test('clamps values and derives safe progress ratios and transforms', () => {
  assert.equal(clamp(-2), 0);
  assert.equal(clamp(2), 1);
  assert.equal(clamp(4, 10, 0), 4);
  assert.equal(progressRatio(25, 100), 0.25);
  assert.equal(progressRatio(200, 100), 1);
  assert.equal(progressRatio(10, 0), 0);
  assert.equal(progressRatio(Number.NaN, 100), 0);
  assert.equal(progressTransform(1 / 3, 3), 'scaleX(0.333)');
});

test('interpolates playback progress on every animation frame from the injected clock', () => {
  const media = new FakeMedia({ currentTime: 20, duration: 100 });
  const { controller, clock, writes } = setup({ media });

  assert.equal(writes.at(-1), 'scaleX(0.2)');
  assert.equal(clock.pendingCount, 0);

  media.paused = false;
  media.dispatch('play');
  assert.equal(clock.pendingCount, 1);

  clock.step(500);
  assert.equal(writes.at(-1), 'scaleX(0.205)');
  assert.equal(clock.pendingCount, 1);

  clock.step(500);
  assert.equal(writes.at(-1), 'scaleX(0.21)');
  assert.equal(clock.pendingCount, 1);
  controller.destroy();
});

test('pause cancels the pending frame and snaps to authoritative media time', () => {
  const media = new FakeMedia({ currentTime: 10, duration: 100, paused: false });
  const { controller, clock, writes } = setup({ media });

  clock.step(1000);
  assert.equal(writes.at(-1), 'scaleX(0.11)');

  media.currentTime = 12.5;
  media.paused = true;
  media.dispatch('pause');
  assert.equal(clock.pendingCount, 0);
  assert.equal(writes.at(-1), 'scaleX(0.125)');

  clock.step(2000);
  assert.equal(writes.at(-1), 'scaleX(0.125)');
  controller.destroy();
});

test('seeking stops interpolation, updates immediately, and resumes after seeked', () => {
  const media = new FakeMedia({ currentTime: 5, duration: 100, paused: false });
  const { controller, clock, writes } = setup({ media });

  media.currentTime = 60;
  media.seeking = true;
  media.dispatch('seeking');
  assert.equal(clock.pendingCount, 0);
  assert.equal(writes.at(-1), 'scaleX(0.6)');

  clock.step(1000);
  assert.equal(writes.at(-1), 'scaleX(0.6)');

  media.seeking = false;
  media.dispatch('seeked');
  assert.equal(clock.pendingCount, 1);
  clock.step(500);
  assert.equal(writes.at(-1), 'scaleX(0.605)');
  controller.destroy();
});

test('duration zero is safe and durationchange re-enables animation', () => {
  const media = new FakeMedia({
    currentTime: 15,
    duration: 0,
    paused: false,
  });
  const { controller, clock, writes } = setup({ media });

  assert.equal(writes.at(-1), 'scaleX(0)');
  assert.equal(clock.pendingCount, 0);

  media.duration = 30;
  media.dispatch('durationchange');
  assert.equal(writes.at(-1), 'scaleX(0.5)');
  assert.equal(clock.pendingCount, 1);

  clock.step(300);
  assert.equal(writes.at(-1), 'scaleX(0.51)');
  controller.destroy();
});

test('hidden documents sync once, stop frames, and resume without counting hidden time', () => {
  const media = new FakeMedia({ currentTime: 20, duration: 100, paused: false });
  const visibility = new FakeVisibility();
  const { controller, clock, writes } = setup({ media, visibility });

  clock.step(1000);
  assert.equal(writes.at(-1), 'scaleX(0.21)');

  media.currentTime = 22;
  visibility.setHidden(true);
  assert.equal(clock.pendingCount, 0);
  assert.equal(writes.at(-1), 'scaleX(0.22)');

  clock.step(5000);
  assert.equal(writes.at(-1), 'scaleX(0.22)');

  visibility.setHidden(false);
  assert.equal(clock.pendingCount, 1);
  clock.step(1000);
  assert.equal(writes.at(-1), 'scaleX(0.23)');
  controller.destroy();
});

test('reduced motion uses media events instead of scheduling animation frames', () => {
  const media = new FakeMedia({ currentTime: 10, duration: 100, paused: false });
  const { controller, clock, writes } = setup({ media, reducedMotion: true });

  assert.equal(clock.pendingCount, 0);
  clock.step(1000);
  assert.equal(writes.at(-1), 'scaleX(0.1)');

  media.currentTime = 18;
  media.dispatch('timeupdate');
  assert.equal(writes.at(-1), 'scaleX(0.18)');
  assert.equal(clock.pendingCount, 0);

  controller.setReducedMotion(false);
  assert.equal(clock.pendingCount, 1);
  clock.step(500);
  assert.equal(writes.at(-1), 'scaleX(0.185)');
  controller.destroy();
});

test('destroy cancels frames, removes every listener, and ignores later media events', () => {
  const media = new FakeMedia({ currentTime: 10, duration: 100, paused: false });
  const visibility = new FakeVisibility();
  const { controller, clock, writes } = setup({ media, visibility });
  const writeCount = writes.length;

  assert.ok(controller instanceof PlaybackProgressController);
  assert.equal(clock.pendingCount, 1);
  assert.ok(media.listenerCount() > 0);
  assert.equal(visibility.listenerCount(), 1);

  controller.destroy();
  assert.equal(clock.pendingCount, 0);
  assert.equal(media.listenerCount(), 0);
  assert.equal(visibility.listenerCount(), 0);
  assert.equal(controller.snapshot().destroyed, true);

  media.currentTime = 90;
  media.dispatch('timeupdate');
  visibility.setHidden(true);
  clock.step(1000);
  assert.equal(writes.length, writeCount);
});
