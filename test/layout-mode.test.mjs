import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LAYOUT_MODE,
  LAYOUT_MODES,
  LAYOUT_MODE_CLASSES,
  LAYOUT_MODE_STORAGE_KEY,
  applyLayoutMode,
  createLayoutModeController,
  getLayoutModeA11y,
  nextLayoutMode,
  parseLayoutMode,
  readStoredLayoutMode,
  setLayoutModeTransitioning,
  writeStoredLayoutMode,
} from '../app/layout-mode.mjs';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  let writes = 0;

  return {
    get writes() {
      return writes;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      writes += 1;
      values.set(key, String(value));
    },
  };
}

function createElement() {
  const attributes = new Map();
  const classes = new Set();
  let mutations = 0;

  return {
    get mutations() {
      return mutations;
    },
    get classNames() {
      return [...classes].sort();
    },
    classList: {
      contains(className) {
        return classes.has(className);
      },
      toggle(className, enabled) {
        mutations += 1;
        if (enabled) classes.add(className);
        else classes.delete(className);
        return enabled;
      },
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    setAttribute(name, value) {
      mutations += 1;
      attributes.set(name, String(value));
    },
  };
}

test('parses supported modes and rejects damaged values safely', () => {
  assert.equal(parseLayoutMode(' immersive '), LAYOUT_MODES.IMMERSIVE);
  assert.equal(parseLayoutMode('BROWSE'), LAYOUT_MODES.BROWSE);
  assert.equal(parseLayoutMode('corrupted'), DEFAULT_LAYOUT_MODE);
  assert.equal(
    parseLayoutMode({ mode: 'immersive' }, LAYOUT_MODES.IMMERSIVE),
    LAYOUT_MODES.IMMERSIVE,
  );
  assert.equal(parseLayoutMode('bad', 'also-bad'), DEFAULT_LAYOUT_MODE);
});

test('loads a valid stored mode and falls back for missing or damaged storage', () => {
  const valid = createStorage({
    [LAYOUT_MODE_STORAGE_KEY]: LAYOUT_MODES.IMMERSIVE,
  });
  const damaged = createStorage({
    [LAYOUT_MODE_STORAGE_KEY]: '{"mode":"immersive"',
  });

  assert.equal(readStoredLayoutMode(valid), LAYOUT_MODES.IMMERSIVE);
  assert.equal(readStoredLayoutMode(damaged), DEFAULT_LAYOUT_MODE);
  assert.equal(readStoredLayoutMode(undefined), DEFAULT_LAYOUT_MODE);
  assert.equal(
    readStoredLayoutMode(null, { fallback: LAYOUT_MODES.IMMERSIVE }),
    LAYOUT_MODES.IMMERSIVE,
  );
  assert.equal(
    readStoredLayoutMode({
      getItem() {
        throw new Error('storage denied');
      },
    }),
    DEFAULT_LAYOUT_MODE,
  );
});

test('persists safely and skips an idempotent storage write', () => {
  const storage = createStorage();
  const first = writeStoredLayoutMode(storage, LAYOUT_MODES.IMMERSIVE);
  const second = writeStoredLayoutMode(storage, LAYOUT_MODES.IMMERSIVE);

  assert.deepEqual(first, {
    mode: LAYOUT_MODES.IMMERSIVE,
    persisted: true,
    changed: true,
  });
  assert.deepEqual(second, {
    mode: LAYOUT_MODES.IMMERSIVE,
    persisted: true,
    changed: false,
  });
  assert.equal(storage.writes, 1);
});

test('writing without usable storage remains a harmless no-op', () => {
  assert.deepEqual(writeStoredLayoutMode(undefined, 'immersive'), {
    mode: LAYOUT_MODES.IMMERSIVE,
    persisted: false,
    changed: false,
  });

  assert.deepEqual(
    writeStoredLayoutMode({
      setItem() {
        throw new Error('quota exceeded');
      },
    }, LAYOUT_MODES.BROWSE),
    {
      mode: LAYOUT_MODES.BROWSE,
      persisted: false,
      changed: false,
    },
  );
});

test('switches browse and immersive modes in both directions', () => {
  assert.equal(nextLayoutMode(LAYOUT_MODES.BROWSE), LAYOUT_MODES.IMMERSIVE);
  assert.equal(nextLayoutMode(LAYOUT_MODES.IMMERSIVE), LAYOUT_MODES.BROWSE);
  assert.equal(nextLayoutMode('damaged'), LAYOUT_MODES.IMMERSIVE);
});

test('exposes action-oriented accessible toggle state', () => {
  assert.deepEqual(getLayoutModeA11y(LAYOUT_MODES.BROWSE), {
    mode: LAYOUT_MODES.BROWSE,
    targetMode: LAYOUT_MODES.IMMERSIVE,
    pressed: false,
    ariaPressed: 'false',
    ariaLabel: '切换到沉浸模式',
    title: '切换到沉浸模式',
  });

  assert.deepEqual(getLayoutModeA11y(LAYOUT_MODES.IMMERSIVE), {
    mode: LAYOUT_MODES.IMMERSIVE,
    targetMode: LAYOUT_MODES.BROWSE,
    pressed: true,
    ariaPressed: 'true',
    ariaLabel: '切换到浏览模式',
    title: '切换到浏览模式',
  });
});

test('applies root and button state idempotently', () => {
  const root = createElement();
  const button = createElement();

  const first = applyLayoutMode({ root, button }, LAYOUT_MODES.IMMERSIVE);
  const mutationCount = root.mutations + button.mutations;
  const second = applyLayoutMode({ root, button }, LAYOUT_MODES.IMMERSIVE);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(root.mutations + button.mutations, mutationCount);
  assert.equal(root.getAttribute('data-layout-mode'), LAYOUT_MODES.IMMERSIVE);
  assert.deepEqual(root.classNames, [LAYOUT_MODE_CLASSES.immersive]);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.getAttribute('aria-label'), '切换到浏览模式');
  assert.equal(button.getAttribute('data-layout-target'), LAYOUT_MODES.BROWSE);
});

test('transition class helper is explicit and idempotent', () => {
  const root = createElement();

  assert.equal(setLayoutModeTransitioning(root, true), true);
  assert.equal(setLayoutModeTransitioning(root, true), false);
  assert.deepEqual(root.classNames, [LAYOUT_MODE_CLASSES.TRANSITIONING]);
  assert.equal(setLayoutModeTransitioning(root, false), true);
  assert.deepEqual(root.classNames, []);
});

test('controller initializes, toggles, persists, and supports no-storage use', () => {
  const storage = createStorage({
    customLayoutKey: LAYOUT_MODES.IMMERSIVE,
  });
  const root = createElement();
  const button = createElement();
  const controller = createLayoutModeController({
    storage,
    root,
    button,
    storageKey: 'customLayoutKey',
  });

  assert.equal(controller.init().mode, LAYOUT_MODES.IMMERSIVE);
  assert.equal(controller.mode, LAYOUT_MODES.IMMERSIVE);

  const toggled = controller.toggle();
  assert.equal(toggled.mode, LAYOUT_MODES.BROWSE);
  assert.equal(toggled.storage.changed, true);
  assert.equal(controller.mode, LAYOUT_MODES.BROWSE);
  assert.equal(button.getAttribute('aria-pressed'), 'false');

  const noStorageController = createLayoutModeController({
    initialMode: LAYOUT_MODES.IMMERSIVE,
  });
  assert.equal(noStorageController.init().mode, LAYOUT_MODES.IMMERSIVE);
  assert.equal(noStorageController.toggle().mode, LAYOUT_MODES.BROWSE);
});
