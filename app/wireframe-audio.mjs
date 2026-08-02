export const WIRE_BASS_MIN_HZ = 20;
export const WIRE_BASS_MAX_HZ = 180;
export const WIRE_BASS_ATTACK_SEC = 0.045;
export const WIRE_BASS_RELEASE_SEC = 0.220;
export const WIRE_MODE_TRANSITION_SEC = 0.080;

function clamp01(value) {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1);
}

export function resolveFrequencyBinRange({
  sampleRate,
  fftSize,
  frequencyBinCount,
  minHz = WIRE_BASS_MIN_HZ,
  maxHz = WIRE_BASS_MAX_HZ,
} = {}) {
  const safeSampleRate = Number(sampleRate);
  const safeFftSize = Number(fftSize);
  const safeBinCount = Math.max(0, Math.floor(Number(frequencyBinCount) || 0));
  if (!(safeSampleRate > 0) || !(safeFftSize > 0) || safeBinCount < 2) {
    return Object.freeze({ start: 0, end: -1, count: 0, hzPerBin: 0 });
  }

  const hzPerBin = safeSampleRate / safeFftSize;
  const lowerHz = Math.max(0, Math.min(Number(minHz) || 0, Number(maxHz) || 0));
  const upperHz = Math.max(lowerHz, Number(maxHz) || 0);
  const start = Math.min(safeBinCount - 1, Math.max(1, Math.ceil(lowerHz / hzPerBin)));
  const end = Math.max(start, Math.min(safeBinCount - 1, Math.floor(upperHz / hzPerBin)));
  return Object.freeze({ start, end, count: end - start + 1, hzPerBin });
}

export function calculateWireBassLevel(
  frequencyData,
  range,
  { noiseFloor = 0.045, usableRange = 0.50 } = {},
) {
  if (!frequencyData || !range || range.count <= 0) return 0;
  const start = Math.max(0, Math.floor(range.start));
  const end = Math.min(frequencyData.length - 1, Math.floor(range.end));
  if (end < start) return 0;

  let squareSum = 0;
  for (let index = start; index <= end; index += 1) {
    const value = Math.min(Math.max(Number(frequencyData[index]) || 0, 0), 255);
    squareSum += value * value;
  }
  const rms = Math.sqrt(squareSum / (end - start + 1)) / 255;
  const normalized = clamp01((rms - Math.max(0, noiseFloor)) / Math.max(usableRange, 0.001));
  return normalized ** 0.82;
}

export function smoothAttackRelease(
  current,
  target,
  deltaSeconds,
  attackSeconds = WIRE_BASS_ATTACK_SEC,
  releaseSeconds = WIRE_BASS_RELEASE_SEC,
) {
  const safeCurrent = clamp01(current);
  const safeTarget = clamp01(target);
  const delta = Math.max(0, Number(deltaSeconds) || 0);
  if (delta === 0 || safeCurrent === safeTarget) return safeCurrent;
  const timeConstant = safeTarget > safeCurrent
    ? Math.max(attackSeconds, 0.001)
    : Math.max(releaseSeconds, 0.001);
  return clamp01(safeCurrent + (safeTarget - safeCurrent) * (1 - Math.exp(-delta / timeConstant)));
}

export function smoothModeMix(
  current,
  active,
  deltaSeconds,
  timeConstant = WIRE_MODE_TRANSITION_SEC,
) {
  const safeCurrent = clamp01(current);
  const target = active ? 1 : 0;
  const delta = Math.max(0, Number(deltaSeconds) || 0);
  if (delta === 0 || safeCurrent === target) return safeCurrent;
  const next = safeCurrent + (target - safeCurrent)
    * (1 - Math.exp(-delta / Math.max(timeConstant, 0.001)));
  return Math.abs(target - next) < 0.001 ? target : clamp01(next);
}
