import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const splashSource = readFileSync(new URL('../app/splash.html', import.meta.url), 'utf8');

test('cold start shows a dedicated splash while API and main window prepare in parallel', () => {
  assert.match(mainSource, /function createSplashWindow\(\)/);
  assert.match(mainSource, /loadFile\(path\.join\(__dirname, 'app', 'splash\.html'\)\)/);
  assert.match(mainSource, /const splash = createSplashWindow\(\)[\s\S]*?startApiServer\(apiPort\)[\s\S]*?createWindow\(apiPort, \{ deferShow: true \}\)/);
  assert.match(mainSource, /Promise\.all\(\[splash\.nebulaReady, window\.nebulaReady, apiReady\]\)/);
  assert.match(mainSource, /show: false/);
  assert.match(mainSource, /createReadyPromise\(window, \{ waitForPaint: false \}\)/);
  assert.match(mainSource, /'did-finish-load'/);
});

test('splash handoff is time-based, crossfaded, and reduced-motion aware', () => {
  assert.match(mainSource, /function crossfadeToMain\(window, splash, durationMs\)/);
  assert.match(mainSource, /const progress = Math\.min\(\(Date\.now\(\) - startedAt\) \/ durationMs, 1\)/);
  assert.match(mainSource, /window\.setOpacity\(eased\)/);
  assert.match(mainSource, /splash\.setOpacity\(1 - eased\)/);
  assert.match(mainSource, /prefers-reduced-motion: reduce/);
  assert.match(mainSource, /SPLASH_REDUCED_CROSSFADE_MS/);
  assert.match(mainSource, /process\.env\.NEBULA_SPLASH_DEBUG === '1'/);
  assert.match(splashSource, /@media \(prefers-reduced-motion: reduce\)/);
});

test('splash remains lightweight, local, and non-interactive', () => {
  assert.match(splashSource, /Content-Security-Policy/);
  assert.doesNotMatch(splashSource, /https?:\/\//);
  assert.doesNotMatch(splashSource, /<script/);
  assert.match(splashSource, /role="status"/);
  assert.match(mainSource, /window\.setIgnoreMouseEvents\(true\)/);
  assert.match(mainSource, /nodeIntegration: false/);
  assert.match(mainSource, /contextIsolation: true/);
});
