/**
 * Pure, dependency-injected layout-mode helpers for Nebula.
 *
 * The module deliberately owns no animation timers. CSS motion tokens and the
 * page's transition lifecycle decide how long `.layout-is-transitioning`
 * remains active.
 */

export const LAYOUT_MODES = Object.freeze({
  BROWSE: 'browse',
  IMMERSIVE: 'immersive',
});

export const DEFAULT_LAYOUT_MODE = LAYOUT_MODES.BROWSE;
export const LAYOUT_MODE_STORAGE_KEY = 'nebula.layout-mode';

export const LAYOUT_MODE_CLASSES = Object.freeze({
  [LAYOUT_MODES.BROWSE]: 'layout-mode-browse',
  [LAYOUT_MODES.IMMERSIVE]: 'layout-mode-immersive',
  TRANSITIONING: 'layout-is-transitioning',
});

const VALID_LAYOUT_MODES = new Set(Object.values(LAYOUT_MODES));

/**
 * Parse untrusted input into a supported layout mode.
 *
 * Persisted values may come from older or damaged storage. String values are
 * trimmed and compared case-insensitively; everything else uses a valid
 * fallback, then the browse default.
 */
export function parseLayoutMode(value, fallback = DEFAULT_LAYOUT_MODE) {
  const normalizedFallback = typeof fallback === 'string'
    && VALID_LAYOUT_MODES.has(fallback.trim().toLowerCase())
    ? fallback.trim().toLowerCase()
    : DEFAULT_LAYOUT_MODE;

  if (typeof value !== 'string') return normalizedFallback;

  const normalized = value.trim().toLowerCase();
  return VALID_LAYOUT_MODES.has(normalized) ? normalized : normalizedFallback;
}

export function nextLayoutMode(mode) {
  return parseLayoutMode(mode) === LAYOUT_MODES.IMMERSIVE
    ? LAYOUT_MODES.BROWSE
    : LAYOUT_MODES.IMMERSIVE;
}

/**
 * Action-oriented button copy keeps the toggle understandable without relying
 * on its icon. `pressed` represents whether immersive mode is currently on.
 */
export function getLayoutModeA11y(mode) {
  const currentMode = parseLayoutMode(mode);
  const targetMode = nextLayoutMode(currentMode);
  const immersive = currentMode === LAYOUT_MODES.IMMERSIVE;
  const label = targetMode === LAYOUT_MODES.IMMERSIVE
    ? '切换到沉浸模式'
    : '切换到浏览模式';

  return Object.freeze({
    mode: currentMode,
    targetMode,
    pressed: immersive,
    ariaPressed: String(immersive),
    ariaLabel: label,
    title: label,
  });
}

function hasStorageMethod(storage, method) {
  return storage != null && typeof storage[method] === 'function';
}

/**
 * Safely read layout state from an injected Storage-compatible object.
 */
export function readStoredLayoutMode(storage, {
  key = LAYOUT_MODE_STORAGE_KEY,
  fallback = DEFAULT_LAYOUT_MODE,
} = {}) {
  const safeFallback = parseLayoutMode(fallback);
  if (!hasStorageMethod(storage, 'getItem')) return safeFallback;

  try {
    return parseLayoutMode(storage.getItem(key), safeFallback);
  } catch {
    return safeFallback;
  }
}

/**
 * Safely persist a layout mode. The existing value is checked when possible so
 * setting the same mode repeatedly does not create redundant storage writes.
 */
export function writeStoredLayoutMode(storage, mode, {
  key = LAYOUT_MODE_STORAGE_KEY,
} = {}) {
  const normalizedMode = parseLayoutMode(mode);
  if (!hasStorageMethod(storage, 'setItem')) {
    return Object.freeze({
      mode: normalizedMode,
      persisted: false,
      changed: false,
    });
  }

  try {
    if (
      hasStorageMethod(storage, 'getItem')
      && storage.getItem(key) === normalizedMode
    ) {
      return Object.freeze({
        mode: normalizedMode,
        persisted: true,
        changed: false,
      });
    }

    storage.setItem(key, normalizedMode);
    return Object.freeze({
      mode: normalizedMode,
      persisted: true,
      changed: true,
    });
  } catch {
    return Object.freeze({
      mode: normalizedMode,
      persisted: false,
      changed: false,
    });
  }
}

function setAttributeIfChanged(element, name, value) {
  if (!element || typeof element.setAttribute !== 'function') return false;

  const nextValue = String(value);
  if (
    typeof element.getAttribute === 'function'
    && element.getAttribute(name) === nextValue
  ) {
    return false;
  }

  element.setAttribute(name, nextValue);
  return true;
}

function toggleClassIfChanged(element, className, enabled) {
  const classList = element?.classList;
  if (!classList || typeof classList.toggle !== 'function') return false;

  if (
    typeof classList.contains === 'function'
    && classList.contains(className) === enabled
  ) {
    return false;
  }

  classList.toggle(className, enabled);
  return true;
}

/**
 * Apply the stable layout state to the page root and optional toggle button.
 *
 * The root receives `data-layout-mode` plus mutually exclusive mode classes.
 * The button receives action-oriented accessible copy and current/target data
 * attributes. Existing visible button content is left untouched.
 */
export function applyLayoutMode({ root, button } = {}, mode = DEFAULT_LAYOUT_MODE) {
  const presentation = getLayoutModeA11y(mode);
  let changed = false;

  changed = setAttributeIfChanged(root, 'data-layout-mode', presentation.mode)
    || changed;
  changed = toggleClassIfChanged(
    root,
    LAYOUT_MODE_CLASSES[LAYOUT_MODES.BROWSE],
    presentation.mode === LAYOUT_MODES.BROWSE,
  ) || changed;
  changed = toggleClassIfChanged(
    root,
    LAYOUT_MODE_CLASSES[LAYOUT_MODES.IMMERSIVE],
    presentation.mode === LAYOUT_MODES.IMMERSIVE,
  ) || changed;

  changed = setAttributeIfChanged(
    button,
    'aria-pressed',
    presentation.ariaPressed,
  ) || changed;
  changed = setAttributeIfChanged(
    button,
    'aria-label',
    presentation.ariaLabel,
  ) || changed;
  changed = setAttributeIfChanged(button, 'title', presentation.title)
    || changed;
  changed = setAttributeIfChanged(
    button,
    'data-layout-mode',
    presentation.mode,
  ) || changed;
  changed = setAttributeIfChanged(
    button,
    'data-layout-target',
    presentation.targetMode,
  ) || changed;

  return Object.freeze({
    ...presentation,
    changed,
  });
}

/**
 * Let the page mark the compositor promotion window without coupling this
 * module to any duration. Clear it from transitionend/cancel handling.
 */
export function setLayoutModeTransitioning(root, transitioning) {
  return toggleClassIfChanged(
    root,
    LAYOUT_MODE_CLASSES.TRANSITIONING,
    Boolean(transitioning),
  );
}

/**
 * Small state adapter for direct renderer integration.
 *
 * `storage`, `root`, and `button` are all optional and dependency-injected,
 * keeping the controller testable and safe in privacy-restricted contexts.
 */
export function createLayoutModeController({
  storage,
  root,
  button,
  storageKey = LAYOUT_MODE_STORAGE_KEY,
  initialMode = DEFAULT_LAYOUT_MODE,
} = {}) {
  let currentMode = parseLayoutMode(initialMode);

  const render = () => applyLayoutMode({ root, button }, currentMode);

  const set = (mode, { persist = true } = {}) => {
    currentMode = parseLayoutMode(mode, currentMode);
    const presentation = render();
    const storageResult = persist
      ? writeStoredLayoutMode(storage, currentMode, { key: storageKey })
      : Object.freeze({
        mode: currentMode,
        persisted: false,
        changed: false,
      });

    return Object.freeze({
      ...presentation,
      storage: storageResult,
    });
  };

  const init = () => {
    currentMode = readStoredLayoutMode(storage, {
      key: storageKey,
      fallback: currentMode,
    });
    return render();
  };

  const toggle = (options) => set(nextLayoutMode(currentMode), options);

  return Object.freeze({
    get mode() {
      return currentMode;
    },
    init,
    set,
    toggle,
    render,
  });
}
