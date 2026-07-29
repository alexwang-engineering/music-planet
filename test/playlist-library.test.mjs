import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAYLIST_GROUP_LABELS,
  PLAYLIST_OWNERSHIP,
  PLAYLIST_SORTS,
  groupPlaylistLibrary,
  normalizePlaylistLibrary,
  normalizePlaylistRecord,
  normalizePlaylistText,
  preparePlaylistLibrary,
  queryPlaylistLibrary,
  resolvePlaylistSort,
  sortPlaylistLibrary,
} from '../app/playlist-library.mjs';

function playlist(overrides = {}, options = {}) {
  return normalizePlaylistRecord({
    id: 1,
    name: '默认歌单',
    creator: { userId: 8, nickname: '星球居民' },
    trackCount: 10,
    updateTime: 100,
    ...overrides,
  }, {
    userId: 8,
    sourceIndex: 0,
    ...options,
  });
}

test('publishes renderer-friendly ownership, sort, and Chinese group constants', () => {
  assert.deepEqual(PLAYLIST_OWNERSHIP, {
    CREATED: 'created',
    COLLECTED: 'collected',
  });
  assert.deepEqual(PLAYLIST_SORTS, {
    RECENT: 'recent',
    NAME: 'name',
    TRACK_COUNT: 'track-count',
  });
  assert.equal(PLAYLIST_GROUP_LABELS.created, '我创建的');
  assert.equal(PLAYLIST_GROUP_LABELS.collected, '我收藏的');
});

test('normalizes a complete created-playlist record', () => {
  const normalized = normalizePlaylistRecord({
    id: 6_792_103_822,
    name: '夜晚写代码',
    coverImgUrl: 'https://img.example/night.jpg',
    creator: { userId: '42', nickname: '星球居民' },
    trackCount: '128',
    updateTime: 1_720_000_000_000,
    createTime: 1_700_000_000_000,
    playCount: '9001',
    description: '  深夜精选  ',
    subscribed: 'true',
  }, { userId: 42, sourceIndex: 3 });

  assert.deepEqual(normalized, {
    id: 6_792_103_822,
    name: '夜晚写代码',
    creatorId: '42',
    creatorName: '星球居民',
    coverUrl: 'https://img.example/night.jpg',
    trackCount: 128,
    updateTime: 1_720_000_000_000,
    createTime: 1_700_000_000_000,
    playCount: 9001,
    description: '深夜精选',
    subscribed: true,
    ownership: 'created',
    isCreated: true,
    sourceIndex: 3,
  });
  assert.equal(Object.isFrozen(normalized), true);
});

test('classifies collected playlists from creator id even when subscribed is false', () => {
  const normalized = normalizePlaylistRecord({
    id: 2,
    name: '朋友的收藏',
    creator: { userId: 7, nickname: '隔壁星球' },
    subscribed: false,
  }, { userId: 42 });

  assert.equal(normalized.ownership, PLAYLIST_OWNERSHIP.COLLECTED);
  assert.equal(normalized.isCreated, false);
});

test('matches numeric, string, bigint, and zero-padded creator ids canonically', () => {
  assert.equal(normalizePlaylistRecord(
    { creator: { userId: '00042' } },
    { userId: 42n },
  ).isCreated, true);
  assert.equal(normalizePlaylistRecord(
    { creatorId: 42 },
    { userId: '+42' },
  ).isCreated, true);
  assert.equal(normalizePlaylistRecord(
    { userId: '42' },
    { userId: '43' },
  ).isCreated, false);
});

test('uses safe fallbacks and clamps malformed numeric fields', () => {
  const normalized = normalizePlaylistRecord({
    id: {},
    name: {},
    creator: '  匿名电台  ',
    coverImgUrl: [],
    trackCount: -9.8,
    updateTime: 'not-a-time',
    createTime: -1,
    playCount: Infinity,
    description: null,
    subscribed: 'no',
  }, { userId: 1, sourceIndex: -4 });

  assert.deepEqual(normalized, {
    id: null,
    name: '未命名歌单',
    creatorId: null,
    creatorName: '匿名电台',
    coverUrl: '',
    trackCount: 0,
    updateTime: 0,
    createTime: 0,
    playCount: 0,
    description: '',
    subscribed: false,
    ownership: 'collected',
    isCreated: false,
    sourceIndex: 0,
  });
  assert.deepEqual(
    normalizePlaylistRecord(null),
    {
      id: null,
      name: '未命名歌单',
      creatorId: null,
      creatorName: '未知创建者',
      coverUrl: '',
      trackCount: 0,
      updateTime: 0,
      createTime: 0,
      playCount: 0,
      description: '',
      subscribed: false,
      ownership: 'collected',
      isCreated: false,
      sourceIndex: 0,
    },
  );
});

test('uses the newest valid metadata or track timestamp for recent sorting', () => {
  const normalized = normalizePlaylistRecord({
    updateTime: 100,
    trackUpdateTime: '300',
    lastUpdateTime: 250,
    createTime: 50,
  });
  assert.equal(normalized.updateTime, 300);
});

test('accepts direct and common wrapped playlist response shapes', () => {
  const record = { id: 1, creator: { userId: 9 } };

  assert.equal(normalizePlaylistLibrary([record], { userId: 9 }).length, 1);
  assert.equal(normalizePlaylistLibrary({ playlist: [record] }).length, 1);
  assert.equal(normalizePlaylistLibrary({ body: { playlist: [record] } }).length, 1);
  assert.equal(normalizePlaylistLibrary({ data: { playlist: [record] } }).length, 1);
  assert.deepEqual(normalizePlaylistLibrary({ playlist: 'invalid' }), []);
  assert.deepEqual(normalizePlaylistLibrary(null), []);
});

test('does not mutate nested raw input and freezes normalized collections', () => {
  const raw = [{
    id: 1,
    name: '原始歌单',
    creator: { userId: 8, nickname: '创建者' },
    trackCount: '20',
  }];
  const snapshot = structuredClone(raw);

  const result = normalizePlaylistLibrary(raw, { userId: 8 });

  assert.deepEqual(raw, snapshot);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result[0]), true);
});

test('normalizes Chinese punctuation, full-width text, case, and diacritics', () => {
  assert.equal(
    normalizePlaylistText('《ＪＡＹ：周杰伦》 Café'),
    'jay周杰伦cafe',
  );
});

test('queries locally across playlist and creator names with every token required', () => {
  const items = normalizePlaylistLibrary([
    {
      id: 1,
      name: '《晴天》钢琴版',
      creator: { nickname: '周杰伦 Jay Chou' },
    },
    {
      id: 2,
      name: '晴天跑步歌单',
      creator: { nickname: '其他人' },
    },
    {
      id: 3,
      name: '夜曲',
      creator: { nickname: 'JÁY CHOU' },
    },
  ]);

  const chineseAndCreator = queryPlaylistLibrary(items, '晴天　周杰伦');
  const accentInsensitive = queryPlaylistLibrary(items, 'jay-chou');

  assert.deepEqual(chineseAndCreator.map(({ id }) => id), [1]);
  assert.deepEqual(accentInsensitive.map(({ id }) => id), [1, 3]);
  assert.equal(Object.isFrozen(chineseAndCreator), true);
});

test('an empty local query returns a new collection without changing order', () => {
  const items = [playlist({ id: 1 }), playlist({ id: 2 })];
  const result = queryPlaylistLibrary(items, '  ！ ');

  assert.notEqual(result, items);
  assert.deepEqual(result.map(({ id }) => id), [1, 2]);
  assert.deepEqual(items.map(({ id }) => id), [1, 2]);
});

test('sorts recent updates descending with deterministic name and id ties', () => {
  const items = [
    playlist({ id: 20, name: 'B', updateTime: 200 }, { sourceIndex: 0 }),
    playlist({ id: 30, name: 'A', updateTime: 200 }, { sourceIndex: 1 }),
    playlist({ id: 10, name: 'A', updateTime: 200 }, { sourceIndex: 2 }),
    playlist({ id: 40, name: '最新', updateTime: 300 }, { sourceIndex: 3 }),
  ];
  const snapshot = [...items];

  const result = sortPlaylistLibrary(items, 'recent-update');

  assert.deepEqual(result.map(({ id }) => id), [40, 10, 30, 20]);
  assert.deepEqual(items, snapshot);
  assert.equal(Object.isFrozen(result), true);
});

test('sorts names ascending using numeric-aware, case-insensitive comparison', () => {
  const items = [
    playlist({ id: 3, name: 'Mix 10' }, { sourceIndex: 0 }),
    playlist({ id: 2, name: 'mix 2' }, { sourceIndex: 1 }),
    playlist({ id: 1, name: 'Alpha' }, { sourceIndex: 2 }),
  ];

  assert.deepEqual(
    sortPlaylistLibrary(items, PLAYLIST_SORTS.NAME).map(({ id }) => id),
    [1, 2, 3],
  );
});

test('sorts song count descending and resolves count ties deterministically', () => {
  const items = [
    playlist({ id: 4, name: 'B', trackCount: 20 }, { sourceIndex: 0 }),
    playlist({ id: 2, name: 'A', trackCount: 20 }, { sourceIndex: 1 }),
    playlist({ id: 1, name: '小歌单', trackCount: 3 }, { sourceIndex: 2 }),
  ];

  assert.deepEqual(
    sortPlaylistLibrary(items, 'songs').map(({ id }) => id),
    [2, 4, 1],
  );
});

test('preserves input order on a complete comparison tie', () => {
  const repeated = playlist({
    id: 1,
    name: '同名',
    creator: { userId: 8, nickname: '同一人' },
  });
  const first = Object.freeze({ ...repeated, marker: 'first' });
  const second = Object.freeze({ ...repeated, marker: 'second' });

  const result = sortPlaylistLibrary([second, first], PLAYLIST_SORTS.NAME);

  assert.deepEqual(result.map(({ marker }) => marker), ['second', 'first']);
});

test('resolves friendly sort aliases and safely defaults malformed values', () => {
  assert.equal(resolvePlaylistSort(' UpdateTime '), PLAYLIST_SORTS.RECENT);
  assert.equal(resolvePlaylistSort('song_count'), PLAYLIST_SORTS.TRACK_COUNT);
  assert.equal(resolvePlaylistSort('TITLE'), PLAYLIST_SORTS.NAME);
  assert.equal(resolvePlaylistSort({}), PLAYLIST_SORTS.RECENT);
});

test('groups created and collected items with ordered labels and UI counts', () => {
  const items = normalizePlaylistLibrary([
    { id: 1, creator: { userId: 8 } },
    { id: 2, creator: { userId: 9 } },
    { id: 3, creator: { userId: '8' } },
  ], { userId: 8 });

  const grouped = groupPlaylistLibrary(items);

  assert.deepEqual(grouped.created.map(({ id }) => id), [1, 3]);
  assert.deepEqual(grouped.collected.map(({ id }) => id), [2]);
  assert.deepEqual(grouped.counts, { total: 3, created: 2, collected: 1 });
  assert.deepEqual(grouped.groups.map(({ key, label, count }) => ({
    key,
    label,
    count,
  })), [
    { key: 'created', label: '我创建的', count: 2 },
    { key: 'collected', label: '我收藏的', count: 1 },
  ]);
  assert.equal(Object.isFrozen(grouped.groups), true);
  assert.equal(Object.isFrozen(grouped.groups[0].items), true);
});

test('prepares filtered, sorted groups while retaining full-library counts', () => {
  const prepared = preparePlaylistLibrary([
    {
      id: 1,
      name: '周杰伦精选 1',
      creator: { userId: 8, nickname: '我' },
      trackCount: 10,
    },
    {
      id: 2,
      name: '周杰伦精选 2',
      creator: { userId: 9, nickname: '朋友' },
      trackCount: 50,
    },
    {
      id: 3,
      name: '摇滚',
      creator: { userId: 8, nickname: '我' },
      trackCount: 100,
    },
  ], {
    userId: 8,
    query: '周杰伦',
    sort: 'song-count',
  });

  assert.equal(prepared.query, '周杰伦');
  assert.equal(prepared.sort, PLAYLIST_SORTS.TRACK_COUNT);
  assert.deepEqual(prepared.items.map(({ id }) => id), [2, 1]);
  assert.deepEqual(prepared.counts, {
    total: 3,
    visible: 2,
    created: 1,
    collected: 1,
    allCreated: 2,
    allCollected: 1,
  });
  assert.deepEqual(
    prepared.groups.map(({ key, count }) => ({ key, count })),
    [
      { key: PLAYLIST_OWNERSHIP.CREATED, count: 1 },
      { key: PLAYLIST_OWNERSHIP.COLLECTED, count: 1 },
    ],
  );
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.counts), true);
});
