// Dragon Hamsters' soundtrack: six looping tracks in the vendored sequencer's format (src/lib/audio/sequencer.ts).
// A track is data: tempo, key, an 8-bar chord loop and channels of step patterns, one step a sixteenth note.
// Melodies and bass lines are written as absolute notes ('Bb4:2' = B flat 4 held two sixteenths, '-:4' = a beat
// of rest); accompaniment uses the chord-relative tokens (`r` the chord's bass, `cK` its K-th tone, `chord` all of
// them) so it follows the chord loop on its own. Drums are one character a step: K kick, S snare, H/h hat,
// O open hat, C clang, T/t tick, w woodblock, x shaker. Every channel is a whole number of bars that divides the
// 8-bar loop, which the audio gallery (dev/audio.html) checks along with the note count and levels.
//
// The channel marked `harmony: true` in each track is the second voice: the facade mixes it through its own
// gain, so it can be pulled down without touching this data.
import { registerInstrument } from '../lib/audio/sequencer.ts';
import type { Track } from '../lib/audio/sequencer.ts';
import { osc } from '../lib/audio/synth.ts';

/** Every track the game plays. */
export const TRACK_NAMES = ['title', 'burrow', 'mission', 'battle', 'boss', 'victory'] as const;
export type TrackName = (typeof TRACK_NAMES)[number];

/**
 * A twangy spy guitar for the mission theme: a resonant sawtooth that scoops up into each note and wobbles a
 * little at the end, with a soft triangle body under it.
 */
registerInstrument('dh_twang', (c, d, t, { f, dur, vel }) => {
  osc(c, d, t, { type: 'sawtooth', f0: f * 0.97, f1: f, glide: 0.035, dur, vol: 0.1 * vel, attack: 0.003, hold: dur * 0.35, lp: 1700, q: 4, vib: { rate: 6, depth: 12 } });
  osc(c, d, t, { type: 'triangle', f0: f, dur, vol: 0.07 * vel, attack: 0.003, hold: dur * 0.3 });
});

/** Join one pattern string per bar. */
const bars = (...b: string[]): string => b.join(' | ');
/** Repeat a one-bar drum pattern. */
const rep = (bar: string, n: number): string => Array.from({ length: n }, () => bar).join('|');

// ---------------------------------------------------------------------------------------------
// TITLE: whimsical adventure. F major, a bouncing march: chiptune lead, marimba arpeggios, a tuba-ish
// oom-pah bass and woodblocks where the snare would be.
// ---------------------------------------------------------------------------------------------
const title: Track = {
  name: 'title', bpm: 112, key: 'F', swing: 0.1,
  chords: ['F', 'Am', 'Bb', 'C', 'Dm', 'Bb', 'Gm7', 'C7'],
  channels: [
    {
      inst: 'lead_pulse', vol: 1, gate: 0.85, pat: bars(
        'C5:2 F5:2 A5:3 G5:1 F5:2 C5:2 A4:4',
        'E5:2 A5:2 C6:3 Bb5:1 A5:2 G5:2 E5:4',
        'D5:2 F5:2 Bb5:3 A5:1 G5:2 F5:2 D5:2 F5:2',
        'E5:3 F5:1 G5:4 C5:2 D5:2 E5:4',
        'F5:2 A5:2 D6:3 C6:1 A5:2 F5:2 D5:4',
        'Bb5:2 A5:2 G5:2 F5:2 D5:2 F5:2 Bb5:4',
        'A5:2 G5:2 F5:2 G5:2 Bb5:3 A5:1 G5:4',
        'G5:2 E5:2 C5:2 E5:1 G5:1 Bb5:3 A5:1 G5:2 E5:2',
      ),
    },
    { inst: 'marimba', oct: 4, vol: 0.5, pat: 'c0:2 c1:2 c2:2 c1:2 c3:2 c2:2 c1:2 c2:2' },
    { inst: 'flute', oct: 4, vol: 0.75, gate: 0.9, harmony: true, pat: 'c1:8 c2:8' },
    { inst: 'bass_tri', oct: 2, vol: 0.8, gate: 0.7, pat: 'r:3 -:1 c2:3 -:1 r:3 -:1 c2:2 c1:2' },
    { inst: 'drums', vol: 0.65, pat: rep('K.h.w.h.K.hKw.hh', 3) + '|K.h.w.h.K.wwwwww' },
  ],
};

// ---------------------------------------------------------------------------------------------
// BURROW: a cosy, relaxed loop for home. G major sevenths at a lazy swing: breathy flute, an upright
// bass, soft offbeat keys, a warm pad, shaker and rimshot woodblock, and a bell now and then.
// ---------------------------------------------------------------------------------------------
const burrow: Track = {
  name: 'burrow', bpm: 84, key: 'G', swing: 0.16,
  chords: ['Gmaj7', 'Em7', 'Am7', 'D7', 'Bm7', 'Em7', 'Am7', 'D7'],
  channels: [
    {
      inst: 'flute', vol: 0.95, pat: bars(
        '-:2 B4:2 D5:2 G5:4 F#5:2 D5:4',
        'E5:6 D5:2 B4:4 G4:4',
        '-:2 A4:2 C5:2 E5:4 D5:2 C5:2 B4:2',
        'A4:8 -:4 F#4:2 A4:2',
        '-:2 B4:2 D5:2 F#5:4 E5:2 D5:4',
        'G5:6 F#5:2 E5:4 B4:4',
        'C5:4 E5:4 D5:2 C5:2 A4:4',
        'D5:8 C5:2 B4:2 A4:4',
      ),
    },
    { inst: 'pluck', oct: 4, vol: 0.32, gate: 0.6, pat: '-:2 chord:2 -:4 -:2 chord:2 -:2 chord:2' },
    { inst: 'pad', oct: 3, vol: 0.55, harmony: true, wide: 10, pat: 'chord:16' },
    { inst: 'bass_pluck', oct: 2, vol: 0.9, pat: 'r:6 r:2 c2:6 c1:2' },
    { inst: 'bell', vol: 0.35, pat: 'B5:8 -:24 A5:8 -:24' },
    { inst: 'drums', vol: 0.5, pat: 'K.x.w.xK..x.w.x.' },
  ],
};

// ---------------------------------------------------------------------------------------------
// MISSION: the sneaky spy theme. E minor on tiptoe: a twangy spy guitar, a creeping chromatic walking
// bass, brushed hats and rim ticks, and a muted-brass "ba-BAAP" closing each four-bar phrase.
// ---------------------------------------------------------------------------------------------
const mission: Track = {
  name: 'mission', bpm: 104, key: 'E', swing: 0.14,
  chords: ['Em', 'Em', 'C7', 'B7', 'Em', 'Am', 'C7', 'B7'],
  channels: [
    {
      inst: 'dh_twang', vol: 1, gate: 0.6, pat: bars(
        '-:4 B4:1 -:1 B4:1 -:1 C5:2 B4:2 -:4',
        '-:4 B4:1 -:1 B4:1 -:1 D5:2 C5:2 B4:2 G4:2',
        '-:4 E5:1 -:1 E5:1 -:1 G5:2 E5:2 -:2 A#4:2',
        'A4:2 -:2 F#4:2 -:2 D#5:6 -:2',
        'E5:3 -:1 G5:2 F#5:2 E5:2 -:2 B4:4',
        'C5:3 -:1 E5:2 D#5:2 E5:2 -:2 A4:4',
        'G4:2 A#4:2 C5:2 E5:2 G5:2 E5:2 A#4:2 G4:2',
        'F#4:2 A4:2 B4:2 D#5:2 F#5:4 -:2 B4:1 -:1',
      ),
    },
    {
      inst: 'bass_pluck', vol: 1, gate: 0.8, pat: bars(
        'E2:2 -:2 E2:2 G2:2 -:2 A2:2 A#2:2 B2:2',
        'E2:2 -:2 E2:2 G2:2 -:2 B2:2 A2:2 G2:2',
        'C3:2 -:2 C3:2 A#2:2 -:2 G2:2 E2:2 G2:2',
        'B2:2 -:2 B2:2 A2:2 -:2 F#2:2 D#2:2 F#2:2',
        'E2:2 -:2 E2:2 G2:2 -:2 A2:2 A#2:2 B2:2',
        'A2:2 -:2 A2:2 C3:2 -:2 E3:2 D3:2 C3:2',
        'C3:2 -:2 C3:2 A#2:2 -:2 G2:2 E2:2 G2:2',
        'B2:2 -:2 B2:2 D#3:2 F#3:2 A3:2 F#3:2 D#3:2',
      ),
    },
    { inst: 'brass', oct: 4, vol: 0.8, gate: 0.8, harmony: true, pat: '-:48 -:4 chord:2 -:2 chord:6 -:2' },
    { inst: 'drums', vol: 0.6, pat: rep('K.h.T.h.K.hhT.h.', 3) + '|K.h.T.h.K.hhTtTt' },
  ],
};

// ---------------------------------------------------------------------------------------------
// BATTLE: upbeat and driving. D minor at full tilt: a heroic chiptune lead, octave-bouncing square bass,
// a sixteenth-note harpsichord arpeggio and a busy kit with a snare fill every eighth bar.
// ---------------------------------------------------------------------------------------------
const battle: Track = {
  name: 'battle', bpm: 152, key: 'D', swing: 0.03,
  chords: ['Dm', 'Bb', 'C', 'Dm', 'Gm', 'Bb', 'C', 'A7'],
  channels: [
    {
      inst: 'lead_pulse', vol: 1, gate: 0.9, pat: bars(
        'D5:2 F5:2 A5:4 G5:2 F5:2 E5:2 F5:2',
        'D5:4 -:2 Bb4:2 D5:2 F5:2 Bb5:4',
        'A5:3 G5:3 E5:2 C5:4 E5:2 G5:2',
        'F5:4 E5:2 D5:2 A4:8',
        'G5:2 A5:2 Bb5:4 A5:2 G5:2 F5:2 G5:2',
        'F5:3 D5:3 Bb4:2 F5:2 G5:2 A5:4',
        'G5:3 E5:3 C5:2 G5:2 A5:2 Bb5:4',
        'A5:2 G5:2 E5:2 C#5:2 E5:2 G5:2 A5:4',
      ),
    },
    { inst: 'harpsi', oct: 4, vol: 0.6, harmony: true, pat: 'c0 c1 c2 c3 c2 c1 c0 c1 c2 c3 c2 c1 c0 c1 c2 c1' },
    { inst: 'bass_square', oct: 2, vol: 0.85, gate: 0.8, pat: 'r:2 r:2 r+12:2 r:2 r:2 r+12:2 r:2 c2:2' },
    { inst: 'drums', vol: 0.75, pat: rep('KhHhShHKKhHhShHH', 7) + '|KhHhShHKK.S.SSSS' },
  ],
};

// ---------------------------------------------------------------------------------------------
// BOSS: a tense villain theme with a comic edge. C minor: a sneering evil organ doubled by brass, a
// distorted tango bass, a tick-tock clock that never stops, a gong-ish clang every four bars, and a
// melody that ends each loop sliding chromatically down the banister.
// ---------------------------------------------------------------------------------------------
const BOSS_TUNE = bars(
  'C5:3 C5:1 Eb5:3 D5:1 C5:2 B4:2 C5:4',
  'G4:3 G4:1 Ab4:3 G4:1 F#4:2 G4:2 -:4',
  'C5:3 C5:1 Eb5:3 F5:1 Ab5:4 G5:2 F5:2',
  'G5:2 F5:2 Eb5:2 D5:2 B4:4 -:2 G4:2',
  'F5:3 F5:1 Ab5:3 G5:1 F5:2 E5:2 F5:4',
  'Eb5:3 Eb5:1 G5:3 F5:1 Eb5:2 D5:2 C5:4',
  'D5:2 F5:2 Ab5:2 F5:2 D5:2 F5:2 Ab5:2 B5:2',
  'C6:2 B5:2 Bb5:2 A5:2 Ab5:2 G5:2 -:2 G4:2',
);
const boss: Track = {
  name: 'boss', bpm: 138, key: 'C', swing: 0.04,
  chords: ['Cm', 'Cm', 'Ab', 'G7', 'Fm', 'Cm', 'Ddim', 'G7'],
  channels: [
    { inst: 'organ', vol: 0.9, gate: 0.85, pat: BOSS_TUNE },
    { inst: 'brass', vol: 0.75, gate: 0.7, transpose: -12, harmony: true, pat: BOSS_TUNE },
    { inst: 'bass_dist', oct: 2, vol: 0.75, gate: 0.75, pat: 'r:3 r:1 c2:2 r:2 r:3 r:1 c1:2 c2:2' },
    { inst: 'drums', vol: 0.75, pat: rep('K..KS...K..KS.HH', 3) + '|K..KS..SK.SKSSSS' },
    { inst: 'drums', vol: 0.5, pat: 'C.t.w.t.w.t.w.t.|' + rep('w.t.w.t.w.t.w.t.', 3) },
  ],
};

// ---------------------------------------------------------------------------------------------
// VICTORY: a short fanfare that rolls into a jaunty victory lap. C major: two bars of brass-doubled
// fanfare over a snare roll, then six bouncing bars that turn around into the fanfare again.
// ---------------------------------------------------------------------------------------------
const VICTORY_TUNE = bars(
  'G4:2 C5:2 E5:2 G5:6 E5:2 G5:2',
  'C6:12 -:4',
  'A5:2 G5:2 F5:2 A5:2 C6:4 A5:4',
  'B5:2 A5:2 G5:2 B5:2 D6:4 B5:4',
  'C6:3 G5:1 E5:2 G5:2 C6:2 D6:2 E6:4',
  'E6:2 D6:2 C6:2 A5:2 E5:4 A5:4',
  'F5:2 A5:2 C6:4 A5:2 F5:2 A5:4',
  'G5:2 B5:2 D6:2 F6:2 E6:2 D6:2 B5:2 G5:2',
);
const victory: Track = {
  name: 'victory', bpm: 140, key: 'C', swing: 0.06,
  chords: ['C', 'C', 'F', 'G', 'C', 'Am', 'F', 'G7'],
  channels: [
    { inst: 'lead_pulse', vol: 1, gate: 0.9, pat: VICTORY_TUNE },
    { inst: 'brass', vol: 0.65, gate: 0.85, transpose: -12, harmony: true, pat: VICTORY_TUNE },
    { inst: 'bass_tri', oct: 2, vol: 0.8, gate: 0.7, pat: 'r:2 -:2 c2:2 -:2 r:2 -:2 c2:2 c1:2' },
    { inst: 'bell', vol: 0.3, pat: '-:16 C6:16 -:96' },
    {
      inst: 'drums', vol: 0.7,
      pat: 'K.S.K.S.K.S.SSSS|O...K...K.S.SSSS|' + rep('K.h.S.h.K.hKS.h.', 5) + '|K.h.S.h.K.S.SSSS',
    },
  ],
};

/** The tracks, by name, for the facade. */
export const TRACKS: Record<TrackName, Track> = { title, burrow, mission, battle, boss, victory };
