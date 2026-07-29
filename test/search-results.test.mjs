import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEARCH_FILTERS,
  SONG_VARIANT_TYPES,
  classifySongVariant,
  filterSearchResults,
  groupSearchResults,
  isSongPlayable,
  normalizeArtistSet,
  normalizeSearchText,
  normalizeSongTitle,
  prepareSearchResults,
  rankSearchResults,
} from '../app/search-results.mjs';

function song(overrides = {}) {
  return {
    id: overrides.id ?? Math.random(),
    name: '晴天',
    artists: [{ name: '周杰伦' }],
    duration: 240_000,
    album: { name: '叶惠美', picUrl: 'https://img.example/cover.jpg' },
    pop: 50,
    playable: true,
    ...overrides,
  };
}

test('normalizes Unicode width, case, accents, whitespace, and Chinese punctuation', () => {
  assert.equal(
    normalizeSearchText('  《ＢÉＹＯＮＣÉ：布拉格广场》！？ '),
    'beyonce布拉格广场',
  );
});

test('normalizes a title while removing only recognized version qualifiers', () => {
  assert.equal(normalizeSongTitle('《布拉格广场》（ＬＩＶＥ 版）'), '布拉格广场');
  assert.equal(normalizeSongTitle('夜曲（电影主题曲）'), '夜曲电影主题曲');
});

test('normalizes artist sets independently of artist order and duplicate spelling', () => {
  const first = normalizeArtistSet([
    { name: '周杰伦' },
    { name: 'Lara 梁心颐' },
    { name: ' 周杰伦 ' },
  ]);
  const second = normalizeArtistSet([
    { name: 'LARA　梁心颐' },
    { name: '周杰伦' },
  ]);

  assert.deepEqual(first, ['lara梁心颐', '周杰伦']);
  assert.deepEqual(second, first);
});

test('classifies equivalent Chinese and English live labels consistently', () => {
  const english = classifySongVariant('布拉格广场 (Live Version)');
  const chinese = classifySongVariant('布拉格广场—现场版');

  assert.equal(english.type, SONG_VARIANT_TYPES.LIVE);
  assert.equal(chinese.type, SONG_VARIANT_TYPES.LIVE);
  assert.equal(english.signature, chinese.signature);
  assert.equal(english.label, '现场');
  assert.equal(english.baseTitle, '布拉格广场');
});

test('recognizes attached bilingual version suffixes without misclassifying titles like Alive', () => {
  assert.equal(
    classifySongVariant('晴天Live版').type,
    SONG_VARIANT_TYPES.LIVE,
  );
  assert.equal(
    classifySongVariant('晴天DJ版').type,
    SONG_VARIANT_TYPES.REMIX,
  );
  assert.equal(
    classifySongVariant('Alive').type,
    SONG_VARIANT_TYPES.ORIGINAL,
  );
});

test('keeps named performances within the same broad variant type distinct', () => {
  const tour2013 = classifySongVariant('晴天（2013 Live）');
  const tour2019 = classifySongVariant('晴天（2019 现场版）');

  assert.equal(tour2013.type, SONG_VARIANT_TYPES.LIVE);
  assert.equal(tour2019.type, SONG_VARIANT_TYPES.LIVE);
  assert.notEqual(tour2013.signature, tour2019.signature);
});

test('groups duplicate sources despite artist order and Chinese punctuation', () => {
  const results = [
    song({
      id: 1,
      name: '《布拉格广场》（Live）',
      artists: [{ name: '周杰伦' }, { name: '蔡依林' }],
      duration: 228_000,
    }),
    song({
      id: 2,
      name: '布拉格广场 — 现场版',
      artists: [{ name: '蔡依林' }, { name: '周杰伦' }],
      duration: 230_500,
    }),
  ];

  const [group] = groupSearchResults(results);

  assert.equal(groupSearchResults(results).length, 1);
  assert.equal(group.sourceCount, 2);
  assert.equal(group.duplicateCount, 1);
  assert.deepEqual(group.sourceIndices, [0, 1]);
});

test('uses a bounded duration tolerance and avoids transitive over-grouping', () => {
  const groups = groupSearchResults([
    song({ id: 1, duration: 200_000 }),
    song({ id: 2, duration: 202_900 }),
    song({ id: 3, duration: 205_500 }),
  ], { durationToleranceMs: 3_000 });

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.sourceCount), [2, 1]);
});

test('keeps Live, Remix, Cover, Instrumental, and accompaniment versions separate', () => {
  const groups = groupSearchResults([
    song({ id: 1, name: '晴天' }),
    song({ id: 2, name: '晴天 (Live)' }),
    song({ id: 3, name: '晴天 (Remix)' }),
    song({ id: 4, name: '晴天 (Cover)' }),
    song({ id: 5, name: '晴天 (Instrumental)' }),
    song({ id: 6, name: '晴天（伴奏）' }),
  ]);

  assert.equal(groups.length, 6);
  assert.deepEqual(
    new Set(groups.map((group) => group.variant.type)),
    new Set([
      SONG_VARIANT_TYPES.ORIGINAL,
      SONG_VARIANT_TYPES.LIVE,
      SONG_VARIANT_TYPES.REMIX,
      SONG_VARIANT_TYPES.COVER,
      SONG_VARIANT_TYPES.INSTRUMENTAL,
      SONG_VARIANT_TYPES.ACCOMPANIMENT,
    ]),
  );
});

test('keeps meaningfully different collaborator sets separate', () => {
  const groups = groupSearchResults([
    song({ id: 1, artists: [{ name: '周杰伦' }] }),
    song({ id: 2, artists: [{ name: '周杰伦' }, { name: '蔡依林' }] }),
    song({ id: 3, artists: [{ name: '周杰伦' }, { name: '费玉清' }] }),
  ]);

  assert.equal(groups.length, 3);
});

test('prefers playable sources before richer but unavailable duplicates', () => {
  const unavailable = song({
    id: 1,
    playable: false,
    album: { name: '完整专辑', picUrl: 'https://img.example/rich.jpg' },
  });
  const playable = song({
    id: 2,
    playable: true,
    album: { name: '', picUrl: '' },
  });

  const [group] = groupSearchResults([unavailable, playable]);

  assert.equal(group.song.id, 2);
  assert.equal(group.playable, true);
});

test('prefers complete metadata, then cover art, among equally playable sources', () => {
  const sparse = song({
    id: 1,
    album: { name: '', picUrl: '' },
  });
  const completeWithoutCover = song({
    id: 2,
    album: { name: '叶惠美', picUrl: '' },
  });
  const completeWithCover = song({
    id: 3,
    album: { name: '叶惠美', picUrl: 'https://img.example/best.jpg' },
  });

  const [group] = groupSearchResults([sparse, completeWithoutCover, completeWithCover]);

  assert.equal(group.song.id, 3);
});

test('ranks exact artist, exact title, original, playable, then popularity and API order', () => {
  const groups = groupSearchResults([
    song({ id: 1, name: '周杰伦', artists: [{ name: '其他歌手' }], pop: 100 }),
    song({ id: 2, name: '晴天 (Live)', artists: [{ name: '周杰伦' }], pop: 100 }),
    song({
      id: 3,
      name: '晴天',
      artists: [{ name: '周杰伦' }],
      duration: 240_000,
      playable: false,
      pop: 100,
    }),
    song({
      id: 4,
      name: '晴天',
      artists: [{ name: '周杰伦' }],
      duration: 250_000,
      playable: true,
      pop: 10,
    }),
    song({
      id: 5,
      name: '晴天',
      artists: [{ name: '周杰伦' }],
      duration: 260_000,
      playable: true,
      pop: 90,
    }),
    song({
      id: 6,
      name: '晴天',
      artists: [{ name: '周杰伦' }],
      duration: 270_000,
      playable: true,
      pop: 90,
    }),
  ]);

  const ranked = rankSearchResults(groups, '周杰伦');

  assert.deepEqual(ranked.map((group) => group.song.id), [5, 6, 4, 3, 2, 1]);
});

test('uses exact normalized song-title matches inside the artist-match tier', () => {
  const groups = groupSearchResults([
    song({ id: 1, name: '晴天之后', pop: 100 }),
    song({ id: 2, name: '《晴天》', pop: 1 }),
  ]);

  const ranked = rankSearchResults(groups, '晴天');

  assert.deepEqual(ranked.map((group) => group.song.id), [2, 1]);
});

test('ranks a sole artist match before collaborations containing that artist', () => {
  const groups = groupSearchResults([
    song({
      id: 1,
      name: '周杰伦',
      artists: [{ name: '周杰伦' }, { name: '蔡依林' }],
      duration: 210_000,
      pop: 10,
    }),
    song({
      id: 2,
      name: '晴天',
      artists: [{ name: '周杰伦' }, { name: '费玉清' }],
      duration: 220_000,
      pop: 100,
    }),
    song({
      id: 3,
      name: '夜曲',
      artists: [{ name: '周杰伦' }],
      duration: 230_000,
      pop: 1,
    }),
    song({
      id: 4,
      name: '周杰伦',
      artists: [{ name: '其他歌手' }],
      duration: 240_000,
      pop: 100,
    }),
  ]);

  const ranked = rankSearchResults(groups, '周杰伦');

  assert.deepEqual(ranked.map((group) => group.song.id), [3, 1, 2, 4]);
  assert.deepEqual(
    ranked.filter((group) => group.isCollaboration).map((group) => group.song.id),
    [1, 2],
  );
});

test('filters all, original, live, collaboration, and playable categories', () => {
  const groups = groupSearchResults([
    song({ id: 1, name: '晴天' }),
    song({ id: 2, name: '晴天 (Live)' }),
    song({
      id: 3,
      name: '千里之外',
      artists: [{ name: '周杰伦' }, { name: '费玉清' }],
    }),
    song({ id: 4, name: '夜曲', playable: false }),
  ]);

  assert.equal(filterSearchResults(groups, SEARCH_FILTERS.ALL).length, 4);
  assert.deepEqual(
    filterSearchResults(groups, SEARCH_FILTERS.ORIGINAL).map((group) => group.song.id),
    [1, 3, 4],
  );
  assert.deepEqual(
    filterSearchResults(groups, SEARCH_FILTERS.LIVE).map((group) => group.song.id),
    [2],
  );
  assert.deepEqual(
    filterSearchResults(groups, SEARCH_FILTERS.COLLABORATION).map((group) => group.song.id),
    [3],
  );
  assert.deepEqual(
    filterSearchResults(groups, SEARCH_FILTERS.PLAYABLE).map((group) => group.song.id),
    [1, 2, 3],
  );
});

test('prepareSearchResults composes grouping, ranking, and filtering without mutating input', () => {
  const input = [
    song({ id: 1, name: '晴天 (Live)', pop: 100 }),
    song({ id: 2, name: '晴天', pop: 1 }),
    song({ id: 3, name: '《晴天》', pop: 90 }),
  ];
  const snapshot = structuredClone(input);

  const prepared = prepareSearchResults(input, '晴天', {
    filter: SEARCH_FILTERS.ORIGINAL,
  });

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].song.id, 3);
  assert.equal(prepared[0].sourceCount, 2);
  assert.deepEqual(input, snapshot);
});

test('an explicit playability resolver can apply session-aware rules', () => {
  const [group] = groupSearchResults([
    song({ id: 1, fee: 1, playable: undefined }),
  ], {
    isPlayable: (candidate) => candidate.fee === 0,
  });

  assert.equal(group.playable, false);
  assert.equal(filterSearchResults([group], SEARCH_FILTERS.PLAYABLE).length, 0);
});

test('default playability detection uses explicit rights signals conservatively', () => {
  assert.equal(isSongPlayable(song({ playable: false })), false);
  assert.equal(isSongPlayable(song({ noCopyrightRcmd: { type: 1 } })), false);
  assert.equal(isSongPlayable(song({ privilege: { st: -200 } })), false);
  assert.equal(isSongPlayable(song({ noCopyrightRcmd: false, fee: 1 })), true);
});
