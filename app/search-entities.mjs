/**
 * Pure helpers for searching and presenting non-song NetEase entities.
 *
 * NeteaseCloudMusicApi 4.32.0 exposes these search response collections:
 *   100  -> result.artists   / result.artistCount
 *   10   -> result.albums    / result.albumCount
 *   1000 -> result.playlists / result.playlistCount
 *
 * This module intentionally has no DOM or network dependency. It accepts both
 * the HTTP-server response shape (`{ result }`) and the package request shape
 * (`{ body: { result } }`), and returns a stable card model for the renderer.
 */

export const ENTITY_TYPES = Object.freeze({
  ARTIST: 'artist',
  ALBUM: 'album',
  PLAYLIST: 'playlist',
});

export const ENTITY_SEARCH_TYPES = Object.freeze({
  [ENTITY_TYPES.ARTIST]: 100,
  [ENTITY_TYPES.ALBUM]: 10,
  [ENTITY_TYPES.PLAYLIST]: 1000,
});

export const ENTITY_RESULT_KEYS = Object.freeze({
  [ENTITY_TYPES.ARTIST]: Object.freeze({
    collection: 'artists',
    count: 'artistCount',
  }),
  [ENTITY_TYPES.ALBUM]: Object.freeze({
    collection: 'albums',
    count: 'albumCount',
  }),
  [ENTITY_TYPES.PLAYLIST]: Object.freeze({
    collection: 'playlists',
    count: 'playlistCount',
  }),
});

/**
 * Metadata-oriented detail endpoints.
 * Album detail also includes the album's songs in its response.
 */
export const ENTITY_DETAIL_PATHS = Object.freeze({
  [ENTITY_TYPES.ARTIST]: '/artists',
  [ENTITY_TYPES.ALBUM]: '/album',
  [ENTITY_TYPES.PLAYLIST]: '/playlist/detail',
});

/**
 * Track-oriented endpoints used when an entity card is opened for playback.
 */
export const ENTITY_TRACK_PATHS = Object.freeze({
  [ENTITY_TYPES.ARTIST]: '/artist/top/song',
  [ENTITY_TYPES.ALBUM]: '/album',
  [ENTITY_TYPES.PLAYLIST]: '/playlist/track/all',
});

const ENTITY_TYPE_BY_SEARCH_CODE = Object.freeze(Object.fromEntries(
  Object.entries(ENTITY_SEARCH_TYPES).map(([type, code]) => [String(code), type]),
));

const UNKNOWN_TITLES = Object.freeze({
  [ENTITY_TYPES.ARTIST]: '未知歌手',
  [ENTITY_TYPES.ALBUM]: '未知专辑',
  [ENTITY_TYPES.PLAYLIST]: '未知歌单',
});

const FALLBACK_SUBTITLES = Object.freeze({
  [ENTITY_TYPES.ARTIST]: '歌手',
  [ENTITY_TYPES.ALBUM]: '专辑',
  [ENTITY_TYPES.PLAYLIST]: '歌单',
});

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'object') return '';
  return String(value).normalize('NFKC').trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

function textList(value) {
  const values = Array.isArray(value)
    ? value
    : (value == null || value === '' ? [] : [value]);

  return [...new Set(values.map(asText).filter(Boolean))];
}

function artistNamesFrom(entity) {
  const values = Array.isArray(entity?.artists)
    ? entity.artists
    : (entity?.artist == null ? [] : [entity.artist]);

  return [...new Set(values.flatMap((artist) => {
    if (artist == null) return [];
    if (typeof artist === 'object') {
      return [firstText(artist.name, artist.title)];
    }
    return [asText(artist)];
  }).filter(Boolean))];
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function countValue(...values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number != null) return Math.max(0, Math.trunc(number));
  }
  return null;
}

function popularityValue(...values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number != null) return Math.max(0, number);
  }
  return 0;
}

function normalizeId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return String(value);
  const text = asText(value);
  return text || null;
}

function freezeCard(card) {
  return Object.freeze({
    ...card,
    aliases: Object.freeze(card.aliases),
    artistNames: Object.freeze(card.artistNames),
  });
}

/**
 * Normalizes Unicode width/case/diacritics and removes spacing, punctuation,
 * and symbols so Chinese and Latin entity names can use the same matcher.
 */
export function normalizeEntityText(value) {
  if (value == null) return '';

  return String(value)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

/**
 * Accepts semantic entity names as well as NetEase search type codes.
 */
export function resolveEntityType(value) {
  const normalized = asText(value).toLowerCase();
  const type = Object.values(ENTITY_TYPES).includes(normalized)
    ? normalized
    : ENTITY_TYPE_BY_SEARCH_CODE[normalized];

  if (!type) {
    throw new RangeError(`Unsupported entity type: ${asText(value) || String(value)}`);
  }

  return type;
}

/**
 * Converts a single raw artist/album/playlist object into the common card
 * contract. Missing values are represented by an empty string or null instead
 * of leaking `undefined` into renderer templates.
 */
export function normalizeEntityCard(entityType, rawEntity, sourceIndex = 0) {
  const type = resolveEntityType(entityType);
  const entity = rawEntity && typeof rawEntity === 'object' ? rawEntity : {};
  const aliases = textList(entity.alias ?? entity.alia ?? entity.transNames ?? entity.trans);
  const artistNames = artistNamesFrom(entity);
  const creatorName = firstText(
    entity.creator?.nickname,
    entity.creator?.name,
    entity.creatorName,
  );

  const title = firstText(entity.name, entity.title) || UNKNOWN_TITLES[type];
  const imageUrl = firstText(
    entity.picUrl,
    entity.coverImgUrl,
    entity.blurPicUrl,
    entity.img1v1Url,
    entity.imageUrl,
  );

  let subtitle = FALLBACK_SUBTITLES[type];
  let trackCount = null;
  let albumCount = null;
  let mvCount = null;
  let playCount = null;
  let subscriberCount = null;
  let popularity = 0;

  if (type === ENTITY_TYPES.ARTIST) {
    subtitle = aliases.join(' · ') || FALLBACK_SUBTITLES[type];
    trackCount = countValue(entity.musicSize, entity.trackCount, entity.songCount);
    albumCount = countValue(entity.albumSize, entity.albumCount);
    mvCount = countValue(entity.mvSize, entity.mvCount);
    popularity = popularityValue(
      entity.fansSize,
      entity.fanCount,
      entity.followCount,
      entity.popularity,
      entity.score,
    );
  } else if (type === ENTITY_TYPES.ALBUM) {
    subtitle = artistNames.join(' / ')
      || firstText(entity.company)
      || FALLBACK_SUBTITLES[type];
    trackCount = countValue(entity.size, entity.trackCount, entity.songCount);
    popularity = popularityValue(
      entity.popularity,
      entity.score,
      entity.subscribedCount,
      entity.commentCount,
    );
  } else {
    subtitle = creatorName || FALLBACK_SUBTITLES[type];
    trackCount = countValue(entity.trackCount, entity.songCount);
    playCount = countValue(entity.playCount);
    subscriberCount = countValue(
      entity.bookCount,
      entity.subscribedCount,
      entity.subscriberCount,
    );
    popularity = popularityValue(
      entity.playCount,
      entity.score,
      entity.bookCount,
      entity.subscribedCount,
    );
  }

  return freezeCard({
    id: normalizeId(entity.id ?? entity.idStr),
    type,
    title,
    subtitle,
    imageUrl,
    aliases,
    artistNames,
    creatorName,
    trackCount,
    albumCount,
    mvCount,
    playCount,
    subscriberCount,
    popularity,
    publishTime: finiteNumber(entity.publishTime),
    description: firstText(entity.description, entity.briefDesc),
    highQuality: Boolean(entity.highQuality),
    sourceIndex: Math.max(0, Math.trunc(finiteNumber(sourceIndex, 0))),
  });
}

function unwrapSearchResult(response) {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== 'object') return {};

  return response.body?.result
    ?? response.data?.result
    ?? response.result
    ?? response.body
    ?? response.data
    ?? response;
}

/**
 * Normalizes a complete search response without changing API order.
 */
export function normalizeEntitySearchResponse(response, entityType) {
  const type = resolveEntityType(entityType);
  const result = unwrapSearchResult(response);
  const { collection, count } = ENTITY_RESULT_KEYS[type];
  const rawItems = Array.isArray(result)
    ? result
    : (Array.isArray(result?.[collection]) ? result[collection] : []);

  const items = rawItems
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .filter(({ item }) => item && typeof item === 'object')
    .map(({ item, sourceIndex }) => normalizeEntityCard(type, item, sourceIndex));

  const responseTotal = Array.isArray(result) ? null : countValue(result?.[count]);
  const total = Math.max(items.length, responseTotal ?? items.length);

  return Object.freeze({
    type,
    total,
    items: Object.freeze(items),
  });
}

function matchTier(card, normalizedQuery) {
  if (!normalizedQuery) return 0;

  const candidates = [
    card?.title,
    ...(Array.isArray(card?.aliases) ? card.aliases : []),
    ...(Array.isArray(card?.artistNames) ? card.artistNames : []),
    card?.creatorName,
  ].map(normalizeEntityText).filter(Boolean);

  if (candidates.some((candidate) => candidate === normalizedQuery)) return 3;
  if (candidates.some((candidate) => candidate.startsWith(normalizedQuery))) return 2;
  if (candidates.some((candidate) => candidate.includes(normalizedQuery))) return 1;
  return 0;
}

/**
 * Returns a new array ordered by exact, prefix, then contains match; popularity
 * is the next tiebreaker, followed explicitly by original API order.
 */
export function sortEntityCards(cards, query) {
  const normalizedQuery = normalizeEntityText(query);
  const input = Array.isArray(cards) ? cards : [];

  return Object.freeze(input
    .map((card, inputIndex) => ({
      card,
      inputIndex,
      match: matchTier(card, normalizedQuery),
      popularity: popularityValue(card?.popularity),
      sourceIndex: countValue(card?.sourceIndex) ?? inputIndex,
    }))
    .sort((left, right) => (
      right.match - left.match
      || right.popularity - left.popularity
      || left.sourceIndex - right.sourceIndex
      || left.inputIndex - right.inputIndex
    ))
    .map(({ card }) => card));
}

/**
 * Convenience composition for renderer code: normalize, then rank.
 */
export function prepareEntitySearchResults(response, entityType, query = '') {
  const normalized = normalizeEntitySearchResponse(response, entityType);
  return Object.freeze({
    ...normalized,
    query: asText(query),
    items: sortEntityCards(normalized.items, query),
  });
}

function positiveInteger(value, fallback) {
  const number = finiteNumber(value);
  if (number == null || number <= 0) return fallback;
  return Math.max(1, Math.trunc(number));
}

function nonNegativeInteger(value, fallback = 0) {
  const number = finiteNumber(value);
  if (number == null || number < 0) return fallback;
  return Math.max(0, Math.trunc(number));
}

function endpointId(id) {
  const normalized = normalizeId(id);
  if (normalized == null || normalized === '') {
    throw new TypeError('Entity id is required');
  }
  return encodeURIComponent(String(normalized));
}

/**
 * Builds a `/cloudsearch` URL by default. Set `{ cloud: false }` to use the
 * legacy `/search` route.
 */
export function buildEntitySearchEndpoint(entityType, query, options = {}) {
  const type = resolveEntityType(entityType);
  const path = options?.cloud === false ? '/search' : '/cloudsearch';
  const params = new URLSearchParams({
    keywords: asText(query),
    type: String(ENTITY_SEARCH_TYPES[type]),
    limit: String(positiveInteger(options?.limit, 30)),
    offset: String(nonNegativeInteger(options?.offset)),
  });

  return `${path}?${params.toString()}`;
}

/**
 * Builds the metadata detail URL for an entity.
 */
export function buildEntityDetailEndpoint(entityType, id) {
  const type = resolveEntityType(entityType);
  return `${ENTITY_DETAIL_PATHS[type]}?id=${endpointId(id)}`;
}

/**
 * Builds the endpoint that returns playable tracks for an entity. Artist and
 * album routes return their complete bounded payloads; playlist pagination is
 * explicit to keep large collections under renderer control.
 */
export function buildEntityTracksEndpoint(entityType, id, options = {}) {
  const type = resolveEntityType(entityType);
  const base = `${ENTITY_TRACK_PATHS[type]}?id=${endpointId(id)}`;

  if (type !== ENTITY_TYPES.PLAYLIST) return base;

  const limit = positiveInteger(options?.limit, 200);
  const offset = nonNegativeInteger(options?.offset);
  return `${base}&limit=${limit}&offset=${offset}`;
}
