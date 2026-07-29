import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QUEUE_ACTION_TYPES,
  QUEUE_ENTRY_TOKEN,
  QUEUE_UNDO_REASONS,
  addToQueueEnd,
  getQueueEntryToken,
  isQueueAction,
  playNext,
  undoQueueAction,
} from '../app/queue-actions.mjs';

const song = (id, name = `Song ${id}`) => ({ id, name, ar: [{ name: 'Artist' }] });
const fixedToken = (token) => ({ token });

test('adds to the end immutably and returns action metadata plus UI copy', () => {
  const first = song(1);
  const added = song(2, '银河');
  const input = [first];
  const result = addToQueueEnd(
    { queue: input, currentIndex: 0 },
    added,
    fixedToken('end-1'),
  );

  assert.deepEqual(result.queue.map((entry) => entry.id), [1, 2]);
  assert.equal(result.currentIndex, 0);
  assert.equal(result.queue[0], first);
  assert.notEqual(result.queue[1], added);
  assert.deepEqual(added, song(2, '银河'));
  assert.deepEqual(input, [first]);
  assert.equal(getQueueEntryToken(result.queue[1]), 'end-1');
  assert.equal(result.action.type, QUEUE_ACTION_TYPES.ADD_TO_END);
  assert.equal(result.action.insertedIndex, 1);
  assert.equal(result.action.trackId, 2);
  assert.equal(result.action.trackName, '银河');
  assert.equal(result.copy.confirmation, '已加入播放队列：银河');
  assert.equal(result.copy.undoLabel, '撤销');
  assert.equal(isQueueAction(result.action), true);
});

test('inserts play-next directly after current without moving current', () => {
  const first = song(1);
  const current = song(2);
  const last = song(3);
  const next = song(4);
  const input = [first, current, last];

  const result = playNext(
    { queue: input, currentIndex: 1 },
    next,
    fixedToken('next-1'),
  );

  assert.deepEqual(result.queue.map((entry) => entry.id), [1, 2, 4, 3]);
  assert.equal(result.queue[result.currentIndex], current);
  assert.equal(result.currentIndex, 1);
  assert.equal(result.action.insertedIndex, 2);
  assert.equal(result.copy.confirmation, '已设为下一首：Song 4');
  assert.deepEqual(input.map((entry) => entry.id), [1, 2, 3]);
});

test('with no active track, play-next becomes first while current stays unset', () => {
  const existing = [song(1), song(2)];
  const result = playNext(
    { queue: existing, currentIndex: -1 },
    song(3),
    fixedToken('next-unstarted'),
  );

  assert.deepEqual(result.queue.map((entry) => entry.id), [3, 1, 2]);
  assert.equal(result.currentIndex, -1);
  assert.equal(result.action.currentIndexBefore, -1);
  assert.equal(result.action.currentIndexAfter, -1);
});

test('empty queues support both operations without inventing a current track', () => {
  const atEnd = addToQueueEnd(
    { queue: [], currentIndex: -1 },
    song(1),
    fixedToken('empty-end'),
  );
  const next = playNext(
    { queue: [], currentIndex: -1 },
    song(2),
    fixedToken('empty-next'),
  );

  assert.deepEqual(atEnd.queue.map((entry) => entry.id), [1]);
  assert.deepEqual(next.queue.map((entry) => entry.id), [2]);
  assert.equal(atEnd.currentIndex, -1);
  assert.equal(next.currentIndex, -1);
});

test('undo removes the exact inserted occurrence among duplicate IDs and references', () => {
  const duplicate = song(7, 'Duplicate');
  const input = [duplicate, duplicate];
  const insertion = playNext(
    { queue: input, currentIndex: 0 },
    duplicate,
    fixedToken('duplicate-insertion'),
  );

  assert.equal(insertion.queue.length, 3);
  assert.equal(insertion.queue[0], duplicate);
  assert.notEqual(insertion.queue[1], duplicate);
  assert.equal(insertion.queue[2], duplicate);

  const undone = undoQueueAction(
    { queue: insertion.queue, currentIndex: 0 },
    insertion.action,
  );

  assert.equal(undone.undone, true);
  assert.equal(undone.reason, QUEUE_UNDO_REASONS.UNDONE);
  assert.deepEqual(undone.queue, input);
  assert.equal(undone.copy, '已撤销下一首：Duplicate');
  assert.equal(insertion.queue.length, 3);
});

test('undo follows a moved insertion and preserves the logical current track', () => {
  const a = song('a');
  const b = song('b');
  const c = song('c');
  const x = song('x');
  const y = song('y');
  const insertion = playNext(
    { queue: [a, b], currentIndex: 0 },
    c,
    fixedToken('moved-entry'),
  );

  // Later edits prepend and append songs, and playback has advanced to B.
  const changedQueue = [x, ...insertion.queue, y];
  const currentIndex = changedQueue.indexOf(b);
  const undone = undoQueueAction(
    { queue: changedQueue, currentIndex },
    insertion.action,
  );

  assert.deepEqual(undone.queue.map((entry) => entry.id), ['x', 'a', 'b', 'y']);
  assert.equal(undone.currentIndex, 2);
  assert.equal(undone.queue[undone.currentIndex], b);
});

test('undo after a reorder leaves currentIndex alone when removal is later', () => {
  const a = song('a');
  const b = song('b');
  const c = song('c');
  const insertion = addToQueueEnd(
    { queue: [a, b], currentIndex: 0 },
    c,
    fixedToken('reordered-entry'),
  );
  const reordered = [b, a, insertion.queue[2]];

  const undone = undoQueueAction(
    { queue: reordered, currentIndex: 0 },
    insertion.action,
  );

  assert.deepEqual(undone.queue, [b, a]);
  assert.equal(undone.currentIndex, 0);
  assert.equal(undone.queue[undone.currentIndex], b);
});

test('multiple pending actions can be undone independently in either order', () => {
  const base = [song(1), song(2)];
  const first = playNext(
    { queue: base, currentIndex: 0 },
    song(3),
    fixedToken('pending-1'),
  );
  const second = addToQueueEnd(
    { queue: first.queue, currentIndex: 0 },
    song(4),
    fixedToken('pending-2'),
  );

  const undoFirst = undoQueueAction(
    { queue: second.queue, currentIndex: 0 },
    first.action,
  );
  assert.deepEqual(undoFirst.queue.map((entry) => entry.id), [1, 2, 4]);

  const undoSecond = undoQueueAction(
    { queue: undoFirst.queue, currentIndex: 0 },
    second.action,
  );
  assert.deepEqual(undoSecond.queue, base);
});

test('stale undo is a safe no-op when the exact entry is already gone', () => {
  const base = [song(1)];
  const insertion = addToQueueEnd(
    { queue: base, currentIndex: 0 },
    song(2),
    fixedToken('stale-entry'),
  );

  const result = undoQueueAction(
    { queue: base, currentIndex: 0 },
    insertion.action,
  );

  assert.equal(result.changed, false);
  assert.equal(result.undone, false);
  assert.equal(result.reason, QUEUE_UNDO_REASONS.NOT_FOUND);
  assert.equal(result.queue, base);
});

test('ambiguous tokens refuse to remove either occurrence', () => {
  const insertion = addToQueueEnd(
    { queue: [song(1)], currentIndex: 0 },
    song(2),
    fixedToken('copied-entry'),
  );
  const entry = insertion.queue[1];
  const ambiguousQueue = [insertion.queue[0], entry, entry];

  const result = undoQueueAction(
    { queue: ambiguousQueue, currentIndex: 0 },
    insertion.action,
  );

  assert.equal(result.changed, false);
  assert.equal(result.reason, QUEUE_UNDO_REASONS.AMBIGUOUS);
  assert.equal(result.queue, ambiguousQueue);
});

test('undo refuses to remove an insertion that is now current', () => {
  const insertion = playNext(
    { queue: [song(1)], currentIndex: 0 },
    song(2),
    fixedToken('now-playing'),
  );

  const result = undoQueueAction(
    { queue: insertion.queue, currentIndex: 1 },
    insertion.action,
  );

  assert.equal(result.changed, false);
  assert.equal(result.reason, QUEUE_UNDO_REASONS.ENTRY_IS_CURRENT);
  assert.equal(result.copy, '歌曲正在播放，暂不能撤销');
  assert.equal(result.queue, insertion.queue);
});

test('invalid action metadata is a harmless no-op', () => {
  const queue = [song(1)];
  const result = undoQueueAction(
    { queue, currentIndex: 0 },
    { type: QUEUE_ACTION_TYPES.ADD_TO_END, entryToken: 'forged' },
  );

  assert.equal(isQueueAction(null), false);
  assert.equal(isQueueAction({}), false);
  assert.equal(result.changed, false);
  assert.equal(result.reason, QUEUE_UNDO_REASONS.INVALID_ACTION);
  assert.equal(result.copy, '无法撤销该队列操作');
  assert.equal(result.queue, queue);
});

test('token factories receive deterministic context and collisions are rejected', () => {
  const current = song(1);
  const added = song(2);
  let context;
  const tokenFactory = (value) => {
    context = value;
    return `${value.type}:${value.insertedIndex}`;
  };

  const result = playNext(
    { queue: [current], currentIndex: 0 },
    added,
    { tokenFactory },
  );

  assert.equal(result.action.entryToken, 'play-next:1');
  assert.equal(context.type, QUEUE_ACTION_TYPES.PLAY_NEXT);
  assert.equal(context.insertedIndex, 1);
  assert.equal(context.queueLength, 1);
  assert.equal(context.currentIndex, 0);
  assert.equal(context.track, added);
  assert.equal(Object.isFrozen(context), true);

  assert.throws(
    () => addToQueueEnd(
      { queue: result.queue, currentIndex: 0 },
      song(3),
      fixedToken('play-next:1'),
    ),
    /already in use/,
  );
});

test('entry tokens survive shallow queue-entry cloning but not JSON persistence', () => {
  const original = song(1);
  const insertion = addToQueueEnd(
    { queue: [], currentIndex: -1 },
    original,
    fixedToken('runtime-only'),
  );
  const entry = insertion.queue[0];
  const shallowClone = { ...entry };

  assert.equal(entry[QUEUE_ENTRY_TOKEN], 'runtime-only');
  assert.equal(getQueueEntryToken(shallowClone), 'runtime-only');
  assert.equal(Object.hasOwn(original, QUEUE_ENTRY_TOKEN), false);
  assert.equal(JSON.stringify(entry), JSON.stringify(original));
});

test('validates malformed state, tracks, tokens, and index ranges', () => {
  assert.throws(() => addToQueueEnd(null, song(1)), /state must be an object/i);
  assert.throws(
    () => addToQueueEnd({ queue: {}, currentIndex: -1 }, song(1)),
    /queue array/i,
  );
  assert.throws(
    () => playNext({ queue: [], currentIndex: 0 }, song(1)),
    /outside the queue/i,
  );
  assert.throws(
    () => playNext({ queue: [song(1)], currentIndex: 0.5 }, song(2)),
    /integer/i,
  );
  assert.throws(
    () => addToQueueEnd({ queue: [], currentIndex: -1 }, null),
    /track must be a non-null object/i,
  );
  assert.throws(
    () => addToQueueEnd(
      { queue: [], currentIndex: -1 },
      song(1),
      fixedToken('  '),
    ),
    /must not be empty/i,
  );
  assert.throws(
    () => addToQueueEnd(
      { queue: [], currentIndex: -1 },
      song(1),
      { tokenFactory: 'not-a-function' },
    ),
    /must be a function/i,
  );
});
