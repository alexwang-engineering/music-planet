# Nebula Audio-Reactive Wireframe Visualizer Planner

> Status: implemented and verified; planner created before product changes
>
> Prepared: 2 August 2026

## 1. Outcome

Add a third visual mode, **脉冲线框**, that presents the existing central orb as a focused purple audio-reactive wireframe sphere. It must reuse Nebula's current Three.js renderer, Web Audio graph, playback element, animation loop, theme system, preference persistence, and tuner rather than creating a parallel visualizer runtime.

The result should be visibly smooth at high refresh rates, react primarily to true bass frequencies, transition cleanly to and from the existing modes, and leave **干净星球** and **流光灵韵** unchanged when the new mode is inactive.

## 2. First-principles constraints

1. One `<audio>` element, one `AudioContext`, one `AnalyserNode`, one WebGL renderer, and one Three.js animation loop.
2. The new mode is a style/state extension of the existing sphere shader, not a second scene or renderer.
3. Existing Planet colour, album-art, particle, scale-cap, smoothing, and hue-stability rules remain authoritative when the mix is `0`.
4. Raw FFT values never drive vertices directly. Bass data passes through attack/release smoothing and a bounded shader uniform.
5. Geometry begins at Icosahedron detail `3`. Detail `4` is allowed only if measured frame time remains within budget; detail `30` is prohibited.
6. Mode changes are time-based and interruptible. No `display` pop or frame-count-dependent transition.
7. Audio playback must continue if analyser setup or CORS analysis fails.
8. Reduced-motion preferences reduce rotation, camera punch, and displacement without disabling playback or hiding the selected visual mode.

## 3. Existing assets to reuse

- `#audio`, `initAudio()`, the current analyser and CORS fallback.
- `renderer`, `scene`, `camera`, `sphere`, and the existing fake-bloom wireframe passes.
- The current Simplex-noise deformation shader and Fresnel calculations.
- `_sBass`, `_sMid`, `_sHigh`, `_sAudio`, beat flash, flux, and tuner values.
- `state.visualMode`, `savePrefs()`, `applyVisualMode()`, and the visual-mode panel.
- The vendored `app/vendor/three.module.js`; no new runtime dependency or CDN.

## 4. Architecture

### 4.1 New mode state

- Add `wireframe` to the mode label map and visual panel.
- Persist it through the existing `mp_prefs` preference.
- Add a target/current mix pair. `applyVisualMode()` only changes the target; the render loop approaches it using delta-time exponential smoothing over approximately 260 ms.

### 4.2 Audio signal

- Preserve the current spectrum bands for Planet to avoid changing its approved feel.
- Add a dedicated `wireBassLevel` from bins corresponding to 20–180 Hz using `sampleRate / fftSize`.
- Apply a small noise floor, bounded normalization, approximately 45 ms attack, and approximately 220 ms release.
- Pass the result through `uWireBass`; never read the FFT array inside the shader.

### 4.3 Shader extension

- Add `uWireModeMix`, `uWireBass`, and `uWireColor` (`#b829e3`).
- Retain the current Planet displacement as one branch.
- Calculate a simpler wire displacement from the existing Simplex field, with quiet amplitude near zero and bounded bass/beat spikes.
- Blend displacement, colour, Fresnel strength, alpha, and glow using `uWireModeMix` so switching is continuous.
- Share the same uniforms with both glow passes so all three layers stay phase-aligned.

### 4.4 Scene hierarchy

- Keep the sphere centered and reuse its current transforms.
- During wireframe mode, softly reduce secondary environment intensity so the central topology reads clearly; do not abruptly remove elements.
- Planet values remain unchanged at `uWireModeMix = 0`.
- Liquid Aura continues to use its existing independent canvas and render guard.

### 4.5 Lifecycle

- Store both animation-frame handles.
- Replace the anonymous resize callback with a named callback.
- On teardown: cancel frames, remove listeners, disconnect audio nodes, close the context, dispose geometries/materials/textures, and dispose the renderer.
- Teardown runs only when the Electron document unloads, so it cannot interrupt an active player during an ordinary mode switch.

## 5. Motion and performance contract

- Hover/click feedback: 120–150 ms.
- Visual-mode transition: 240–280 ms; target 260 ms.
- Bass attack: about 45 ms; release: about 220 ms.
- Use delta time for transition, rotation, and signal smoothing.
- Target under 11.1 ms per frame at 90 Hz and under 8.3 ms for the central sphere path at 120 Hz on capable hardware.
- Keep renderer pixel ratio capped at the current `1.4`.
- No per-frame object creation in the new analyser or shader-update path.
- Detail `3` is the release default unless profiling proves detail `4` stays inside budget.

## 6. Delivery phases

### Phase 0 — Baseline and isolation

- Confirm clean Git state and create a feature branch.
- Record the current Planet/Liquid behaviour and existing visual preference.
- Identify all resources owned by the Three.js and audio lifecycles.

Exit: current app launches and the baseline modes work before feature edits.

### Phase 1 — Accurate dedicated bass signal

- Add frequency-to-bin helpers and `wireBassLevel`.
- Keep existing Planet bands untouched.
- Add deterministic boundary checks for bin selection and zero-analyser fallback where practical.

Exit: the new signal covers 20–180 Hz, remains bounded 0–1, and decays smoothly to zero.

### Phase 2 — Wireframe shader mode and UI

- Add the visual-mode button, label, persistence, and selection state.
- Extend the shared shader uniforms and blend the purple wireframe style.
- Add the 260 ms interruptible transition and restrained environment fade.
- Honour reduced motion.

Exit: Planet → Wireframe → Liquid → Wireframe can be switched repeatedly without a flash, stale canvas, or duplicated audio graph.

### Phase 3 — Cleanup and verification

- Add explicit teardown and named listener cleanup.
- Run syntax/security/package checks and build the Electron review bundle.
- Inspect playback, pause/resume, seeking, track changes, theme changes, preference restoration, CORS fallback, and mode switching.
- Measure frame pacing and inspect console/GPU resource stability during extended playback.

Exit: no new console errors, no playback regression, no resource growth across repeated mode switches, and the packaged app launches with the new mode.

## 7. Acceptance criteria

- **脉冲线框** appears as a third visual choice and restores after restart.
- Quiet audio produces a nearly round sphere; bass hits produce controlled purple spikes.
- The colour is close to `#b829e3` without overwriting Planet's album/theme colours.
- Mode transitions are smooth, reversible mid-transition, and approximately 260 ms.
- The new implementation creates no additional `AudioContext`, analyser, renderer, scene, or animation loop.
- Planet and Liquid Aura remain visually and functionally intact.
- Playback still works when Web Audio analysis is unavailable.
- All created resources have one explicit disposal path.
- Performance evidence records 60/90/120 Hz frame pacing where the display supports it.

## 8. Expected change surface

- `app/index.html`: visual option, audio-bin helper, shader uniforms/branches, transition state, render-loop updates, reduced-motion handling, and teardown.
- `README.md`: short description of the third visual mode and its performance behaviour.
- No dependency changes are expected.

## 9. Explicitly out of scope

- A second WebGL canvas or renderer.
- A second Web Audio graph.
- Unreal Bloom or a new post-processing dependency.
- Rewriting the existing Planet shader wholesale.
- Changing NetEase playback, lyrics, queue, login, or crossfade behaviour.
- Geometry detail above `4`.

## 10. Verification record

Completed on 2 August 2026:

- Renderer-module and Electron main-process syntax checks passed.
- Production dependency audit passed with `0` vulnerabilities.
- `npm run dist` produced `dist/mac-arm64/Nebula.app`; signing was skipped
  because no local Developer ID certificate is installed.
- Live Electron QA confirmed Planet → Pulse Wire → Liquid → Pulse Wire without
  a black frame, stale canvas, or shader compilation error.
- Idle Pulse Wire remained round and readable at the center; the purple
  Fresnel/glow style and restrained surrounding environment were visible.
- A 240-frame RAF sample on the available 60 Hz display averaged `16.66 ms`
  (`60.01 Hz`). The panel cannot directly prove 90/120 Hz pacing; those targets
  require a high-refresh display. The implementation therefore preserves the
  single renderer/scene/audio graph, detail `3`, capped pixel ratio, and an
  allocation-free per-frame wire signal path to retain high-refresh headroom.
