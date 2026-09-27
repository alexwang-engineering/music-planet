// Run: node_modules/.bin/electron scripts/check-playback.cjs
// Real renderer + local silent audio, isolated storage, and no external requests.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const temp = mkdtempSync(path.join(tmpdir(), 'music-planet-playback-'));
app.setPath('userData', path.join(temp, 'profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const wav = Buffer.alloc(44 + 8000 * 2 * 30);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(wav.length - 44, 40);
writeFileSync(path.join(temp, 'tone.wav'), wav);
const audioUrl = pathToFileURL(path.join(temp, 'tone.wav')).href;
const vendorUrl = pathToFileURL(path.resolve(__dirname, '../app/vendor/three.module.js')).href;

async function checks(audioUrl) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate, message) => {
    const deadline = performance.now() + 4000;
    while (!predicate()) {
      assert(performance.now() < deadline, message);
      await wait(15);
    }
  };
  const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
  };
  const song = id => ({ id, name: 'Track ' + id, ar: [{ name: 'Artist' }], al: {}, dt: 30000 });
  const songs = ids => ids.map(song);
  const ids = () => state.playlist.map(s => s.id).join(',');
  const input = document.getElementById('search-input');
  const click = selector => document.querySelector(selector).click();
  const selected = id => until(() => !loading && currentSong()?.id === id && audio.src.endsWith('#' + id), 'Track ' + id + ' did not start');
  const started = id => ({ data: [{ url: audioUrl + '#' + id }] });
  const routes = new Map();
  const calls = [];
  window.__fetch = async url => {
    const u = new URL(url);
    const key = u.pathname === '/search' ? 'search:' + u.searchParams.get('keywords')
      : u.pathname === '/playlist/track/all' ? 'playlist:' + u.searchParams.get('id')
      : u.pathname === '/song/detail' ? 'detail:' + u.searchParams.get('ids')
      : u.pathname === '/lyric' ? 'lyric:' + u.searchParams.get('id')
      : u.pathname.startsWith('/song/url') ? 'url:' + u.searchParams.get('id') : u.pathname;
    calls.push(u);
    if (routes.has(key)) return await routes.get(key)(u);
    if (key.startsWith('url:')) return started(u.searchParams.get('id'));
    return {};
  };
  const completed = [];
  const test = async (name, fn) => { await fn(); completed.push(name); console.log('PASS ' + name); };
  cancelAnimationFrame(_threeRafId);
  cancelAnimationFrame(_liquidRafId);
  input.value = 'keep-results';

  await test('user selection supersedes delayed startup resume', async () => {
    await playIndex(0, songs([1, 2, 3]));
    await wait(900);
    assert(currentSong().id === 1 && audio.src.endsWith('#1'), 'Startup resume replaced user selection');
  });
  await test('browsing preserves queue, next, and persisted resume', async () => {
    routes.set('search:browse', () => ({ result: { songs: songs([11, 12]) } }));
    routes.set('playlist:70', () => ({ songs: songs([21, 22]) }));
    await performSearch('browse');
    await loadPlaylistTracks(70, 'Browse playlist');
    assert(ids() === '1,2,3' && state.currentIndex === 0, 'Browsing replaced active queue');
    saveResume();
    assert(JSON.parse(localStorage.getItem('mp_resume')).queue[0].id === 1, 'Resume saved browse list');
    click('#btn-next'); await selected(2);
    assert(ids() === '1,2,3', 'Next used browse results');
  });
  await test('search, playlist, history, and queue clicks use their own lists', async () => {
    click('#playlist-wrap .song-item[data-song-id="12"]'); await selected(12);
    assert(ids() === '11,12', 'Search click used another queue');
    click('#mylist-wrap .song-item[data-song-id="21"]'); await selected(21);
    assert(ids() === '21,22', 'Playlist click used another queue');
    playHistory = songs([31, 32]); renderHistory();
    click('#playlist-wrap .song-item[data-song-id="32"]'); await selected(32);
    assert(ids() === '31,32', 'History click used another queue');
    toggleQueue(true); click('#queue-list [data-idx="0"]'); await selected(31);
    assert(ids() === '31,32', 'Queue click replaced queue');
  });
  await test('new browse queue clears old shuffle history', async () => {
    state.shuffle = true;
    _shuffleHistory = [1, 2];
    renderPlaylist(songs([201, 202, 203]));
    click('#playlist-wrap [data-song-id="201"]'); await selected(201);
    const next = getNextIndex();
    assert(_shuffleHistory.length === 1 && next !== state.currentIndex, 'New browse queue reused old shuffle history');
    state.shuffle = false;
    _shuffleHistory = [];
  });
  await test('queue actions and favorites browse stay local', async () => {
    await playIndex(0, songs([111, 112, 113]));
    renderPlaylist(songs([114]));
    document.querySelector('#playlist-wrap [data-song-id="114"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    document.querySelector('#ctx-menu [data-act="playnext"]').click();
    assert(ids() === '111,114,112,113', 'Context menu did not enqueue next');
    toggleQueue(true);
    const second = document.querySelector('#queue-list [data-idx="2"] .q-remove');
    second.click();
    assert(ids() === '111,114,113', 'Queue remove changed the wrong item');
    document.getElementById('queue-clear').click();
    assert(ids() === '111' && state.currentIndex === 0, 'Queue clear did not preserve current song');
    toggleQueue(false);
    favMap = { 111: { ...song(111), ar: [{ name: 'Artist' }], al: {}, at: Date.now() } };
    document.getElementById('tab-favorites').click();
    assert(document.querySelector('#playlist-wrap [data-song-id="111"]'), 'Favorites browse did not render');
  });
  await test('search tab restores its own browse list', async () => {
    routes.set('search:tab', () => ({ result: { songs: songs([121]) } }));
    input.value = 'tab';
    click('#tab-search');
    await until(() => document.querySelector('#playlist-wrap [data-song-id="121"]'), 'Search tab kept another browse list');
  });
  await test('keyboard activation and Escape keep control state aligned', async () => {
    renderPlaylist(songs([141, 142]));
    document.querySelector('#playlist-wrap [data-song-id="142"]').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ', code: 'Space' }));
    await selected(142);
    click('#btn-tuner');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    assert(document.getElementById('tuner-panel').classList.contains('hidden') && !document.getElementById('btn-tuner').classList.contains('active'), 'Escape left tuner state out of sync');
  });
  await test('cinematic drawers and More preserve focus and visibility state', async () => {
    assert(document.getElementById('left-panel').inert && document.getElementById('right-panel').inert, 'Closed drawers remain keyboard reachable');
    click('#btn-browse');
    assert(!document.getElementById('left-panel').inert && document.body.classList.contains('browse-open') && document.getElementById('btn-browse').getAttribute('aria-expanded') === 'true', 'Browse drawer did not open');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    assert(document.getElementById('left-panel').inert && !document.body.classList.contains('browse-open') && document.activeElement === document.getElementById('btn-browse'), 'Escape did not close Browse drawer or restore focus');
    click('#btn-now-playing');
    assert(!document.getElementById('right-panel').inert && document.body.classList.contains('now-playing-open') && document.getElementById('btn-now-playing').getAttribute('aria-expanded') === 'true', 'Now Playing drawer did not open');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    assert(document.getElementById('right-panel').inert && !document.body.classList.contains('now-playing-open') && document.activeElement === document.getElementById('btn-now-playing'), 'Escape did not close Now Playing drawer or restore focus');
    click('#btn-more');
    assert(!document.getElementById('more-panel').classList.contains('hidden') && document.getElementById('more-panel').contains(document.getElementById('btn-visual')), 'More panel did not group visual controls');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    assert(document.getElementById('more-panel').classList.contains('hidden') && document.activeElement === document.getElementById('btn-more'), 'Escape did not close More panel or restore focus');
  });
  await test('stale recommendations cannot overwrite another browse view', async () => {
    const rec = deferred();
    _recCache = null;
    routes.set('/top/song', () => rec.promise);
    const pending = renderRecommendations();
    favMap = { 131: { ...song(131), ar: [{ name: 'Artist' }], al: {}, at: Date.now() } };
    click('#tab-favorites');
    rec.resolve({ data: songs([132]) });
    await pending;
    assert(document.querySelector('#playlist-wrap [data-song-id="131"]') && !document.querySelector('#playlist-wrap [data-song-id="132"]'), 'Stale recommendations replaced the active browse view');
    click('#playlist-wrap [data-song-id="131"]'); await selected(131);
    assert(document.querySelector('#playlist-wrap .history-header')?.textContent === '我的喜欢', 'Playing from Favorites replaced the active browse view');
  });
  await test('stale searches, edited queries, and cleared input cannot repaint', async () => {
    const old = deferred(); routes.set('search:old', () => old.promise);
    const pending = performSearch('old'); await performSearch('browse');
    old.resolve({ result: { songs: songs([99]) } }); await pending;
    assert(document.querySelector('#playlist-wrap [data-song-id="11"]'), 'Old search replaced newer result');
    const edited = deferred(); routes.set('search:edited', () => edited.promise);
    const pendingEdit = performSearch('edited');
    input.value = 'new query'; input.dispatchEvent(new Event('input')); clearTimeout(searchTimer);
    edited.resolve({ result: { songs: songs([99]) } }); await pendingEdit;
    assert(!document.querySelector('#playlist-wrap [data-song-id="99"]'), 'Old search rendered during debounce');
    const cleared = deferred(); routes.set('search:clear', () => cleared.promise);
    const pendingClear = performSearch('clear'); input.value = ''; input.dispatchEvent(new Event('input'));
    cleared.resolve({ result: { songs: songs([99]) } }); await pendingClear;
    assert(document.querySelector('.history-header') && !document.querySelector('[data-song-id="99"]'), 'Cleared search reappeared');
    input.value = 'keep-results';
  });
  await test('stale playlist requests respect newer selection and Back', async () => {
    const older = deferred(); routes.set('playlist:71', () => older.promise);
    const pending = loadPlaylistTracks(71, 'Old playlist'); await loadPlaylistTracks(70, 'Latest playlist');
    older.resolve({ songs: songs([99]) }); await pending;
    assert(document.querySelector('#mylist-wrap [data-song-id="21"]'), 'Old playlist replaced newer playlist');
    const back = deferred(); routes.set('playlist:72', () => back.promise);
    const pendingBack = loadPlaylistTracks(72, 'Back'); click('#back-to-playlists');
    back.resolve({ songs: songs([99]) }); await pendingBack;
    assert(!document.querySelector('#mylist-wrap .song-item'), 'Playlist request ignored Back');
  });
  await test('latest track wins delayed URL, details, lyrics, and accent work', async () => {
    const url = deferred(), detail = deferred(), lyric = deferred();
    routes.set('url:41', () => url.promise); routes.set('detail:41', () => detail.promise);
    routes.set('lyric:41', () => lyric.promise);
    const originalExtract = extractAccentColor, originalApply = applyAccentColor;
    const accents = []; let applied = '';
    extractAccentColor = (url, callback) => accents.push(callback);
    applyAccentColor = color => { applied = color; };
    try {
      const older = playIndex(0, [{ ...song(41), al: { picUrl: 'https://invalid.test/old.png' } }, song(42)]);
      await playIndex(1);
      url.resolve(started(41)); detail.resolve({ songs: [{ al: { picUrl: 'https://invalid.test/late.png' } }] });
      lyric.resolve({ lrc: { lyric: '[00:00.00]Old lyrics' } }); await older; await wait(30);
      accents.forEach(callback => callback('stale'));
      assert(audio.src.endsWith('#42') && document.title.startsWith('Track 42'), 'Old request replaced new audio/title');
      assert(!document.getElementById('bar-art').getAttribute('src') && state.lyrics.length === 0 && !applied, 'Old metadata overwrote newest track');
      assert(!playHistory.some(s => s.id === 41), 'Superseded request entered history');
      assert(!loading, 'Superseded request changed loading state');
    } finally { extractAccentColor = originalExtract; applyAccentColor = originalApply; }
  });
  await test('optional metadata does not block playback', async () => {
    const detail = deferred(), lyric = deferred();
    routes.set('detail:43', () => detail.promise); routes.set('lyric:43', () => lyric.promise);
    await Promise.race([playIndex(0, songs([43])), wait(2000).then(() => { throw new Error('Metadata blocked playback'); })]);
    assert(audio.src.endsWith('#43') && !audio.paused, 'Playback did not start before metadata');
    detail.resolve({ songs: [song(43)] }); lyric.resolve({ lrc: { lyric: '[00:00.00]Current lyrics' } });
    await until(() => state.lyrics.length === 1, 'Late current lyrics were lost');
  });
  await test('rapid Next/Previous use pending selection and suppress old-media end/save', async () => {
    await playIndex(0, songs([51, 52, 53])); audio.currentTime = 8; saveResume();
    const saved = localStorage.getItem('mp_resume'), url = deferred(); routes.set('url:52', () => url.promise);
    click('#btn-next'); assert(state.currentIndex === 1 && loading, 'Next did not select pending track');
    audio.dispatchEvent(new Event('ended')); saveResume();
    assert(state.currentIndex === 1 && localStorage.getItem('mp_resume') === saved, 'Old audio advanced/saved pending track');
    click('#btn-next'); await selected(53);
    click('#btn-prev'); assert(state.currentIndex === 1, 'Previous did not select previous track');
    click('#btn-prev'); await selected(51);
    url.resolve(started(52)); await wait(60);
    assert(audio.src.endsWith('#51'), 'Delayed Next/Previous request won');
  });
  await test('crossfade cancellation settles and newest fade completes', async () => {
    const old = fadeTo(0, 500); const latest = fadeTo(0.4, 40);
    assert(await old === false && await latest === true, 'Cancelled fade never settled correctly');
    assert(Math.abs(audio.volume - 0.4) < 0.001, 'Latest fade missed target');
    await playIndex(0, songs([61, 62, 63])); audio.currentTime = 5;
    const older = playIndex(1); await wait(40); await playIndex(2); await older;
    assert(audio.src.endsWith('#63'), 'Cancelled crossfade switched to old track');
    await wait(400); assert(Math.abs(audio.volume - state.volume) < 0.001, 'Crossfade did not restore volume');
  });
  await test('quality fallbacks and unavailable song skip remain working', async () => {
    routes.set('url:71', u => u.pathname === '/song/url' ? started(71) : { data: [{ url: null }] });
    await playIndex(0, songs([71]));
    const attempts = calls.filter(u => u.searchParams.get('id') === '71' && u.pathname.startsWith('/song/url'));
    assert(attempts.length === 3 && attempts[0].searchParams.get('level') === 'exhigh' && attempts[1].searchParams.get('level') === 'standard', 'Quality fallback order changed');
    routes.set('url:72', () => ({ data: [{ url: null }] }));
    await playIndex(0, songs([72, 73])); await selected(73);
    await playIndex(0, songs([72]));
    assert(audio.paused && !audio.getAttribute('src') && !loading, 'Unavailable queue end left outgoing audio playing');
  });
  await test('repeat, shuffle, and guarded delayed error skip', async () => {
    await playIndex(1, songs([81, 82, 83])); state.repeat = 2;
    const token = playRequestId; audio.dispatchEvent(new Event('ended'));
    assert(playRequestId === token && state.currentIndex === 1, 'Repeat-one advanced track');
    state.repeat = 1; await playIndex(2); audio.dispatchEvent(new Event('ended')); await selected(81);
    state.repeat = 0; state.shuffle = true; _shuffleHistory = [];
    const picks = [getNextIndex(), getNextIndex()];
    assert(new Set(picks).size === 2 && picks.every(i => i !== 0), 'Shuffle repeated/exited active queue');
    state.shuffle = false;
    audio.crossOrigin = null; audio.dispatchEvent(new Event('error'));
    await playIndex(2); await wait(1100);
    assert(currentSong().id === 83 && audio.src.endsWith('#83'), 'Old delayed error skipped newer choice');
  });
  await test('resume restores queue/position and delayed seek respects new selection', async () => {
    localStorage.setItem('mp_resume', JSON.stringify({ queue: songs([91, 92]), idx: 0, time: 10 }));
    window.__restoreState(); await selected(91);
    await until(() => audio.currentTime >= 10, 'Resume did not seek to saved position');
    assert(ids() === '91,92' && audio.currentTime < 12, 'Resume lost its queue or position');
    localStorage.setItem('mp_resume', JSON.stringify({ queue: songs([101, 102]), idx: 0, time: 17 }));
    window.__restoreState(); await selected(101);
    await playIndex(1); await wait(900);
    assert(audio.src.endsWith('#102') && audio.currentTime < 4, 'Stale resume seek moved newer track');
  });
  cancelFade();
  return completed;
}

let html = readFileSync(path.resolve(__dirname, '../app/index.html'), 'utf8');
html = html.replace("'./vendor/three.module.js'", JSON.stringify(vendorUrl));
html = html.replace('(function restoreState() {', '(function restoreState() {\nwindow.__restoreState = restoreState;');
html = html.replace('<script type="module">', `<script>
  window.__fetch = async () => ({});
  window.fetch = async url => Response.json(await window.__fetch(String(url)));
  localStorage.setItem('mp_resume', JSON.stringify({queue:[{id:999,name:'Old resume',ar:[],al:{}}],idx:0,time:10}));
</script><script type="module">`);
const end = html.lastIndexOf('</script>');
html = html.slice(0, end) + '\nwindow.__checks = (' + checks.toString() + ')(' + JSON.stringify(audioUrl) + ');\n' + html.slice(end);
writeFileSync(path.join(temp, 'index.html'), html);

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { partition: 'playback-check', backgroundThrottling: false } });
    win.webContents.setAudioMuted(true);
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    win.webContents.on('console-message', event => {
      if (event.message?.startsWith('PASS ')) console.log(event.message);
    });
    await win.loadFile(path.join(temp, 'index.html'));
    const result = await Promise.race([
      win.webContents.executeJavaScript('window.__checks'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Renderer check timed out')), 45000)),
    ]);
    if (!Array.isArray(result)) throw new Error('Renderer module did not initialize');
    const screenshot = path.join(tmpdir(), `music-planet-playback-${process.pid}.png`);
    writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
    console.log('Screenshot: ' + screenshot);
    console.log(`Passed ${result.length} playback regression checks.`);
    win.destroy(); app.exit(0);
  } catch (error) {
    console.error(error); win?.destroy(); app.exit(1);
  }
});
app.on('quit', () => rmSync(temp, { recursive: true, force: true }));
