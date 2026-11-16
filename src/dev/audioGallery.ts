// Audio gallery (dev/audio.html): a button for every sound effect and track, the sound and music switches, and a
// self-test that renders everything offline and checks it. Buttons play through the real game API (src/audio), so
// what you hear here is exactly what the game plays, compressor, ducking and crossfades included.
//
// The self-test is also the headless check: window.__game.api.runChecks() resolves to the same tables the page
// draws, with an `ok` flag per row. SFX come from the facade's own selfTest (OfflineAudioContext, no gesture
// needed); each track is rendered for one full loop with the sequencer's instruments wrapped in counters, so the
// row proves the track schedules notes on every channel, stays under clipping and has no silent bar.
import { TYPE_IDS } from '../data/schema.ts';
import type { TypeId } from '../data/schema.ts';
import { TYPES } from '../data/types.ts';
import {
  audio, sfx, music, moveSfx, setSound, setMusic, unlockAudio, isAudioUnlocked, isSoundOn, isMusicOn, currentMusic,
  SFX_NAMES, TRACK_NAMES,
} from '../audio/index.ts';
import type { SfxName, TrackName } from '../audio/index.ts';
import { compileTrack, renderTrack, INST, DRUMS } from '../lib/audio/sequencer.ts';
import type { Instrument, Drum } from '../lib/audio/sequencer.ts';

// ---------------------------------------------------------------------------------------------
// What is on the page
// ---------------------------------------------------------------------------------------------

interface Group { title: string; note: string; items: [SfxName, string][] }
const GROUPS: Group[] = [
  {
    title: 'Interface', note: 'Menus and buttons. Short and soft: the player hears these hundreds of times.',
    items: [['click', 'menu tap'], ['select', 'pick something'], ['back', 'close a menu'], ['error', 'not allowed'], ['swap', 'switch dragons']],
  },
  {
    title: 'Battle', note: 'HIT SUPER must be clearly bigger than HIT, and HIT WEAK clearly duller.',
    items: [
      ['hit', 'normal hit'], ['hitSuper', 'super effective'], ['hitWeak', 'not very effective'], ['crit', 'critical hit'],
      ['miss', 'attack missed'], ['faint', 'dragon fainted'], ['heal', 'HP restored'], ['statUp', 'stat raised'],
      ['statDown', 'stat lowered'], ['status', 'status condition'], ['boss', 'boss appears'],
    ],
  },
  {
    title: 'Rewards and the burrow', note: 'Jingles, coins and the five stations.',
    items: [
      ['levelUp', 'level up'], ['evolve', 'evolution'], ['victory', 'battle won'], ['defeat', 'battle lost'],
      ['coin', 'coins'], ['eat', 'snack bar'], ['dig', 'treasure tunnels'], ['wheel', 'hamster wheel'],
      ['snore', 'cozy nest'], ['sparkle', 'ball pit, treats'],
    ],
  },
];
const TRACK_NOTES: Record<TrackName, string> = {
  title: 'whimsical adventure',
  burrow: 'cosy home loop',
  mission: 'sneaky spy theme',
  battle: 'upbeat and driving',
  boss: 'villain, with a wink',
  victory: 'fanfare and victory lap',
};

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

const SFX_SECONDS = 3;
const UI_SFX = new Set<SfxName>(['click', 'back', 'select', 'error', 'swap']);
const LONG_SFX = new Set<SfxName>(['faint', 'levelUp', 'evolve', 'victory', 'defeat', 'boss', 'snore']);
/** The longest an SFX may ring for: UI blips are quick, jingles may take a couple of seconds. */
const maxMs = (n: SfxName): number => (UI_SFX.has(n) ? 400 : LONG_SFX.has(n) ? 2200 : 1000);

/** `rms` is over the whole render (the facade's number); `loud` is the RMS of just the part that sounds. */
export interface SfxRow { name: SfxName; peak: number; rms: number; loud: number; durationMs: number; maxMs: number; ok: boolean; why: string }
export interface TrackRow {
  name: TrackName; bpm: number; bars: number; loopSeconds: number; notes: number; channels: number;
  peak: number; rms: number; quietestBar: number; ok: boolean; why: string;
}
export interface CheckReport { ok: boolean; sfx: SfxRow[]; tracks: TrackRow[]; crossCheck: { name: string; rms: number; peak: number }[] }

function checkSfx(name: SfxName, m: { peak: number; rms: number; durationMs: number; error?: string }): SfxRow {
  const lim = maxMs(name);
  const why: string[] = [];
  if (m.error) why.push(m.error);
  const loud = m.durationMs > 0 ? m.rms * Math.sqrt((SFX_SECONDS * 1000) / m.durationMs) : 0;
  if (m.peak < 0.08 || loud < 0.025) why.push('too quiet');
  if (m.peak >= 0.95) why.push('clips');
  if (m.durationMs < 25) why.push('too short');
  if (m.durationMs > lim) why.push(`rings past ${lim}ms`);
  return { name, peak: m.peak, rms: m.rms, loud, durationMs: m.durationMs, maxMs: lim, ok: !why.length, why: why.join(', ') };
}

function rmsOf(d: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += d[i] * d[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** Render one full loop of a track with every instrument and drum counted, and measure it. */
async function measureTrack(name: TrackName): Promise<TrackRow> {
  const track = audio.TRACKS[name];
  const c = compileTrack(track);
  const loopSeconds = c.total * c.stepDur;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) throw new Error('no OfflineAudioContext');
  const sr = 44100;
  const ctx = new OAC(1, Math.ceil(sr * (loopSeconds + 1)), sr);
  const perInst = new Map<string, number>();
  let notes = 0;
  const count = (key: string, t: number) => { if (t < loopSeconds) { notes++; perInst.set(key, (perInst.get(key) || 0) + 1); } };
  const savedI: Record<string, Instrument> = { ...INST };
  const savedD: Record<string, Drum> = { ...DRUMS };
  try {
    // renderTrack schedules everything synchronously, so the wrappers are back out before anything else can run
    for (const k of Object.keys(savedI)) INST[k] = (cx, d, t, n) => { count(k, t); savedI[k](cx, d, t, n); };
    for (const k of Object.keys(savedD)) DRUMS[k] = (cx, d, t, v) => { count('drums', t); savedD[k](cx, d, t, v); };
    renderTrack(ctx, ctx.destination, track, loopSeconds, { intensity: 0.6 });
  } finally {
    Object.assign(INST, savedI);
    Object.assign(DRUMS, savedD);
  }
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const loopEnd = Math.min(d.length, Math.round(loopSeconds * sr));
  const barLen = Math.round((c.stepsPerBar * c.stepDur) * sr);
  let quietestBar = Infinity;
  for (let b = 0; b < c.bars; b++) quietestBar = Math.min(quietestBar, rmsOf(d, b * barLen, Math.min(loopEnd, (b + 1) * barLen)));
  const why: string[] = [];
  for (const ch of c.channels) {
    if (ch.len % c.stepsPerBar !== 0 || c.total % ch.len !== 0) why.push(`${ch.inst}: ${ch.len} steps does not fit the loop`);
    if (!perInst.get(ch.drums ? 'drums' : ch.inst)) why.push(`${ch.inst}: no notes`);
  }
  const rms = rmsOf(d, 0, loopEnd);
  if (!notes) why.push('no notes');
  if (peak >= 0.95) why.push('clips');
  if (rms < 0.01) why.push('too quiet');
  if (quietestBar < 0.003) why.push('a bar is silent');
  return {
    name, bpm: track.bpm, bars: c.bars, loopSeconds, notes, channels: c.channels.length,
    peak, rms, quietestBar, ok: !why.length, why: [...new Set(why)].join(', '),
  };
}

/** Run every check. Needs no user gesture: it is all OfflineAudioContext. */
async function runChecks(): Promise<CheckReport> {
  const self = await audio.selfTest({ sfxSeconds: SFX_SECONDS, musicSeconds: 2.5 });
  const byName = new Map(self.sfx.map((r) => [r.name, r]));
  const sfxRows = SFX_NAMES.map((n) => checkSfx(n, byName.get(n) ?? { peak: 0, rms: 0, durationMs: 0, error: 'not in the self-test' }));
  const tracks: TrackRow[] = [];
  for (const n of TRACK_NAMES) {
    try { tracks.push(await measureTrack(n)); } catch (e) {
      tracks.push({ name: n, bpm: 0, bars: 0, loopSeconds: 0, notes: 0, channels: 0, peak: 0, rms: 0, quietestBar: 0, ok: false, why: String((e as Error)?.message || e) });
    }
  }
  const crossCheck = self.music.map((m) => ({ name: m.name, rms: m.rms, peak: m.peak }));
  for (const m of self.music) {
    const row = tracks.find((r) => r.name === m.name);
    if (row && (m.error || m.rms < 0.01)) { row.ok = false; row.why = [row.why, m.error || 'facade self-test: silent'].filter(Boolean).join(', '); }
  }
  return { ok: sfxRows.every((r) => r.ok) && tracks.every((r) => r.ok), sfx: sfxRows, tracks, crossCheck };
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
}

function soundButton(label: string, sub: string, onClick: () => void, color?: string): HTMLButtonElement {
  const b = el('button', {}, el('b', {}, label), el('small', {}, sub));
  if (color) { b.style.background = color; b.style.color = '#fff'; b.style.textShadow = '0 1px 0 #1b1426'; }
  b.addEventListener('click', () => { unlockAudio(); onClick(); refresh(); });
  return b;
}

const app = document.getElementById('app') as HTMLElement;
const status = el('span', { className: 'status' });
const soundBtn = el('button');
const musicBtn = el('button');
const trackButtons = new Map<TrackName, HTMLButtonElement>();

function refresh(): void {
  const playing = currentMusic();
  status.textContent = !isAudioUnlocked()
    ? 'AUDIO LOCKED: click or press any key to unlock'
    : `AUDIO ON  |  MUSIC: ${playing && isMusicOn() ? playing.toUpperCase() : 'NONE'}`;
  soundBtn.innerHTML = `<b>SOUND: ${isSoundOn() ? 'ON' : 'OFF'}</b><small>setSound()</small>`;
  musicBtn.innerHTML = `<b>MUSIC: ${isMusicOn() ? 'ON' : 'OFF'}</b><small>setMusic()</small>`;
  for (const [n, b] of trackButtons) b.classList.toggle('on', n === playing && isMusicOn());
}

function build(): void {
  app.append(
    el('h1', {}, 'DRAGON HAMSTERS: AUDIO'),
    el('p', { className: 'note' }, 'Every sound effect and track, played through the game API. The first click anywhere unlocks audio.'),
  );
  soundBtn.addEventListener('click', () => { setSound(!isSoundOn()); refresh(); });
  musicBtn.addEventListener('click', () => { unlockAudio(); setMusic(!isMusicOn()); refresh(); });
  app.append(el('div', { className: 'bar' }, status, soundBtn, musicBtn));

  // music
  app.append(el('h2', {}, 'Music'), el('p', { className: 'note' }, 'Changing track crossfades; asking for the playing track again does nothing.'));
  const tracks = el('div', { className: 'grid' });
  for (const n of TRACK_NAMES) {
    const t = audio.TRACKS[n];
    const b = soundButton(n, `${TRACK_NOTES[n]}, ${t.bpm} bpm`, () => music(n));
    trackButtons.set(n, b);
    tracks.append(b);
  }
  tracks.append(soundButton('stop', 'music(null)', () => music(null)));
  app.append(tracks);

  // sound effects
  const listed = new Set<SfxName>();
  for (const g of GROUPS) {
    const grid = el('div', { className: 'grid' });
    for (const [n, sub] of g.items) { listed.add(n); grid.append(soundButton(n, sub, () => sfx(n))); }
    app.append(el('h2', {}, g.title), el('p', { className: 'note' }, g.note), grid);
  }
  const moves = el('div', { className: 'grid' });
  for (const type of TYPE_IDS) {
    const n = moveSfx(type);
    listed.add(n);
    moves.append(soundButton(TYPES[type as TypeId]?.name || type, `moveSfx: ${n}`, () => sfx(n), TYPES[type]?.color));
  }
  app.append(el('h2', {}, 'Moves by type'), el('p', { className: 'note' }, 'moveSfx(type) for each of the sixteen types.'), moves);
  const rest = SFX_NAMES.filter((n) => !listed.has(n));
  if (rest.length) {
    const grid = el('div', { className: 'grid' });
    for (const n of rest) grid.append(soundButton(n, 'other', () => sfx(n)));
    app.append(el('h2', {}, 'Other'), grid);
  }

  // self-test
  const out = el('div');
  const run = el('button', {}, el('b', {}, 'run self-test'), el('small', {}, 'offline render of everything'));
  run.addEventListener('click', async () => {
    run.disabled = true;
    out.textContent = 'rendering...';
    try { drawReport(out, await runChecks()); } finally { run.disabled = false; }
  });
  app.append(el('h2', {}, 'Self-test'), el('p', { className: 'note' }, `SFX: audible (loudness = RMS while it sounds), peak under 0.95, done within its limit (rendered ${SFX_SECONDS}s). Tracks: one full loop, notes on every channel, no silent bar.`), run, out);
  refresh();
}

function drawWave(name: SfxName, ms: number): HTMLCanvasElement {
  const cv = el('canvas', { className: 'wave', width: 160, height: 26 });
  audio.render(name, Math.max(0.2, ms / 1000)).then((buf) => {
    const g = cv.getContext('2d');
    if (!g) return;
    const d = buf.getChannelData(0), w = cv.width, h = cv.height, per = Math.max(1, Math.floor(d.length / w));
    g.fillStyle = '#ffd166';
    for (let x = 0; x < w; x++) {
      let lo = 0, hi = 0;
      for (let i = x * per; i < Math.min(d.length, (x + 1) * per); i++) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
      g.fillRect(x, h / 2 - hi * h / 2, 1, Math.max(1, (hi - lo) * h / 2));
    }
  }).catch(() => { /* the row already says why */ });
  return cv;
}

function drawReport(out: HTMLElement, r: CheckReport): void {
  const f = (x: number, n = 3) => x.toFixed(n);
  const cell = (ok: boolean, why: string) => el('td', { className: ok ? 'ok' : 'fail' }, ok ? 'OK' : why);
  const sfxT = el('table');
  sfxT.append(el('tr', {}, ...['sfx', 'wave', 'peak', 'loudness', 'ms', 'limit', ''].map((h) => el('th', {}, h))));
  for (const row of r.sfx) {
    sfxT.append(el('tr', {},
      el('td', {}, row.name), el('td', {}, drawWave(row.name, Math.min(row.maxMs, row.durationMs + 80))),
      el('td', {}, f(row.peak)), el('td', {}, f(row.loud)), el('td', {}, String(row.durationMs)), el('td', {}, String(row.maxMs)),
      cell(row.ok, row.why)));
  }
  const trT = el('table');
  trT.append(el('tr', {}, ...['track', 'bpm', 'bars', 'loop s', 'channels', 'notes/loop', 'peak', 'rms', 'quietest bar', ''].map((h) => el('th', {}, h))));
  for (const row of r.tracks) {
    trT.append(el('tr', {},
      el('td', {}, row.name), el('td', {}, String(row.bpm)), el('td', {}, String(row.bars)), el('td', {}, f(row.loopSeconds, 1)),
      el('td', {}, String(row.channels)), el('td', {}, String(row.notes)), el('td', {}, f(row.peak)), el('td', {}, f(row.rms)),
      el('td', {}, f(row.quietestBar)), cell(row.ok, row.why)));
  }
  const bad = r.sfx.filter((x) => !x.ok).length + r.tracks.filter((x) => !x.ok).length;
  out.replaceChildren(
    el('p', { className: 'status' }, r.ok ? `ALL ${r.sfx.length} SFX AND ${r.tracks.length} TRACKS PASS` : `${bad} FAILING`),
    trT, sfxT,
  );
}

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------

const unlock = () => { unlockAudio(); refresh(); };
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);
build();

const hooks = window.__game;
if (hooks) {
  hooks.api = {
    runChecks,
    state: () => ({
      unlocked: isAudioUnlocked(), facadeUnlocked: audio.unlocked, sound: isSoundOn(), music: isMusicOn(),
      wanted: currentMusic(), playing: audio.music.current,
    }),
    unlock: () => unlockAudio(),
    sfx: (n: SfxName) => sfx(n),
    music: (n: TrackName | null) => music(n),
    setSound: (on: boolean) => setSound(on),
    setMusic: (on: boolean) => setMusic(on),
    moveSfx: () => Object.fromEntries(TYPE_IDS.map((t) => [t, moveSfx(t)])),
  };
  hooks.ready = true;
}
