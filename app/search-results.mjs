/**
 * Pure search-result quality helpers for Nebula.
 *
 * Browser integration (from a `<script type="module">`):
 *
 *   import {
 *     prepareSearchResults,
 *     SEARCH_FILTERS,
 *   } from './search-results.mjs';
 *
 *   const groups = prepareSearchResults(apiSongs, query, {
 *     filter: SEARCH_FILTERS.ALL,
 *     isPlayable: (song) => !(song.fee > 0 && !sessionCookie),
 *   });
 *
 * Every returned group exposes `song` (the preferred source), `sources`,
 * `sourceCount`, `duplicateCount` (extra sources), `variant`, `playable`,
 * `isCollaboration`, and source-order metadata. Inputs are never mutated.
 */

export const SEARCH_FILTERS = Object.freeze({
  ALL: 'all',
  ORIGINAL: 'original',
  LIVE: 'live',
  COLLABORATION: 'collaboration',
  PLAYABLE: 'playable',
});

export const SONG_VARIANT_TYPES = Object.freeze({
  ORIGINAL: 'original',
  LIVE: 'live',
  REMIX: 'remix',
  COVER: 'cover',
  INSTRUMENTAL: 'instrumental',
  ACCOMPANIMENT: 'accompaniment',
  VERSION: 'version',
});

const DEFAULT_DURATION_TOLERANCE_MS = 3_000;

const VARIANT_DEFINITIONS = Object.freeze([
  {
    type: SONG_VARIANT_TYPES.ACCOMPANIMENT,
    label: '伴奏',
    patterns: [
      /伴奏|卡拉\s*ok|消音(?:版)?/iu,
      /\b(?:karaoke|backing[\s-]*track|off[\s-]*vocal)\b/iu,
    ],
  },
  {
    type: SONG_VARIANT_TYPES.INSTRUMENTAL,
    label: '纯音乐',
    patterns: [
      /纯音乐|纯乐|器乐(?:版)?|无歌词(?:版)?/u,
      /\b(?:instrumental|inst\.?)(?:\s+version)?\b/iu,
    ],
  },
  {
    type: SONG_VARIANT_TYPES.COVER,
    label: '翻唱',
    patterns: [
      /翻唱|翻奏|致敬(?:版)?/u,
      /\b(?:cover(?:ed)?|tribute)\b/iu,
    ],
  },
  {
    type: SONG_VARIANT_TYPES.LIVE,
    label: '现场',
    patterns: [
      /现场(?:版)?|演唱会(?:版)?|音乐会(?:版)?|巡演(?:版)?|不插电(?:版)?/u,
      /\b(?:live|concert|unplugged)\b/iu,
    ],
  },
  {
    type: SONG_VARIANT_TYPES.REMIX,
    label: '混音',
    patterns: [
      /重混(?:版)?|混音(?:版)?|舞曲(?:版)?|dj\s*版/iu,
      /\b(?:re[\s-]?mix|club[\s-]*mix|dance[\s-]*mix)\b/iu,
    ],
  },
  {
    type: SONG_VARIANT_TYPES.VERSION,
    label: '版本',
    patterns: [
      /原声(?:版)?|木吉他(?:版)?|钢琴(?:版)?|样带(?:版)?|重制(?:版)?|加速(?:版)?|慢速(?:版)?/u,
      /\b(?:acoustic|demo|remaster(?:ed)?|radio[\s-]*edit|extended|sped[\s-]*up|slowed|mono|stereo)\b/iu,
    ],
  },
]);

const VARIANT_LABELS = Object.freeze(Object.fromEntries(
  VARIANT_DEFINITIONS.map(({ type, label }) => [type, label]),
));

const GENERIC_VERSION_PATTERN = /(?:versions?|ver\.?|版本|版)/giu;
const COLLABORATION_PATTERN = /\b(?:feat(?:uring)?|ft)\.?\b|合唱|对唱|\bduet\b/iu;

/**
 * Canonical text used by search matching and identity keys.
 * It applies Unicode width/case/diacritic folding and removes punctuation,
 * symbols, and whitespace. It intentionally does not translate words.
 */
export function normalizeSearchText(value) {
  if (value == null) return '';

  return String(value)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function hasVariantMarker(value) {
  return VARIANT_DEFINITIONS.some(({ patterns }) => (
    patterns.some((pattern) => pattern.test(value))
  ));
}

function extractTitleParts(value) {
  const original = value == null ? '' : String(value).normalize('NFKC').trim();
  const qualifiers = [];

  let base = original.replace(
    /[\(\[（【{]([^)\]）】}]{1,100})[\)\]）】}]/gu,
    (whole, inner) => {
      if (!hasVariantMarker(inner)) return ` ${inner} `;
      qualifiers.push(inner);
      return ' ';
    },
  );

  // A delimited suffix often carries a source/API version label.
  const delimitedSuffix = base.match(/^(.*\S)\s*[-–—:：|]\s*([^-–—:：|]+)$/u);
  if (delimitedSuffix && hasVariantMarker(delimitedSuffix[2])) {
    base = delimitedSuffix[1];
    qualifiers.push(delimitedSuffix[2]);
  }

  // Also recognize common undelimited terminal labels ("晴天 Live",
  // "晴天现场版"). Requiring a non-empty title prefix avoids treating a song
  // genuinely named "Live" as a version of an empty title.
  const terminalSuffixPatterns = [
    /^(.*?\S)\s+((?:\d{2,4}\s*)?(?:live|concert|unplugged|remix|cover|instrumental|inst\.?|karaoke|acoustic|demo|remastered?)(?:\s+(?:version|edit))?)$/iu,
    /^(.*?\S)((?:live|concert|unplugged|remix|cover|instrumental|karaoke|acoustic|demo|remastered?)\s*(?:versions?|ver\.?|版))$/iu,
    /^(.*?\S?)((?:\d{2,4})?(?:现场(?:版)?|演唱会(?:版)?|音乐会(?:版)?|巡演(?:版)?|混音(?:版)?|重混(?:版)?|dj\s*版|翻唱(?:版)?|翻奏(?:版)?|伴奏(?:版)?|纯音乐(?:版)?|器乐(?:版)?|不插电(?:版)?|样带(?:版)?|重制(?:版)?))$/iu,
  ];

  for (const pattern of terminalSuffixPatterns) {
    const match = base.trim().match(pattern);
    if (!match || !match[1].trim() || !hasVariantMarker(match[2])) continue;
    base = match[1];
    qualifiers.push(match[2]);
    break;
  }

  return {
    original,
    baseTitle: normalizeSearchText(base) || normalizeSearchText(original),
    normalizedTitle: normalizeSearchText(original),
    qualifiers,
  };
}

/**
 * Returns the normalized base title, excluding recognized version qualifiers.
 * Unrecognized parenthetical text is retained so meaningful names do not merge.
 */
export function normalizeSongTitle(value) {
  return extractTitleParts(value).baseTitle;
}

function artistValues(input) {
  let candidates = input;

  if (!Array.isArray(candidates)) {
    if (candidates && typeof candidates === 'object') {
      candidates = candidates.artists
        ?? candidates.ar
        ?? candidates.artist
        ?? candidates.artistNames
        ?? [];
    } else {
      candidates = candidates == null ? [] : [candidates];
    }
  }

  if (!Array.isArray(candidates)) candidates = [candidates];

  return candidates.flatMap((artist) => {
    if (artist == null) return [];
    if (typeof artist === 'string' || typeof artist === 'number') return [String(artist)];
    if (typeof artist !== 'object') return [];
    return [artist.name ?? artist.artistName ?? artist.title ?? ''];
  });
}

/**
 * Returns a sorted, de-duplicated normalized artist set. Artist API order does
 * not affect recording identity; a genuinely different set remains distinct.
 */
export function normalizeArtistSet(input) {
  return [...new Set(
    artistValues(input)
      .map(normalizeSearchText)
      .filter(Boolean),
  )].sort();
}

function songTitle(songOrTitle) {
  if (songOrTitle && typeof songOrTitle === 'object') {
    return songOrTitle.name ?? songOrTitle.title ?? songOrTitle.songName ?? '';
  }
  return songOrTitle ?? '';
}

function explicitVariantValues(songOrTitle) {
  if (!songOrTitle || typeof songOrTitle !== 'object') return [];

  return [
    songOrTitle.version,
    songOrTitle.versionName,
    songOrTitle.variant,
    songOrTitle.variantName,
  ].filter((value) => typeof value === 'string' && value.trim());
}

function matchingVariantTypes(values) {
  return VARIANT_DEFINITIONS
    .filter(({ patterns }) => values.some((value) => (
      patterns.some((pattern) => pattern.test(value))
    )))
    .map(({ type }) => type);
}

function qualifierDetail(value) {
  let detail = String(value).normalize('NFKC');

  for (const { patterns } of VARIANT_DEFINITIONS) {
    for (const pattern of patterns) {
      detail = detail.replace(new RegExp(pattern.source, `${pattern.flags}g`), ' ');
    }
  }

  return normalizeSearchText(detail.replace(GENERIC_VERSION_PATTERN, ' '));
}

/**
 * Classifies version markers and returns a canonical descriptor:
 * `{ type, tags, label, signature, baseTitle, normalizedTitle, isOriginal }`.
 * `tags` preserves compound variants (for example, a Live Remix), while
 * `signature` retains meaningful qualifier details such as concert years.
 */
export function classifySongVariant(songOrTitle) {
  const title = songTitle(songOrTitle);
  const titleParts = extractTitleParts(title);
  const qualifierValues = [
    ...titleParts.qualifiers,
    ...explicitVariantValues(songOrTitle),
  ];
  const tags = matchingVariantTypes(qualifierValues);
  const details = [...new Set(
    qualifierValues.map(qualifierDetail).filter(Boolean),
  )].sort();
  const isOriginal = tags.length === 0;
  const type = isOriginal ? SONG_VARIANT_TYPES.ORIGINAL : tags[0];
  const signature = isOriginal
    ? SONG_VARIANT_TYPES.ORIGINAL
    : `${tags.join('+')}${details.length ? `:${details.join('+')}` : ''}`;

  return Object.freeze({
    type,
    tags: Object.freeze(tags),
    label: isOriginal ? '原版' : tags.map((tag) => VARIANT_LABELS[tag]).join(' · '),
    signature,
    baseTitle: titleParts.baseTitle,
    normalizedTitle: titleParts.normalizedTitle,
    isOriginal,
  });
}

function durationMs(song) {
  const value = song?.durationMs ?? song?.duration ?? song?.dt;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function album(song) {
  return song?.al ?? song?.album ?? {};
}

function albumName(song) {
  return normalizeSearchText(album(song)?.name ?? album(song)?.title ?? '');
}

function coverUrl(song) {
  return album(song)?.picUrl
    ?? album(song)?.coverUrl
    ?? album(song)?.image
    ?? song?.picUrl
    ?? song?.coverUrl
    ?? '';
}

function popularity(song) {
  const value = song?.popularity ?? song?.pop ?? song?.score ?? 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * Conservative default playability detection. `fee` alone is deliberately not
 * treated as unavailable because it depends on the current account. Pass an
 * `isPlayable(song)` callback when session-aware availability is known.
 */
export function isSongPlayable(song, resolver) {
  if (typeof resolver === 'function') return Boolean(resolver(song));
  if (song?.playable === false || song?.available === false) return false;
  if (song?.noCopyrightRcmd) return false;
  if (Number(song?.st) < 0 || Number(song?.privilege?.st) < 0) return false;
  if (song?.privilege && Number(song.privilege.pl) === 0 && Number(song.privilege.fee) === 0) {
    return false;
  }
  return true;
}

function metadataCompleteness(song) {
  const artists = normalizeArtistSet(song);
  return [
    Boolean(normalizeSearchText(songTitle(song))),
    artists.length > 0,
    durationMs(song) != null,
    Boolean(albumName(song)),
    song?.id != null && song.id !== '',
  ].reduce((sum, complete) => sum + Number(complete), 0);
}

function compareSourceEntries(left, right, resolver) {
  const leftPlayable = isSongPlayable(left.song, resolver);
  const rightPlayable = isSongPlayable(right.song, resolver);
  if (leftPlayable !== rightPlayable) return leftPlayable ? -1 : 1;

  const completenessDifference = metadataCompleteness(right.song) - metadataCompleteness(left.song);
  if (completenessDifference) return completenessDifference;

  const leftCover = Boolean(coverUrl(left.song));
  const rightCover = Boolean(coverUrl(right.song));
  if (leftCover !== rightCover) return leftCover ? -1 : 1;

  const popularityDifference = popularity(right.song) - popularity(left.song);
  if (popularityDifference) return popularityDifference;

  return left.index - right.index;
}

function isCollaboration(song, artists) {
  return artists.length > 1 || COLLABORATION_PATTERN.test(songTitle(song));
}

function identityFor(entry) {
  const variant = classifySongVariant(entry.song);
  const artists = normalizeArtistSet(entry.song);
  const fallbackId = entry.song?.id ?? entry.index;
  const safeTitle = variant.baseTitle || `unknown-title:${fallbackId}`;
  const artistSignature = artists.join('|') || `unknown-artist:${fallbackId}`;

  return {
    ...entry,
    artists,
    artistSignature,
    variant,
    durationMs: durationMs(entry.song),
    coarseKey: `${safeTitle}::${artistSignature}::${variant.signature}`,
  };
}

function createWorkingGroup(entry) {
  return {
    entries: [entry],
    knownDurations: entry.durationMs == null ? [] : [entry.durationMs],
    coarseKey: entry.coarseKey,
  };
}

function groupAcceptsDuration(group, candidateDuration, tolerance) {
  if (candidateDuration == null || group.knownDurations.length === 0) return true;
  const minimum = Math.min(...group.knownDurations, candidateDuration);
  const maximum = Math.max(...group.knownDurations, candidateDuration);
  return maximum - minimum <= tolerance;
}

function addToWorkingGroup(group, entry) {
  group.entries.push(entry);
  if (entry.durationMs != null) group.knownDurations.push(entry.durationMs);
}

function sameExplicitId(group, entry) {
  if (entry.song?.id == null) return false;
  return group.entries.some(({ song }) => (
    song?.id != null && String(song.id) === String(entry.song.id)
  ));
}

function closestDurationDistance(group, candidateDuration) {
  if (candidateDuration == null || group.knownDurations.length === 0) return 0;
  return Math.min(...group.knownDurations.map((value) => (
    Math.abs(value - candidateDuration)
  )));
}

function finalizeGroup(group, resolver) {
  const orderedEntries = group.entries.slice().sort((left, right) => left.index - right.index);
  const preferred = orderedEntries.slice().sort((left, right) => (
    compareSourceEntries(left, right, resolver)
  ))[0];
  const first = orderedEntries[0];
  const sources = orderedEntries.map(({ song }) => song);
  const knownDurations = orderedEntries
    .map((entry) => entry.durationMs)
    .filter((value) => value != null);

  return Object.freeze({
    key: `${group.coarseKey}::${knownDurations.length ? Math.min(...knownDurations) : 'unknown'}`,
    song: preferred.song,
    sources: Object.freeze(sources),
    sourceIndices: Object.freeze(orderedEntries.map(({ index }) => index)),
    sourceCount: sources.length,
    duplicateCount: Math.max(0, sources.length - 1),
    originalIndex: first.index,
    artists: Object.freeze(first.artists.slice()),
    artistSignature: first.artistSignature,
    variant: first.variant,
    durationMs: preferred.durationMs,
    playable: orderedEntries.some(({ song }) => isSongPlayable(song, resolver)),
    isCollaboration: orderedEntries.some(({ song, artists }) => isCollaboration(song, artists)),
    popularity: Math.max(...orderedEntries.map(({ song }) => popularity(song))),
  });
}

/**
 * Groups likely duplicate recordings by normalized base title, exact artist
 * set, version signature, and duration range. The default tolerance is 3s.
 *
 * Unknown-duration sources join only an unambiguous identity bucket (or an
 * exact song ID), preventing them from bridging multiple real recordings.
 */
export function groupSearchResults(songs, options = {}) {
  if (!Array.isArray(songs)) return [];

  const toleranceCandidate = Number(options.durationToleranceMs);
  const tolerance = Number.isFinite(toleranceCandidate) && toleranceCandidate >= 0
    ? toleranceCandidate
    : DEFAULT_DURATION_TOLERANCE_MS;
  const resolver = options.isPlayable;
  const entries = songs.map((candidate, index) => (
    identityFor({ song: candidate, index })
  ));
  const buckets = new Map();

  // Establish concrete duration clusters before attaching incomplete sources.
  for (const entry of entries.filter((candidate) => candidate.durationMs != null)) {
    const groups = buckets.get(entry.coarseKey) ?? [];
    const exactIdGroup = groups.find((group) => sameExplicitId(group, entry));
    const compatibleGroups = groups
      .filter((group) => groupAcceptsDuration(group, entry.durationMs, tolerance))
      .sort((left, right) => (
        closestDurationDistance(left, entry.durationMs)
        - closestDurationDistance(right, entry.durationMs)
      ));
    const target = exactIdGroup ?? compatibleGroups[0];

    if (target) addToWorkingGroup(target, entry);
    else groups.push(createWorkingGroup(entry));
    buckets.set(entry.coarseKey, groups);
  }

  for (const entry of entries.filter((candidate) => candidate.durationMs == null)) {
    const groups = buckets.get(entry.coarseKey) ?? [];
    const exactIdGroup = groups.find((group) => sameExplicitId(group, entry));
    const target = exactIdGroup ?? (groups.length === 1 ? groups[0] : null);

    if (target) addToWorkingGroup(target, entry);
    else groups.push(createWorkingGroup(entry));
    buckets.set(entry.coarseKey, groups);
  }

  return [...buckets.values()]
    .flat()
    .map((group) => finalizeGroup(group, resolver))
    .sort((left, right) => left.originalIndex - right.originalIndex);
}

function rankingTuple(group, query) {
  const preferredTitle = classifySongVariant(group.song);
  const soleExactArtist = Boolean(query)
    && group.artists.length === 1
    && group.artists[0] === query;
  const artistSetIncludes = Boolean(query) && group.artists.includes(query);
  const exactTitle = Boolean(query)
    && (preferredTitle.baseTitle === query || preferredTitle.normalizedTitle === query);

  return [
    Number(soleExactArtist),
    Number(artistSetIncludes),
    Number(exactTitle),
    Number(group.variant.isOriginal),
    Number(group.playable),
    group.popularity,
  ];
}

/**
 * Returns a stable ranked copy. Priority is lexicographic:
 * sole exact artist, artist-set inclusion, exact title, original, playable,
 * popularity, API order. This keeps collaborations visible while preferring
 * the queried artist's solo catalogue.
 */
export function rankSearchResults(groups, query) {
  if (!Array.isArray(groups)) return [];
  const normalizedQuery = normalizeSearchText(query);

  return groups
    .map((group, position) => ({
      group,
      position,
      tuple: rankingTuple(group, normalizedQuery),
    }))
    .sort((left, right) => {
      for (let index = 0; index < left.tuple.length; index += 1) {
        if (left.tuple[index] !== right.tuple[index]) {
          return right.tuple[index] - left.tuple[index];
        }
      }
      return left.group.originalIndex - right.group.originalIndex
        || left.position - right.position;
    })
    .map(({ group }) => group);
}

/**
 * Filters grouped results using one of SEARCH_FILTERS. Compound variants match
 * any corresponding tag, and "original" means no recognized version marker.
 */
export function filterSearchResults(groups, filter = SEARCH_FILTERS.ALL) {
  if (!Array.isArray(groups)) return [];

  switch (filter) {
    case SEARCH_FILTERS.ALL:
      return groups.slice();
    case SEARCH_FILTERS.ORIGINAL:
      return groups.filter((group) => group.variant.isOriginal);
    case SEARCH_FILTERS.LIVE:
      return groups.filter((group) => group.variant.tags.includes(SONG_VARIANT_TYPES.LIVE));
    case SEARCH_FILTERS.COLLABORATION:
      return groups.filter((group) => group.isCollaboration);
    case SEARCH_FILTERS.PLAYABLE:
      return groups.filter((group) => group.playable);
    default:
      throw new RangeError(`Unknown search-result filter: ${String(filter)}`);
  }
}

/**
 * Convenience pipeline: group duplicates, rank them, then apply a category.
 */
export function prepareSearchResults(songs, query, options = {}) {
  const groups = groupSearchResults(songs, options);
  const ranked = rankSearchResults(groups, query);
  return filterSearchResults(ranked, options.filter ?? SEARCH_FILTERS.ALL);
}
