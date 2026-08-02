import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateCenteredLyricScrollTop,
  findActiveLyricIndex,
} from '../app/lyric-sync.mjs';

test('selects the latest lyric timestamp at or before media time', () => {
  const lyrics = [
    { time: 2.1 },
    { time: 8.4 },
    { time: 11.25 },
    { time: 18.72 },
  ];

  assert.equal(findActiveLyricIndex(lyrics, 0), -1);
  assert.equal(findActiveLyricIndex(lyrics, 11.24), 1);
  assert.equal(findActiveLyricIndex(lyrics, 11.25), 2);
  assert.equal(findActiveLyricIndex(lyrics, 99), 3);
});

test('centres a lyric using scroll-container coordinates, not page offsetTop', () => {
  const target = calculateCenteredLyricScrollTop({
    scrollTop: 420,
    viewportTop: 286,
    viewportHeight: 300,
    contentHeight: 1800,
    lineTop: 436,
    lineHeight: 36,
  });

  // The line is 150px below the lyric viewport top, so it is already centred.
  // A page-relative offsetTop implementation would incorrectly add ~286px.
  assert.equal(target, 438);
});

test('clamps lyric scrolling at the beginning and end of the list', () => {
  assert.equal(calculateCenteredLyricScrollTop({
    scrollTop: 0,
    viewportTop: 300,
    viewportHeight: 240,
    contentHeight: 1000,
    lineTop: 310,
    lineHeight: 32,
  }), 0);

  assert.equal(calculateCenteredLyricScrollTop({
    scrollTop: 740,
    viewportTop: 300,
    viewportHeight: 240,
    contentHeight: 1000,
    lineTop: 510,
    lineHeight: 32,
  }), 760);
});
