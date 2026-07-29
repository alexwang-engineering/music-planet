import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ENTITY_DETAIL_PATHS,
  ENTITY_RESULT_KEYS,
  ENTITY_SEARCH_TYPES,
  ENTITY_TRACK_PATHS,
  ENTITY_TYPES,
  buildEntityDetailEndpoint,
  buildEntitySearchEndpoint,
  buildEntityTracksEndpoint,
  normalizeEntityCard,
  normalizeEntitySearchResponse,
  normalizeEntityText,
  prepareEntitySearchResults,
  resolveEntityType,
  sortEntityCards,
} from '../app/search-entities.mjs';

test('publishes the verified NetEase search types, response keys, and endpoint paths', () => {
  assert.deepEqual(ENTITY_SEARCH_TYPES, {
    artist: 100,
    album: 10,
    playlist: 1000,
  });
  assert.deepEqual(ENTITY_RESULT_KEYS.artist, {
    collection: 'artists',
    count: 'artistCount',
  });
  assert.equal(ENTITY_DETAIL_PATHS.artist, '/artists');
  assert.equal(ENTITY_DETAIL_PATHS.album, '/album');
  assert.equal(ENTITY_DETAIL_PATHS.playlist, '/playlist/detail');
  assert.equal(ENTITY_TRACK_PATHS.artist, '/artist/top/song');
  assert.equal(ENTITY_TRACK_PATHS.playlist, '/playlist/track/all');
});

test('resolves semantic names and numeric search codes', () => {
  assert.equal(resolveEntityType('ARTIST'), ENTITY_TYPES.ARTIST);
  assert.equal(resolveEntityType(10), ENTITY_TYPES.ALBUM);
  assert.equal(resolveEntityType('1000'), ENTITY_TYPES.PLAYLIST);
  assert.throws(() => resolveEntityType('song'), /Unsupported entity type/);
});

test('normalizes Chinese punctuation, width, case, and diacritics for matching', () => {
  assert.equal(normalizeEntityText('《ＪＡＹ：周杰伦》 Bé'), 'jay周杰伦be');
});

test('normalizes an artist response into the common card model', () => {
  const normalized = normalizeEntitySearchResponse({
    code: 200,
    result: {
      artistCount: 1,
      artists: [{
        id: 6452,
        name: '周杰伦',
        picUrl: 'https://img.example/jay.jpg',
        alias: ['Jay Chou', '周董'],
        albumSize: 41,
        musicSize: 568,
        mvSize: 9,
        fansSize: 42_000_000,
      }],
    },
  }, ENTITY_TYPES.ARTIST);

  assert.equal(normalized.type, ENTITY_TYPES.ARTIST);
  assert.equal(normalized.total, 1);
  assert.deepEqual(normalized.items[0], {
    id: 6452,
    type: 'artist',
    title: '周杰伦',
    subtitle: 'Jay Chou · 周董',
    imageUrl: 'https://img.example/jay.jpg',
    aliases: ['Jay Chou', '周董'],
    artistNames: [],
    creatorName: '',
    trackCount: 568,
    albumCount: 41,
    mvCount: 9,
    playCount: null,
    subscriberCount: null,
    popularity: 42_000_000,
    publishTime: null,
    description: '',
    highQuality: false,
    sourceIndex: 0,
  });
});

test('normalizes a package-wrapped album response and artist subtitle', () => {
  const normalized = normalizeEntitySearchResponse({
    body: {
      result: {
        albumCount: 8,
        albums: [{
          idStr: '18888',
          name: '不能说的秘密 电影原声带',
          blurPicUrl: 'https://img.example/secret.jpg',
          size: 25,
          artists: [{ name: '周杰伦' }, { name: 'Terdsak Janpan' }],
          publishTime: 1_186_934_400_000,
          company: '杰威尔',
        }],
      },
    },
  }, 10);

  const [album] = normalized.items;
  assert.equal(normalized.total, 8);
  assert.equal(album.id, '18888');
  assert.equal(album.type, ENTITY_TYPES.ALBUM);
  assert.equal(album.subtitle, '周杰伦 / Terdsak Janpan');
  assert.deepEqual(album.artistNames, ['周杰伦', 'Terdsak Janpan']);
  assert.equal(album.trackCount, 25);
  assert.equal(album.albumCount, null);
  assert.equal(album.publishTime, 1_186_934_400_000);
});

test('normalizes playlist creator, counts, artwork, and play count popularity', () => {
  const normalized = normalizeEntitySearchResponse({
    data: {
      result: {
        playlistCount: 1,
        playlists: [{
          id: 6_792_103_822,
          name: '周杰伦 - Jay',
          coverImgUrl: 'https://img.example/playlist.jpg',
          creator: { nickname: '星球居民' },
          trackCount: '140',
          playCount: 31_750_336,
          bookCount: 136_586,
          highQuality: true,
          description: '精选歌单',
        }],
      },
    },
  }, 'playlist');

  const [playlist] = normalized.items;
  assert.equal(playlist.subtitle, '星球居民');
  assert.equal(playlist.trackCount, 140);
  assert.equal(playlist.playCount, 31_750_336);
  assert.equal(playlist.subscriberCount, 136_586);
  assert.equal(playlist.popularity, 31_750_336);
  assert.equal(playlist.highQuality, true);
});

test('uses predictable fallbacks for sparse entities without leaking undefined', () => {
  const artist = normalizeEntityCard('artist', null);
  const album = normalizeEntityCard('album', {});
  const playlist = normalizeEntityCard('playlist', { id: ' 9 ' });

  assert.equal(artist.title, '未知歌手');
  assert.equal(artist.id, null);
  assert.equal(artist.trackCount, null);
  assert.equal(album.title, '未知专辑');
  assert.equal(album.subtitle, '专辑');
  assert.equal(playlist.id, '9');
  assert.equal(playlist.imageUrl, '');
  assert.deepEqual(playlist.aliases, []);
});

test('returns a safe empty result for empty and malformed API payloads', () => {
  assert.deepEqual(
    normalizeEntitySearchResponse(null, 'artist'),
    { type: 'artist', total: 0, items: [] },
  );
  assert.deepEqual(
    normalizeEntitySearchResponse({ result: { albums: 'invalid' } }, 'album'),
    { type: 'album', total: 0, items: [] },
  );
});

test('ranks exact, prefix, contains, and unmatched names before heat', () => {
  const response = {
    result: {
      playlists: [
        { id: 1, name: '精选歌单', playCount: 900_000_000 },
        { id: 2, name: '周杰伦精选', playCount: 2 },
        { id: 3, name: '致周杰伦的歌', playCount: 3 },
        { id: 4, name: '周杰伦', playCount: 1 },
      ],
    },
  };

  const prepared = prepareEntitySearchResults(response, 'playlist', '《周杰伦》');

  assert.deepEqual(prepared.items.map(({ id }) => id), [4, 2, 3, 1]);
});

test('lets aliases and associated artist names participate in exact matching', () => {
  const artistResults = prepareEntitySearchResults({
    result: {
      artists: [
        { id: 1, name: '其他歌手', score: 999 },
        { id: 2, name: '周杰伦', alias: ['Jay Chou'], score: 1 },
      ],
    },
  }, 'artist', 'jay chou');
  const albumResults = prepareEntitySearchResults({
    result: {
      albums: [
        { id: 3, name: '无关专辑', artists: [{ name: '周杰伦' }] },
        { id: 4, name: '周杰伦之后' },
      ],
    },
  }, 'album', '周杰伦');

  assert.equal(artistResults.items[0].id, 2);
  assert.equal(albumResults.items[0].id, 3);
});

test('uses popularity inside a match tier and preserves API order on a complete tie', () => {
  const cards = [
    normalizeEntityCard('playlist', {
      id: 1,
      name: '周杰伦 A',
      playCount: 50,
    }, 0),
    normalizeEntityCard('playlist', {
      id: 2,
      name: '周杰伦 B',
      playCount: 100,
    }, 1),
    normalizeEntityCard('playlist', {
      id: 3,
      name: '周杰伦 C',
      playCount: 100,
    }, 2),
  ];
  const snapshot = structuredClone(cards);

  const ranked = sortEntityCards(cards, '周杰伦');

  assert.deepEqual(ranked.map(({ id }) => id), [2, 3, 1]);
  assert.deepEqual(cards, snapshot);
});

test('constructs encoded search endpoints with bounded pagination defaults', () => {
  assert.equal(
    buildEntitySearchEndpoint('artist', ' 周杰伦 Jay ', { limit: 60, offset: 30 }),
    '/cloudsearch?keywords=%E5%91%A8%E6%9D%B0%E4%BC%A6+Jay&type=100&limit=60&offset=30',
  );
  assert.equal(
    buildEntitySearchEndpoint(10, '叶惠美', { cloud: false, limit: -1, offset: -5 }),
    '/search?keywords=%E5%8F%B6%E6%83%A0%E7%BE%8E&type=10&limit=30&offset=0',
  );
});

test('constructs metadata and track endpoints for every entity type', () => {
  assert.equal(buildEntityDetailEndpoint('artist', 6452), '/artists?id=6452');
  assert.equal(buildEntityDetailEndpoint('album', 18888), '/album?id=18888');
  assert.equal(
    buildEntityDetailEndpoint('playlist', '6792103822'),
    '/playlist/detail?id=6792103822',
  );

  assert.equal(
    buildEntityTracksEndpoint('artist', 6452),
    '/artist/top/song?id=6452',
  );
  assert.equal(buildEntityTracksEndpoint('album', 18888), '/album?id=18888');
  assert.equal(
    buildEntityTracksEndpoint('playlist', 6_792_103_822, { limit: 50, offset: 100 }),
    '/playlist/track/all?id=6792103822&limit=50&offset=100',
  );
  assert.throws(() => buildEntityDetailEndpoint('artist', ''), /id is required/);
});
