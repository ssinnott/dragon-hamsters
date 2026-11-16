// The game's audio singleton: the vendored facade (src/lib/audio/facade.ts) built from our SFX table and tracks,
// wrapped in the small API the rest of the game uses (docs/API.md "src/audio").
//
// How it behaves:
// - Nothing makes a sound until unlockAudio() has been called (browsers only start an AudioContext from a user
//   gesture). Before that, sfx() is dropped and music() only remembers what was asked for, so the title screen can
//   ask for its theme on frame one and hear it from the first click.
// - The facade's own gesture listeners are installed at import, so the context is created and resumed inside
//   the real keydown/pointerdown handler even when the UI calls unlockAudio() later from its update loop (Safari
//   insists on that), and every later gesture resumes a context the OS suspended (iOS calls, tab sleeps).
// - setSound(false) drops SFX; setMusic(false) fades the music out and setMusic(true) brings the last requested
//   track back. Both are plain switches: persisting them is the settings screen's job (GameState.settings).
// - Asking for the track that is already playing is a no-op, and changing tracks is a 0.5s equal-power crossfade.
// - None of these functions ever throws: sound is a nicety, never a reason for a scene to crash.
import { createAudio } from '../lib/audio/facade.ts';
import type { PlayOpts } from '../lib/audio/facade.ts';
import type { TypeId } from '../data/schema.ts';
import { SFX, SFX_NAMES, JITTERED } from './sfx.ts';
import type { SfxName } from './sfx.ts';
import { TRACKS, TRACK_NAMES } from './tracks.ts';
import type { TrackName } from './tracks.ts';

export type { SfxName, TrackName };
export { SFX_NAMES, TRACK_NAMES };

/** The facade itself, for the audio gallery and tests (selfTest, render, testMode). Game code uses the functions below. */
export const audio = createAudio({ sfx: SFX, jittered: JITTERED, tracks: TRACKS });

/** The sound each type's moves make. */
const MOVE_SFX: Record<TypeId, SfxName> = {
  FLUFF: 'fluff', FIRE: 'fire', WATER: 'water', LEAF: 'leaf', LIGHTNING: 'spark', EARTH: 'quake', ROCK: 'rock',
  WINGED: 'wind', FROST: 'ice', SLIME: 'goo', DARKNESS: 'shadow', LIGHT: 'light', COOKING: 'cook', METAL: 'metal',
  MIND: 'psy', BRAWL: 'punch',
};

let unlocked = false;
let soundOn = true;
let musicOn = true;
/** The track the game last asked for (null: silence), whether or not it can play right now. */
let wanted: TrackName | null = null;

try {
  if (typeof window !== 'undefined') audio.init();
} catch { /* no WebAudio, no listeners: the game is silent, not broken */ }

/** Start the requested track (or stop) if music can play now. */
function applyMusic(): void {
  if (!unlocked) return;
  if (musicOn && wanted) audio.music.play(wanted);
  else audio.music.stop();
}

/** Play a sound effect. `opts` can scale its volume or pitch, or schedule it `delay` seconds ahead. */
export function sfx(name: SfxName, opts?: PlayOpts): void {
  if (!unlocked || !soundOn) return;
  try { audio.play(name, opts); } catch { /* never throw */ }
}

/** Ask for a track (crossfading from the current one), or null for silence. Repeating the current track is a no-op. */
export function music(name: TrackName | null): void {
  wanted = name && Object.prototype.hasOwnProperty.call(TRACKS, name) ? name : null;
  try { applyMusic(); } catch { /* never throw */ }
}

/** The sound a move of this type makes. */
export function moveSfx(type: TypeId): SfxName {
  return MOVE_SFX[type] ?? 'hit';
}

/** Sound effects on or off. */
export function setSound(on: boolean): void {
  soundOn = !!on;
}

/** Music on or off. Turning it back on resumes the last requested track. */
export function setMusic(on: boolean): void {
  if (musicOn === !!on) return;
  musicOn = !!on;
  try { applyMusic(); } catch { /* never throw */ }
}

/** Call from the first user gesture (calling it again is harmless and resumes a suspended context). */
export function unlockAudio(): void {
  try {
    if (typeof window === 'undefined') return;
    audio.unlock();
    // false in the facade's test mode or without WebAudio: everything stays a silent no-op
    if (!audio.unlocked) return;
    const first = !unlocked;
    unlocked = true;
    if (first) applyMusic();
  } catch { /* never throw */ }
}

/** Whether unlockAudio() has opened the audio context. */
export function isAudioUnlocked(): boolean { return unlocked; }
/** Whether sound effects are switched on. */
export function isSoundOn(): boolean { return soundOn; }
/** Whether music is switched on. */
export function isMusicOn(): boolean { return musicOn; }
/** The track the game last asked for (it plays once unlocked and while music is on). */
export function currentMusic(): TrackName | null { return wanted; }
