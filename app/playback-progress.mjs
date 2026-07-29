/**
 * Compositor-friendly playback progress.
 *
 * The controller interpolates media time from a monotonic clock and writes only
 * `transform: scaleX(...)` to the supplied fill element. It never reads layout.
 * Media events remain the source of truth: every seek, time update, duration
 * change, pause, and visibility change re-anchors the interpolation.
 */

const DEFAULT_PRECISION = 6;

export function clamp(value, minimum = 0, maximum = 1) {
  const lower = Math.min(minimum, maximum);
  const upper = Math.max(minimum, maximum);
  const numeric = Number(value);

  if (Number.isNaN(numeric)) return lower;
  return Math.min(upper, Math.max(lower, numeric));
}

export function progressRatio(currentTime, duration) {
  const total = Number(duration);
  if (!Number.isFinite(total) || total <= 0) return 0;

  const elapsed = Number(currentTime);
  if (Number.isNaN(elapsed) || elapsed === Number.NEGATIVE_INFINITY) return 0;
  return clamp(elapsed / total);
}

export function progressTransform(ratio, precision = DEFAULT_PRECISION) {
  const safePrecision = Math.round(clamp(precision, 0, 12));
  const normalized = Number(clamp(ratio).toFixed(safePrecision));
  return `scaleX(${normalized})`;
}

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export class PlaybackProgressController {
  constructor({
    media,
    target = null,
    onProgress = null,
    visibility = globalThis.document ?? null,
    now = defaultNow,
    requestAnimationFrame = globalThis.requestAnimationFrame?.bind(globalThis) ?? null,
    cancelAnimationFrame = globalThis.cancelAnimationFrame?.bind(globalThis) ?? null,
    reducedMotion = false,
    precision = DEFAULT_PRECISION,
  } = {}) {
    if (!media || typeof media.addEventListener !== 'function') {
      throw new TypeError('PlaybackProgressController requires an event-capable media element.');
    }
    if (!target?.style && typeof onProgress !== 'function') {
      throw new TypeError('PlaybackProgressController requires a styled target or onProgress callback.');
    }

    this.media = media;
    this.target = target;
    this.onProgress = onProgress;
    this.visibility = visibility;
    this.now = now;
    this.requestFrame = requestAnimationFrame;
    this.cancelFrame = cancelAnimationFrame;
    this.reducedMotion = Boolean(reducedMotion);
    this.precision = Math.round(clamp(precision, 0, 12));

    this.anchorMediaTime = 0;
    this.anchorTimestamp = 0;
    this.lastRenderedRatio = Number.NaN;
    this.frameId = null;
    this.destroyed = false;
    this.isSeeking = false;
    this.isStalled = false;

    this.listeners = [
      ['play', () => this.#resumeFromMedia()],
      ['playing', () => this.#resumeFromMedia()],
      ['pause', () => this.#stopAndSync()],
      ['ended', () => this.#stopAndSync()],
      ['seeking', () => {
        this.isSeeking = true;
        this.#stopAndSync();
      }],
      ['seeked', () => {
        this.isSeeking = false;
        this.sync();
      }],
      ['timeupdate', () => this.sync()],
      ['durationchange', () => this.sync()],
      ['loadedmetadata', () => this.sync()],
      ['ratechange', () => this.sync()],
      ['emptied', () => this.#stopAndSync()],
      ['waiting', () => {
        this.isStalled = true;
        this.#stopAndSync();
      }],
      ['stalled', () => {
        this.isStalled = true;
        this.#stopAndSync();
      }],
    ];

    for (const [type, listener] of this.listeners) {
      this.media.addEventListener(type, listener);
    }

    this.handleVisibilityChange = () => this.sync();
    this.visibility?.addEventListener?.('visibilitychange', this.handleVisibilityChange);

    this.sync();
  }

  sync() {
    if (this.destroyed) return this.snapshot();

    this.anchorMediaTime = this.#mediaTime();
    this.anchorTimestamp = this.#now();
    this.#render(this.anchorMediaTime);
    this.#reconcileFrame();
    return this.snapshot();
  }

  setReducedMotion(reducedMotion) {
    const nextValue = Boolean(reducedMotion);
    if (nextValue === this.reducedMotion || this.destroyed) return this.snapshot();

    this.reducedMotion = nextValue;
    return this.sync();
  }

  snapshot() {
    return {
      currentTime: this.anchorMediaTime,
      duration: this.#duration(),
      ratio: Number.isNaN(this.lastRenderedRatio) ? 0 : this.lastRenderedRatio,
      animating: this.frameId !== null,
      reducedMotion: this.reducedMotion,
      hidden: this.#isHidden(),
      destroyed: this.destroyed,
    };
  }

  destroy() {
    if (this.destroyed) return;

    this.destroyed = true;
    this.#cancelFrame();
    for (const [type, listener] of this.listeners) {
      this.media.removeEventListener(type, listener);
    }
    this.visibility?.removeEventListener?.('visibilitychange', this.handleVisibilityChange);
    this.listeners = [];
  }

  #resumeFromMedia() {
    this.isStalled = false;
    this.sync();
  }

  #stopAndSync() {
    this.#cancelFrame();
    this.sync();
  }

  #now() {
    const value = Number(this.now());
    return Number.isFinite(value) ? value : 0;
  }

  #duration() {
    const value = Number(this.media.duration);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  #mediaTime() {
    const duration = this.#duration();
    const value = Number(this.media.currentTime);
    if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? duration : 0;
    return clamp(value, 0, duration || Math.max(0, value));
  }

  #playbackRate() {
    const value = Number(this.media.playbackRate);
    return Number.isFinite(value) ? value : 1;
  }

  #isHidden() {
    return Boolean(
      this.visibility?.hidden
      || this.visibility?.visibilityState === 'hidden',
    );
  }

  #canAnimate() {
    return !this.destroyed
      && !this.reducedMotion
      && !this.#isHidden()
      && this.#duration() > 0
      && this.media.paused === false
      && this.media.ended !== true
      && this.media.seeking !== true
      && !this.isSeeking
      && !this.isStalled
      && this.#playbackRate() !== 0
      && typeof this.requestFrame === 'function'
      && typeof this.cancelFrame === 'function';
  }

  #estimatedMediaTime(timestamp) {
    const elapsedSeconds = Math.max(0, timestamp - this.anchorTimestamp) / 1000;
    return clamp(
      this.anchorMediaTime + elapsedSeconds * this.#playbackRate(),
      0,
      this.#duration(),
    );
  }

  #render(mediaTime) {
    const ratio = progressRatio(mediaTime, this.#duration());
    if (ratio === this.lastRenderedRatio) return;

    this.lastRenderedRatio = ratio;
    if (this.target?.style) {
      this.target.style.transform = progressTransform(ratio, this.precision);
    }
    this.onProgress?.(ratio, {
      currentTime: mediaTime,
      duration: this.#duration(),
    });
  }

  #reconcileFrame() {
    if (this.#canAnimate()) {
      this.#scheduleFrame();
    } else {
      this.#cancelFrame();
    }
  }

  #scheduleFrame() {
    if (this.frameId !== null || !this.#canAnimate()) return;
    this.frameId = this.requestFrame(() => {
      this.frameId = null;
      if (!this.#canAnimate()) return;

      const timestamp = this.#now();
      const estimatedTime = this.#estimatedMediaTime(timestamp);
      this.#render(estimatedTime);

      const rate = this.#playbackRate();
      const reachedBoundary = rate > 0
        ? estimatedTime >= this.#duration()
        : estimatedTime <= 0;
      if (!reachedBoundary) this.#scheduleFrame();
    });
  }

  #cancelFrame() {
    if (this.frameId === null) return;
    this.cancelFrame(this.frameId);
    this.frameId = null;
  }
}

export function createPlaybackProgressController(options) {
  return new PlaybackProgressController(options);
}
