/**
 * Pure playlist-library helpers.
 *
 * The NetEase `/user/playlist` response is not perfectly uniform across
 * accounts and API versions. This module turns that data into a small,
 * immutable renderer model, then performs all library filtering and sorting
 * locally. It intentionally has no DOM, storage, or network dependency.
 */

export const PLAYLIST_OWNERSHIP = Object.freeze({
  CREATED: 'created',
  COLLECTED: 'collected',
});

export const PLAYLIST_SORTS = Object.freeze({
  RECENT: 'recent',
  NAME: 'name',
  TRACK_COUNT: 'track-count',
});

export const PLAYLIST_GROUP_LABELS = Object.freeze({
  [PLAYLIST_OWNERSHIP.CREATED]: '我创建的',
  [PLAYLIST_OWNERSHIP.COLLECTED]: '我收藏的',
});

const UNKNOWN_PLAYLIST_NAME = '未命名歌单';
const UNKNOWN_CREATOR_NAME = '未知创建者';

const SORT_ALIASES = Object.freeze({
  recent: PLAYLIST_SORTS.RECENT,
  updated: PLAYLIST_SORTS.RECENT,
  update: PLAYLIST_SORTS.RECENT,
  'recent-update': PLAYLIST_SORTS.RECENT,
  updatetime: PLAYLIST_SORTS.RECENT,
  name: PLAYLIST_SORTS.NAME,
  title: PLAYLIST_SORTS.NAME,
  'track-count': PLAYLIST_SORTS.TRACK_COUNT,
  trackcount: PLAYLIST_SORTS.TRACK_COUNT,
  songs: PLAYLIST_SORTS.TRACK_COUNT,
  'song-count': PLAYLIST_SORTS.TRACK_COUNT,
  songcount: PLAYLIST_SORTS.TRACK_COUNT,
});

const displayCollator = new Intl.Collator('zh-Hans-CN-u-co-pinyin', {
  numeric: true,
  sensitivity: 'base',
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function asText(value) {
  if (value == null || typeof value === 'object') return '';
  return String(value).normalize('NFKC').trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

function finiteNumber(value) {
  if (typeof value === 'boolean' || value == null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = finiteNumber(value);
  return number == null ? fallback : Math.max(0, Math.trunc(number));
}

function nonNegativeNumber(value, fallback = 0) {
  const number = finiteNumber(value);
  return number == null ? fallback : Math.max(0, number);
}

function latestTimestamp(...values) {
  const timestamps = values
    .map(finiteNumber)
    .filter((value) => value != null && value >= 0);
  return timestamps.length ? Math.max(...timestamps) : 0;
}

function normalizeId(value) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = asText(value);
  return text || null;
}

function canonicalId(value) {
  const normalized = normalizeId(value);
  if (normalized == null) return '';

  const text = String(normalized).trim();
  if (/^[+-]?\d+$/.test(text)) {
    try {
      return BigInt(text).toString();
    } catch {
      // Fall through for an integer-looking value outside BigInt support.
    }
  }
  return text;
}

function idsEqual(left, right) {
  const normalizedLeft = canonicalId(left);
  const normalizedRight = canonicalId(right);
  return Boolean(normalizedLeft)
    && Boolean(normalizedRight)
    && normalizedLeft === normalizedRight;
}

function booleanValue(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    return value.trim().toLowerCase() === 'true' || value.trim() === '1';
  }
  return false;
}

function extractPlaylistRecords(input) {
  if (Array.isArray(input)) return input;
  const root = asObject(input);

  if (Array.isArray(root.playlist)) return root.playlist;
  if (Array.isArray(root.body?.playlist)) return root.body.playlist;
  if (Array.isArray(root.data?.playlist)) return root.data.playlist;
  return [];
}

function freezePlaylist(item) {
  return Object.freeze(item);
}

function freezeArray(items) {
  return Object.freeze(items);
}

/**
 * Normalizes Unicode width/case/diacritics and removes whitespace,
 * punctuation, and symbols for local playlist matching.
 */
export function normalizePlaylistText(value) {
  if (value == null) return '';

  return String(value)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function queryTokens(query) {
  if (query == null) return [];

  return [...new Set(
    String(query)
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .split(/[\p{P}\p{S}\s]+/u)
      .map(normalizePlaylistText)
      .filter(Boolean),
  )];
}

/**
 * Maps a single raw NetEase record to the library card contract.
 *
 * Ownership is deliberately derived from the active user id and creator id,
 * not from `subscribed`: API payloads can omit or disagree on that flag.
 */
export function normalizePlaylistRecord(
  rawRecord,
  { userId = null, sourceIndex = 0 } = {},
) {
  const record = asObject(rawRecord);
  const creator = asObject(record.creator);
  const primitiveCreator = typeof record.creator === 'string'
    ? record.creator
    : '';

  const creatorId = normalizeId(
    creator.userId
      ?? creator.id
      ?? record.creatorId
      ?? record.userId,
  );
  const creatorName = firstText(
    creator.nickname,
    creator.name,
    record.creatorName,
    primitiveCreator,
  ) || UNKNOWN_CREATOR_NAME;
  const name = firstText(record.name, record.title) || UNKNOWN_PLAYLIST_NAME;
  const isCreated = idsEqual(userId, creatorId);
  const ownership = isCreated
    ? PLAYLIST_OWNERSHIP.CREATED
    : PLAYLIST_OWNERSHIP.COLLECTED;

  return freezePlaylist({
    id: normalizeId(record.id ?? record.idStr),
    name,
    creatorId,
    creatorName,
    coverUrl: firstText(
      record.coverImgUrl,
      record.picUrl,
      record.imageUrl,
      record.coverUrl,
    ),
    trackCount: nonNegativeInteger(
      record.trackCount ?? record.songCount ?? record.size,
    ),
    updateTime: latestTimestamp(
      record.updateTime,
      record.trackUpdateTime,
      record.lastUpdateTime,
      record.createTime,
    ),
    createTime: nonNegativeNumber(record.createTime),
    playCount: nonNegativeNumber(record.playCount),
    description: firstText(record.description, record.desc),
    subscribed: booleanValue(record.subscribed),
    ownership,
    isCreated,
    sourceIndex: nonNegativeInteger(sourceIndex),
  });
}

/**
 * Accepts a record array or `{ playlist }`, `{ body: { playlist } }`, and
 * `{ data: { playlist } }` API response shapes.
 */
export function normalizePlaylistLibrary(input, { userId = null } = {}) {
  const records = extractPlaylistRecords(input);
  return freezeArray(records.map((record, sourceIndex) => (
    normalizePlaylistRecord(record, { userId, sourceIndex })
  )));
}

/**
 * Matches every query token against either the playlist name or creator name.
 * This supports queries such as "晴天 周杰伦" without a remote request.
 */
export function queryPlaylistLibrary(playlists, query = '') {
  const items = Array.isArray(playlists) ? playlists : [];
  const tokens = queryTokens(query);

  if (!tokens.length) return freezeArray([...items]);

  return freezeArray(items.filter((playlist) => {
    const name = normalizePlaylistText(playlist?.name);
    const creator = normalizePlaylistText(playlist?.creatorName);
    return tokens.every((token) => (
      name.includes(token) || creator.includes(token)
    ));
  }));
}

/**
 * Resolves UI and legacy sort values to one of the public sort constants.
 * Unknown values safely fall back to recent update.
 */
export function resolvePlaylistSort(value) {
  const normalized = asText(value)
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  return SORT_ALIASES[normalized] ?? PLAYLIST_SORTS.RECENT;
}

function compareText(left, right) {
  return displayCollator.compare(asText(left), asText(right));
}

function compareIds(left, right) {
  return displayCollator.compare(canonicalId(left), canonicalId(right));
}

function deterministicTie(left, right) {
  const byName = compareText(left?.name, right?.name);
  if (byName) return byName;

  const byCreator = compareText(left?.creatorName, right?.creatorName);
  if (byCreator) return byCreator;

  const byId = compareIds(left?.id, right?.id);
  if (byId) return byId;

  const leftSource = nonNegativeInteger(left?.sourceIndex);
  const rightSource = nonNegativeInteger(right?.sourceIndex);
  return leftSource - rightSource;
}

/**
 * Returns a new, frozen array. Defaults are:
 *   recent update -> descending
 *   name          -> ascending
 *   song count    -> descending
 */
export function sortPlaylistLibrary(playlists, sort = PLAYLIST_SORTS.RECENT) {
  const items = Array.isArray(playlists) ? playlists : [];
  const resolvedSort = resolvePlaylistSort(sort);

  const decorated = items.map((item, inputIndex) => ({ item, inputIndex }));
  decorated.sort((leftEntry, rightEntry) => {
    const left = leftEntry.item;
    const right = rightEntry.item;
    let compared = 0;

    if (resolvedSort === PLAYLIST_SORTS.NAME) {
      compared = compareText(left?.name, right?.name);
    } else if (resolvedSort === PLAYLIST_SORTS.TRACK_COUNT) {
      compared = nonNegativeInteger(right?.trackCount)
        - nonNegativeInteger(left?.trackCount);
    } else {
      compared = nonNegativeNumber(right?.updateTime)
        - nonNegativeNumber(left?.updateTime);
    }

    if (compared) return compared;

    const tied = deterministicTie(left, right);
    if (tied) return tied;

    // Explicit input position makes stability independent of engine details.
    return leftEntry.inputIndex - rightEntry.inputIndex;
  });

  return freezeArray(decorated.map(({ item }) => item));
}

/**
 * Groups already-normalized items in the UI's display order.
 */
export function groupPlaylistLibrary(playlists) {
  const items = Array.isArray(playlists) ? playlists : [];
  const created = [];
  const collected = [];

  for (const item of items) {
    if (item?.ownership === PLAYLIST_OWNERSHIP.CREATED) {
      created.push(item);
    } else {
      collected.push(item);
    }
  }

  const frozenCreated = freezeArray(created);
  const frozenCollected = freezeArray(collected);
  const counts = Object.freeze({
    total: items.length,
    created: frozenCreated.length,
    collected: frozenCollected.length,
  });
  const groups = freezeArray([
    Object.freeze({
      key: PLAYLIST_OWNERSHIP.CREATED,
      label: PLAYLIST_GROUP_LABELS[PLAYLIST_OWNERSHIP.CREATED],
      count: frozenCreated.length,
      items: frozenCreated,
    }),
    Object.freeze({
      key: PLAYLIST_OWNERSHIP.COLLECTED,
      label: PLAYLIST_GROUP_LABELS[PLAYLIST_OWNERSHIP.COLLECTED],
      count: frozenCollected.length,
      items: frozenCollected,
    }),
  ]);

  return Object.freeze({
    created: frozenCreated,
    collected: frozenCollected,
    groups,
    counts,
  });
}

/**
 * End-to-end local library preparation for the renderer.
 *
 * `counts.created` and `counts.collected` describe the visible result, while
 * `counts.allCreated` and `counts.allCollected` describe the full library.
 */
export function preparePlaylistLibrary(
  input,
  {
    userId = null,
    query = '',
    sort = PLAYLIST_SORTS.RECENT,
  } = {},
) {
  const allItems = normalizePlaylistLibrary(input, { userId });
  const allGroups = groupPlaylistLibrary(allItems);
  const resolvedSort = resolvePlaylistSort(sort);
  const visibleItems = sortPlaylistLibrary(
    queryPlaylistLibrary(allItems, query),
    resolvedSort,
  );
  const visibleGroups = groupPlaylistLibrary(visibleItems);

  return Object.freeze({
    query: asText(query),
    sort: resolvedSort,
    items: visibleItems,
    groups: visibleGroups.groups,
    counts: Object.freeze({
      total: allItems.length,
      visible: visibleItems.length,
      created: visibleGroups.counts.created,
      collected: visibleGroups.counts.collected,
      allCreated: allGroups.counts.created,
      allCollected: allGroups.counts.collected,
    }),
  });
}
