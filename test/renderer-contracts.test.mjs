import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rendererSource = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const workflowSource = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

test('phone login owns native form submission and prevents document navigation', () => {
  assert.match(
    rendererSource,
    /getElementById\('phone-section'\)\.addEventListener\('submit', async event => \{\s*event\.preventDefault\(\);/,
  );
  assert.doesNotMatch(
    rendererSource,
    /getElementById\('phone-submit'\)\.addEventListener\('click'/,
  );
});

test('login tabs synchronize visual, focus, hidden, inert, and ARIA state', () => {
  for (const contract of [
    /qrTab\.setAttribute\('aria-selected'/,
    /phoneTab\.setAttribute\('aria-selected'/,
    /qrSection\.hidden = !qrSelected/,
    /phoneSection\.hidden = !phoneSelected/,
    /qrSection\.inert = !qrSelected/,
    /phoneSection\.inert = !phoneSelected/,
    /trapTabWithin\(event, event\.currentTarget\)/,
    /element\.tabIndex >= 0/,
  ]) {
    assert.match(rendererSource, contract);
  }
});

test('both visible volume controls write through the shared volume state', () => {
  assert.match(rendererSource, /function setVolumeFromPercent\(/);
  assert.match(
    rendererSource,
    /settingsVolSlider\.addEventListener\('input', \(\) => \{\s*setVolumeFromPercent\(settingsVolSlider\.value\);/,
  );
  assert.match(rendererSource, /settingsVolValue\.textContent = muted \? '静音' : `\$\{value\}%`/);
});

test('zoom fallback preserves browse results instead of hiding core navigation', () => {
  const compactLayout = rendererSource.match(
    /@media \(max-width: 760px\) \{([\s\S]*?)\/\* === TOAST === \*\//,
  )?.[1] ?? '';
  assert.ok(compactLayout, 'compact layout media query should exist');
  assert.doesNotMatch(compactLayout, /#playlist-wrap[\s\S]{0,80}display:\s*none/);
  assert.doesNotMatch(compactLayout, /#mylist-wrap[\s\S]{0,80}display:\s*none/);
  assert.match(compactLayout, /#right-panel\s*\{\s*display:\s*none/);
});

test('reduced motion renders a static visual frame without maintaining the loop', () => {
  assert.match(rendererSource, /const reducedVisualMotion = reducedMotionQuery\.matches/);
  assert.match(rendererSource, /if \(!reducedVisualMotion\) \{\s*animationFrameId = requestAnimationFrame\(animate\);/);
  assert.match(rendererSource, /if \(reducedVisualMotion\) \{[\s\S]*?_renderLiquidAura\(0\)/);
});

test('pulse wire extends the installed Planet without replacing its geometry or runtime', () => {
  assert.match(rendererSource, /data-visual="wireframe"[^>]*role="radio"/);
  assert.match(rendererSource, /wireframe:\s*'脉冲线框'/);
  assert.match(rendererSource, /const sphereGeo = new THREE\.IcosahedronGeometry\(0\.90, 2\)/);
  assert.match(rendererSource, /const pulseWireGeo = new THREE\.IcosahedronGeometry\(0\.90, 3\)/);
  assert.match(rendererSource, /uWireColor:\s*\{ value: new THREE\.Color\(0xb829e3\) \}/);
  assert.match(rendererSource, /calculateWireBassLevel\(dataArray, wireBassRange\)/);
  assert.match(rendererSource, /smoothAttackRelease\(_sWireBass, wireBassLevel, delta\)/);
  assert.match(rendererSource, /smoothModeMix\([\s\S]*?state\.visualMode === 'wireframe'/);
  assert.equal((rendererSource.match(/new THREE\.WebGLRenderer\(/g) || []).length, 1);
  assert.equal((rendererSource.match(/new \(window\.AudioContext \|\| window\.webkitAudioContext\)\(\)/g) || []).length, 1);
});

test('visualizer teardown owns animation, WebGL, and Web Audio resources', () => {
  assert.match(rendererSource, /function teardownVisualizer\(\)/);
  assert.match(rendererSource, /cancelAnimationFrame\(animationFrameId\)/);
  assert.match(rendererSource, /scene\.traverse\(object =>/);
  assert.match(rendererSource, /renderer\.dispose\(\)/);
  assert.match(rendererSource, /sourceNode\?\.disconnect\(\)/);
  assert.match(rendererSource, /audioCtx\.close\(\)\.catch/);
  assert.match(rendererSource, /beforeunload', teardownVisualizer/);
});

test('CI gates runtime dependency risk and the complete local check suite', () => {
  assert.equal(
    packageJson.scripts['audit:high'],
    'npm audit --omit=dev --audit-level=high',
  );
  assert.match(workflowSource, /- run: npm run audit:high/);
  assert.match(workflowSource, /- run: npm run check/);
});

test('each Electron process passes its own loopback API port to the renderer', () => {
  assert.match(mainSource, /apiPort = await reserveLoopbackPort\(\)/);
  assert.match(mainSource, /startApiServer\(apiPort\)/);
  assert.match(mainSource, /buildRendererQuery\(port/);
  assert.doesNotMatch(mainSource, /const API_PORT = 3000/);
  assert.match(rendererSource, /resolveLoopbackApiBase\(window\.location\.search\)/);
});

test('song loading is latest-intent-wins and stale playback errors cannot skip a new song', () => {
  assert.match(rendererSource, /const playbackRequests = createLatestRequestCoordinator\(\)/);
  assert.doesNotMatch(rendererSource, /if \(loading\) return/);
  assert.match(rendererSource, /getSongUrl\(songId, \{ signal: playbackRequest\.signal \}\)/);
  assert.match(rendererSource, /if \(!playbackRequests\.isCurrent\(playbackRequest\)\) return/);
  assert.match(rendererSource, /playbackRequests\.isCurrent\(failedRequest\)/);
});
