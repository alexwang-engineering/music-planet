# Phase A — Multi-Band Spatial Frequency Mapping

## Status
Spec for execution agent (Codex). Author: architect review pass, not implementation.
Branch: `visualizer/audio-reactive-expansion`. Base commit: `01963db`
(`codex/nebula-smooth-evolution` — rebased onto this after it landed; see git log for
the full lineage including the `1f4bc12`/`5ef2b57` beat-sync tuning this depends on).
Part of a 4-phase roadmap (A → B → C → D). **This spec covers Phase A only.**

## Goal
Replace the current 3–4 uniform-scalar frequency bands (bass/mid/high/brightness,
applied *uniformly across the whole sphere surface*) with an 8–12 band system where
each band drives a **distinct spatial region** of the icosahedron, so the sphere's
displacement visibly tracks *where in the frequency spectrum* the music's energy is,
not just *how much* energy there is overall.

## Build on existing prior art — do not invent a parallel mechanism
`app/index.html` already has a **dead, minimal prototype** of exactly this idea, in the
sphere's vertex shader:

```glsl
// line 2057-2058
float poleAxis = abs(normalize(position).y);
float equAxis  = 1.0 - poleAxis;
```

`poleAxis` is computed but **never consumed** — only `equAxis` is used, in exactly one
place (line 2069), weighting the high-band noise term more strongly at the equator.
This is a real, working, 2-region (pole vs. equator), single-axis (`position.y`)
spatial mapping that was clearly headed toward what this phase formalizes. **Generalize
this mechanism to N bands — do not build a second, separate spatial-mapping system.**
`poleAxis`'s dead-code status should resolve naturally once it's part of the general
band-lookup, not be left unused.

## Current audio pipeline (context, unchanged by this phase)
- `AnalyserNode`: `fftSize = 1024` (512 usable bins), `smoothingTimeConstant = 0.15`
  (both tuned this session for beat-sync latency — commits `1f4bc12`, `5ef2b57`. Do not
  revert these.)
- `updateAudio()` (line 3050) currently splits `dataArray` into bass (0–6% of bins) /
  mid (6–30%) / high (30–70%) / brightness (70–100%), each with its own hand-tuned
  attack/release envelope follower (`_sfAtkBass`/`_sfRelBass`, etc. — see line 3548).
  **These four bands and every subsystem they drive (rings, comets, particles, camera
  shake, glow, halo, orbit rings, mini-EQ bars, beat detection itself) must remain
  numerically untouched.** The new N-band system is additive, feeding only the new
  spatial-shader feature. Do not refactor the existing bass/mid/high/brightness
  variables to be *derived from* the new bands in this phase — that's a
  later-phase cleanup at best, and out of scope here. Two systems computed
  independently, side by side, is the correct scope for Phase A.
- Sphere shader uniforms are set once per frame in `animate()` at line 3576–3581
  (`sphereMat.uniforms.uBass.value = ...`, etc.). New uniforms go here.
- The `prefers-reduced-motion` branch that zeroes these uniforms for a static frame
  starts at line 3451 (`const reducedVisualMotion = reducedMotionQuery.matches`).

**Line numbers above are as of commit `01963db` on `codex/nebula-smooth-evolution`
(this branch's current base). Re-verify with `grep -n` before relying on them if this
branch has moved further — do not trust stale references from an older checkout.**

## Design

### 1. New module: `app/audio-bands.mjs`
Pure, unit-tested functions — no DOM/Web Audio API references, following the existing
convention (`layout-mode.mjs`, `search-results.mjs`, `queue-actions.mjs`, etc.).

```js
// Indicative interface — implement, don't just stub:

// Returns `bandCount + 1` bin-index boundaries. Log-spaced, not linear-percentage
// like the current 4-band split — a linear split under-resolves the perceptually
// dense low-mid region and wastes bands on the sparse top octaves. Anchor the log
// curve so band 0 still starts at the existing bass floor (bin 0) and the top band
// still ends at bin `binCount` (matches current bass/brightness boundary behavior).
export function computeBandBoundaries(binCount, bandCount) { /* ... */ }

// Sums dataArray into bandCount buckets using the boundaries above. Same shape as
// the existing bassSum/midSum/highSum loop, generalized.
export function computeBandLevels(dataArray, boundaries) { /* ... */ }

// Per-band attack/release time constants (ms), interpolated across the band range
// from the existing bass constants (fast attack ~80ms / slow release ~300ms) to the
// existing treble constants (slower attack ~180ms / faster release ~660ms) — match
// the *existing* asymmetric-envelope philosophy, don't invent new numbers.
export function bandEnvelopeConstants(bandIndex, bandCount) { /* -> {attackMs, releaseMs} */ }
```

Corresponding `test/audio-bands.test.mjs`: boundary monotonicity, log-spacing shape,
edge cases (bandCount=1, bandCount=binCount), envelope constants interpolate correctly
at the first/last band (should match the existing bass/treble constants at the
extremes, within rounding).

### 2. `updateAudio()` integration
Add a parallel N-band pass (recommend `bandCount = 10` as the default, but make it a
named constant, not a magic number scattered through the file) using the new module.
Apply the same attack/release-envelope-follower pattern already used for the 4
existing bands, just parameterized per-band via `bandEnvelopeConstants()`.

### 3. GPU-side: band data via a small DataTexture, not a uniform array
Recommend a `THREE.DataTexture` (`bandCount × 1`, `RedFormat`, `FloatType`), updated
once per frame from the JS band-level array, rather than `uniform float uBands[12]`.
Reasons: (a) texture sampling gives free linear interpolation between adjacent bands
at arbitrary latitude, so the surface transition between band regions is smooth
without extra GLSL lerp logic; (b) avoids uniform-array driver-compatibility
inconsistencies; (c) band count becomes a runtime constant, not a shader recompile.

Vertex shader integration point (line 2057, where `poleAxis` already lives):

```glsl
uniform sampler2D uBandTexture;

// generalizes poleAxis: normalize(position).y is -1..1, remap to the texture's 0..1 U
float bandT = normalize(position).y * 0.5 + 0.5;
float bandLevel = texture2D(uBandTexture, vec2(bandT, 0.5)).r;
```

Wire `bandLevel` into the existing `displacement` calculation (line 2068) as an
**additional** term — do not remove or reduce the existing `uBass`/`uMid`/`uHigh`
contributions, this is additive spatial detail on top of the existing motion, not a
replacement for it.

JS-side per-frame texture update goes in `animate()` next to the other
`sphereMat.uniforms.*.value = ...` assignments (line 3576–3581).

### 4. `prefers-reduced-motion`
`animate()` already has a full reduced-motion branch (starting line 3451) that zeroes
`uBass`/`uMid`/`uHigh`/`uBeatFlash`/`uFlux` and renders a static frame. The new
`uBandTexture` must be zeroed/frozen the same way in that branch — do not let the new
per-region effect keep animating when the user has reduced motion enabled.

## Out of scope for this phase
Musical event detection (build-up/drop/vocal/silence), new visual modes, camera
movement — separate phases (B, C, D). Do not touch `queue-actions.mjs`,
`playlist-library.mjs`, search/settings code, or anything outside the audio/shader
path described above.

## Acceptance criteria
- [ ] `npm test` green, including new `test/audio-bands.test.mjs`
- [ ] Existing bass/mid/high/brightness-driven subsystems (rings, comets, particles,
      camera shake, glow, halo, mini-EQ bars, beat detection) behave identically to
      before this change — no regression in the existing 108 tests, and a manual
      listen-check confirms no perceptible change to anything *except* the new
      per-region surface detail.
- [ ] Quiet/sparse tracks still render a smooth, non-spiky sphere (matches the
      existing "quiet music = smooth round ball" design rule stated in the vertex
      shader comments at line 2059).
- [ ] `prefers-reduced-motion` freezes the new effect exactly like existing uniforms.
- [ ] No regression in `globalThis.__nebulaPerf` frame budget (`p95FrameMs`,
      `CPU p99 ms`) vs. a baseline capture on this same branch before the change —
      capture both and report the delta.
- [ ] `poleAxis` at line 2057 is either consumed by the new general mechanism or
      removed as dead code — not left unused alongside a new parallel system.
