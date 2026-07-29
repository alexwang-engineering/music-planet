const DEFAULT_SAMPLE_CAPACITY = 360;
const DEFAULT_REPORT_INTERVAL_MS = 2000;

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function summarizeFrameSamples(frameIntervals, mainThreadTimes = []) {
  const frames = frameIntervals.filter(value => Number.isFinite(value) && value > 0);
  const cpu = mainThreadTimes.filter(value => Number.isFinite(value) && value >= 0);
  if (!frames.length) {
    return {
      deliveredFps: 0,
      estimatedRefreshHz: 0,
      averageFrameMs: 0,
      p95FrameMs: 0,
      p99MainThreadMs: 0,
      missedRefreshRatio: 0,
      sampleCount: 0,
    };
  }

  const sortedFrames = [...frames].sort((a, b) => a - b);
  const sortedCpu = [...cpu].sort((a, b) => a - b);
  const totalMs = frames.reduce((sum, value) => sum + value, 0);
  const medianFrameMs = percentile(sortedFrames, 0.5);
  const estimatedRefreshHz = medianFrameMs > 0 ? 1000 / medianFrameMs : 0;
  const refreshPeriodMs = estimatedRefreshHz > 0 ? 1000 / estimatedRefreshHz : 0;
  let missedRefreshes = 0;

  if (refreshPeriodMs > 0) {
    for (const interval of frames) {
      missedRefreshes += Math.max(0, Math.round(interval / refreshPeriodMs) - 1);
    }
  }

  return {
    deliveredFps: round(frames.length * 1000 / totalMs),
    estimatedRefreshHz: round(estimatedRefreshHz),
    averageFrameMs: round(totalMs / frames.length),
    p95FrameMs: round(percentile(sortedFrames, 0.95)),
    p99MainThreadMs: round(percentile(sortedCpu, 0.99)),
    missedRefreshRatio: round(missedRefreshes / Math.max(frames.length + missedRefreshes, 1), 4),
    sampleCount: frames.length,
  };
}

export function isPerformanceDebugEnabled(locationLike = globalThis.location, storage = globalThis.localStorage) {
  try {
    const query = new URLSearchParams(locationLike?.search || '');
    if (query.get('perf') === '1') return true;
    return storage?.getItem('nebula_perf_debug') === '1';
  } catch {
    return false;
  }
}

export class FrameBudgetMonitor {
  constructor({
    enabled = false,
    sampleCapacity = DEFAULT_SAMPLE_CAPACITY,
    reportIntervalMs = DEFAULT_REPORT_INTERVAL_MS,
    now = () => performance.now(),
  } = {}) {
    this.enabled = enabled;
    this.sampleCapacity = sampleCapacity;
    this.reportIntervalMs = reportIntervalMs;
    this.now = now;
    this.frameIntervals = new Float32Array(sampleCapacity);
    this.mainThreadTimes = new Float32Array(sampleCapacity);
    this.sampleCount = 0;
    this.sampleIndex = 0;
    this.lastFrameTimestamp = 0;
    this.frameWorkStartedAt = 0;
    this.lastReportAt = 0;
    this.longTaskCount = 0;
    this.lastSnapshot = summarizeFrameSamples([]);
    this.overlay = null;
    this.longTaskObserver = null;

    if (enabled) this.#startLongTaskObserver();
  }

  beginFrame(timestamp) {
    if (!this.enabled) return;
    this.frameWorkStartedAt = this.now();
    if (this.lastFrameTimestamp > 0) {
      this.frameIntervals[this.sampleIndex] = timestamp - this.lastFrameTimestamp;
    }
    this.lastFrameTimestamp = timestamp;
  }

  endFrame(renderer) {
    if (!this.enabled || this.lastFrameTimestamp <= 0) return;
    this.mainThreadTimes[this.sampleIndex] = Math.max(0, this.now() - this.frameWorkStartedAt);
    this.sampleIndex = (this.sampleIndex + 1) % this.sampleCapacity;
    this.sampleCount = Math.min(this.sampleCount + 1, this.sampleCapacity);

    if (this.lastFrameTimestamp - this.lastReportAt < this.reportIntervalMs) return;
    this.lastReportAt = this.lastFrameTimestamp;
    const frames = this.#orderedSamples(this.frameIntervals);
    const cpu = this.#orderedSamples(this.mainThreadTimes);
    const summary = summarizeFrameSamples(frames, cpu);
    const renderInfo = renderer?.info?.render;
    this.lastSnapshot = {
      ...summary,
      longTaskCount: this.longTaskCount,
      renderCalls: renderInfo?.calls ?? 0,
      triangles: renderInfo?.triangles ?? 0,
      points: renderInfo?.points ?? 0,
      targetUiFps: 90,
      targetVisualFps: 120,
      timestamp: Date.now(),
    };
    globalThis.__nebulaPerf = this.lastSnapshot;
    this.#renderOverlay();
  }

  resetTimestamp() {
    this.lastFrameTimestamp = 0;
    this.frameWorkStartedAt = 0;
  }

  destroy() {
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
    this.overlay?.remove();
    this.overlay = null;
  }

  #orderedSamples(buffer) {
    if (this.sampleCount < this.sampleCapacity) {
      return Array.from(buffer.slice(0, this.sampleCount));
    }
    return [
      ...buffer.slice(this.sampleIndex),
      ...buffer.slice(0, this.sampleIndex),
    ];
  }

  #startLongTaskObserver() {
    if (typeof PerformanceObserver !== 'function') return;
    try {
      this.longTaskObserver = new PerformanceObserver(entries => {
        this.longTaskCount += entries.getEntries().length;
      });
      this.longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch {
      this.longTaskObserver = null;
    }
  }

  #renderOverlay() {
    if (typeof document === 'undefined') return;
    if (!this.overlay) {
      this.overlay = document.createElement('output');
      this.overlay.id = 'perf-overlay';
      this.overlay.setAttribute('aria-live', 'off');
      this.overlay.style.cssText = [
        'position:fixed',
        'z-index:2000',
        'top:34px',
        'left:50%',
        'transform:translateX(-50%)',
        'padding:6px 10px',
        'border:1px solid rgba(255,255,255,.14)',
        'border-radius:999px',
        'background:rgba(4,4,12,.82)',
        'color:rgba(255,255,255,.82)',
        'font:11px/1.2 ui-monospace,SFMono-Regular,monospace',
        'font-variant-numeric:tabular-nums',
        'pointer-events:none',
        'backdrop-filter:blur(8px)',
      ].join(';');
      document.body.appendChild(this.overlay);
    }

    const snapshot = this.lastSnapshot;
    this.overlay.textContent =
      `${snapshot.deliveredFps.toFixed(1)} fps · ` +
      `p95 ${snapshot.p95FrameMs.toFixed(1)}ms · ` +
      `CPU p99 ${snapshot.p99MainThreadMs.toFixed(1)}ms · ` +
      `miss ${(snapshot.missedRefreshRatio * 100).toFixed(1)}%`;
  }
}
