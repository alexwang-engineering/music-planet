function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function findActiveLyricIndex(lyrics, currentTime) {
  if (!Array.isArray(lyrics) || lyrics.length === 0) return -1;

  const time = finiteNumber(currentTime, -1);
  let low = 0;
  let high = lyrics.length - 1;
  let activeIndex = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lyricTime = finiteNumber(lyrics[middle]?.time, Number.POSITIVE_INFINITY);
    if (lyricTime <= time) {
      activeIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return activeIndex;
}

export function calculateCenteredLyricScrollTop({
  scrollTop,
  viewportTop,
  viewportHeight,
  contentHeight,
  lineTop,
  lineHeight,
}) {
  const currentScrollTop = Math.max(0, finiteNumber(scrollTop));
  const visibleHeight = Math.max(0, finiteNumber(viewportHeight));
  const totalHeight = Math.max(visibleHeight, finiteNumber(contentHeight, visibleHeight));
  const visibleTop = finiteNumber(viewportTop);
  const activeLineTop = finiteNumber(lineTop, visibleTop);
  const activeLineHeight = Math.max(0, finiteNumber(lineHeight));

  // lineTop and viewportTop are viewport coordinates. Convert their delta back
  // into the scroll container's content coordinates before centring the line.
  const lineContentTop = currentScrollTop + activeLineTop - visibleTop;
  const centeredTop = lineContentTop - (visibleHeight - activeLineHeight) / 2;
  const maxScrollTop = Math.max(0, totalHeight - visibleHeight);

  return Math.max(0, Math.min(maxScrollTop, centeredTop));
}
