/**
 * Immutable queue mutations for Nebula.
 *
 * Queue entries remain ordinary song objects so the renderer can consume the
 * returned array directly. A newly inserted entry is shallow-cloned and tagged
 * with a non-enumerable-in-JSON Symbol token. That token identifies the exact
 * occurrence during undo, even when the queue contains duplicate song IDs,
 * duplicate object references, or has been reordered since the insertion.
 */

export const QUEUE_ACTION_TYPES = Object.freeze({
  ADD_TO_END: 'add-to-end',
  PLAY_NEXT: 'play-next',
});

export const QUEUE_UNDO_REASONS = Object.freeze({
  UNDONE: 'undone',
  INVALID_ACTION: 'invalid-action',
  NOT_FOUND: 'not-found',
  AMBIGUOUS: 'ambiguous',
  ENTRY_IS_CURRENT: 'entry-is-current',
});

export const QUEUE_ACTION_VERSION = 1;

/**
 * Deliberately a global symbol: entries still remain identifiable if the
 * module is loaded through more than one bundle boundary in the same renderer.
 * Symbol keys are ignored by JSON persistence, so runtime-only undo metadata
 * does not leak into the saved resume queue.
 */
export const QUEUE_ENTRY_TOKEN = Symbol.for('nebula.queue-entry-token');

const ACTION_KIND = 'nebula.queue-action';
const VALID_ACTION_TYPES = new Set(Object.values(QUEUE_ACTION_TYPES));

function defaultTokenFactory() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `queue:${globalThis.crypto.randomUUID()}`;
  }

  // Electron supports randomUUID, but keep a browser fallback for restricted
  // contexts. Callers can inject a deterministic factory in tests.
  const random = Math.random().toString(36).slice(2);
  return `queue:${Date.now().toString(36)}:${random}`;
}

function validateState(state) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('Queue state must be an object');
  }

  if (!Array.isArray(state.queue)) {
    throw new TypeError('Queue state must contain a queue array');
  }

  const currentIndex = state.currentIndex ?? -1;
  if (!Number.isInteger(currentIndex)) {
    throw new TypeError('currentIndex must be an integer');
  }
  if (currentIndex < -1 || currentIndex >= state.queue.length) {
    throw new RangeError('currentIndex is outside the queue');
  }

  return {
    queue: state.queue,
    currentIndex,
  };
}

function validateTrack(track) {
  if (!track || typeof track !== 'object' || Array.isArray(track)) {
    throw new TypeError('Queue track must be a non-null object');
  }
  return track;
}

function normalizeToken(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError('Queue action token must be a string or number');
  }

  const token = String(value).trim();
  if (!token) throw new TypeError('Queue action token must not be empty');
  return token;
}

function resolveToken({ token, tokenFactory }, context) {
  if (token !== undefined) return normalizeToken(token);

  const createToken = tokenFactory ?? defaultTokenFactory;
  if (typeof createToken !== 'function') {
    throw new TypeError('tokenFactory must be a function');
  }
  return normalizeToken(createToken(Object.freeze({ ...context })));
}

export function getQueueEntryToken(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const token = entry[QUEUE_ENTRY_TOKEN];
  return typeof token === 'string' && token ? token : null;
}

function taggedTrack(track, token) {
  const entry = { ...track };
  Object.defineProperty(entry, QUEUE_ENTRY_TOKEN, {
    value: token,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return entry;
}

function trackName(track) {
  const candidate = track.name ?? track.title ?? track.songName;
  if (candidate == null || !String(candidate).trim()) return '歌曲';
  return String(candidate).trim();
}

function actionCopy(type, name) {
  if (type === QUEUE_ACTION_TYPES.PLAY_NEXT) {
    return Object.freeze({
      confirmation: `已设为下一首：${name}`,
      undoLabel: '撤销',
      undone: `已撤销下一首：${name}`,
      unavailable: '无法撤销：这首歌已不在原队列位置',
      current: '歌曲正在播放，暂不能撤销',
    });
  }

  return Object.freeze({
    confirmation: `已加入播放队列：${name}`,
    undoLabel: '撤销',
    undone: `已从播放队列撤销：${name}`,
    unavailable: '无法撤销：这首歌已不在原队列位置',
    current: '歌曲正在播放，暂不能撤销',
  });
}

function createAction({
  type,
  token,
  insertedIndex,
  track,
  currentIndexBefore,
  currentIndexAfter,
}) {
  const name = trackName(track);
  const trackId = track.id == null ? null : track.id;

  return Object.freeze({
    kind: ACTION_KIND,
    version: QUEUE_ACTION_VERSION,
    id: token,
    entryToken: token,
    type,
    insertedIndex,
    currentIndexBefore,
    currentIndexAfter,
    trackId,
    trackName: name,
    copy: actionCopy(type, name),
  });
}

function insert(state, track, type, options = {}) {
  const { queue, currentIndex } = validateState(state);
  validateTrack(track);
  if (!VALID_ACTION_TYPES.has(type)) {
    throw new TypeError(`Unsupported queue action type: ${String(type)}`);
  }

  const insertedIndex = type === QUEUE_ACTION_TYPES.ADD_TO_END
    ? queue.length
    : currentIndex >= 0
      ? currentIndex + 1
      : 0;

  const token = resolveToken(options, {
    type,
    insertedIndex,
    queueLength: queue.length,
    currentIndex,
    track,
  });

  if (queue.some((entry) => getQueueEntryToken(entry) === token)) {
    throw new RangeError(`Queue action token is already in use: ${token}`);
  }

  const entry = taggedTrack(track, token);
  const nextQueue = [
    ...queue.slice(0, insertedIndex),
    entry,
    ...queue.slice(insertedIndex),
  ];

  // Both public actions insert after the current item (or while there is no
  // current item), so the same logical current track keeps the same index.
  const nextCurrentIndex = currentIndex;
  const action = createAction({
    type,
    token,
    insertedIndex,
    track,
    currentIndexBefore: currentIndex,
    currentIndexAfter: nextCurrentIndex,
  });

  return Object.freeze({
    queue: nextQueue,
    currentIndex: nextCurrentIndex,
    changed: true,
    action,
    copy: action.copy,
  });
}

/**
 * Append a track to the queue without changing the current track/index.
 */
export function addToQueueEnd(state, track, options) {
  return insert(state, track, QUEUE_ACTION_TYPES.ADD_TO_END, options);
}

/**
 * Insert immediately after the current track. With no active current track,
 * insert at index 0 so it is the next item when playback begins.
 */
export function playNext(state, track, options) {
  return insert(state, track, QUEUE_ACTION_TYPES.PLAY_NEXT, options);
}

export function isQueueAction(action) {
  return Boolean(
    action
    && typeof action === 'object'
    && action.kind === ACTION_KIND
    && action.version === QUEUE_ACTION_VERSION
    && VALID_ACTION_TYPES.has(action.type)
    && typeof action.entryToken === 'string'
    && action.entryToken.length > 0,
  );
}

function undoCopy(action, reason) {
  if (reason === QUEUE_UNDO_REASONS.UNDONE) return action.copy.undone;
  if (reason === QUEUE_UNDO_REASONS.ENTRY_IS_CURRENT) {
    return action.copy.current;
  }
  return action?.copy?.unavailable ?? '无法撤销该队列操作';
}

function unchangedUndoResult(queue, currentIndex, action, reason) {
  return Object.freeze({
    queue,
    currentIndex,
    changed: false,
    undone: false,
    reason,
    action,
    copy: undoCopy(action, reason),
  });
}

/**
 * Undo one exact insertion.
 *
 * The entry is located by its unique token, never by song ID or object
 * equality. A missing or duplicated token becomes a safe no-op. If the
 * inserted entry is now the actively playing item, undo is also refused so an
 * undo toast cannot silently detach the track currently producing audio.
 *
 * When unrelated queue edits have moved the insertion before the current
 * track, currentIndex is decremented so it still points to the same track.
 */
export function undoQueueAction(state, action) {
  const { queue, currentIndex } = validateState(state);
  if (!isQueueAction(action)) {
    return unchangedUndoResult(
      queue,
      currentIndex,
      action,
      QUEUE_UNDO_REASONS.INVALID_ACTION,
    );
  }

  const matches = [];
  for (let index = 0; index < queue.length; index += 1) {
    if (getQueueEntryToken(queue[index]) === action.entryToken) {
      matches.push(index);
    }
  }

  if (matches.length === 0) {
    return unchangedUndoResult(
      queue,
      currentIndex,
      action,
      QUEUE_UNDO_REASONS.NOT_FOUND,
    );
  }
  if (matches.length > 1) {
    return unchangedUndoResult(
      queue,
      currentIndex,
      action,
      QUEUE_UNDO_REASONS.AMBIGUOUS,
    );
  }

  const removalIndex = matches[0];
  if (removalIndex === currentIndex) {
    return unchangedUndoResult(
      queue,
      currentIndex,
      action,
      QUEUE_UNDO_REASONS.ENTRY_IS_CURRENT,
    );
  }

  const nextQueue = [
    ...queue.slice(0, removalIndex),
    ...queue.slice(removalIndex + 1),
  ];
  const nextCurrentIndex = currentIndex > removalIndex
    ? currentIndex - 1
    : currentIndex;

  return Object.freeze({
    queue: nextQueue,
    currentIndex: nextCurrentIndex,
    changed: true,
    undone: true,
    reason: QUEUE_UNDO_REASONS.UNDONE,
    action,
    copy: undoCopy(action, QUEUE_UNDO_REASONS.UNDONE),
  });
}
