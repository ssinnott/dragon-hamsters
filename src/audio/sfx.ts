// Dragon Hamsters' sound effects: every SfxName as a short synthesized sound, written against the vendored
// engine's voices (src/lib/audio/synth.ts). The palette is warm 8-bit: squares and triangles behind gentle
// lowpasses, sine thumps for impacts, filtered noise for whooshes, and a short multi-tap echo on anything that
// should sparkle. Every entry is pure `(ctx, dest, when, opts)` code, so the facade plays it in the game and
// renders it offline for the self-test (dev/audio.html) with no difference between the two.
//
// `o.v` scales volume (already ducked by the facade when hits pile up) and `o.p` scales pitch (the jittered names
// get a small random wobble), and the helpers below apply both to every voice, so no entry has to remember to.
// Raw levels are kept under ~0.85 peak: the facade's compressor then glues the mix without ever clipping.
import { osc, noise, ring, am, echo, glass } from '../lib/audio/synth.ts';
import type { OscOpts, NoiseOpts, RingOpts, AmOpts, EchoOpts } from '../lib/audio/synth.ts';
import { midiToHz } from '../lib/audio/sfx.ts';
import type { SfxDef, SfxOpts } from '../lib/audio/sfx.ts';
import { noteMidi } from '../lib/audio/sequencer.ts';

/** Every sound effect the game plays, in the order the gallery lists them. */
export const SFX_NAMES = [
  'click', 'back', 'select', 'error', 'hit', 'hitSuper', 'hitWeak', 'miss', 'crit', 'faint',
  'heal', 'levelUp', 'statUp', 'statDown', 'status', 'coin', 'eat', 'evolve', 'swap', 'dig', 'wheel',
  'snore', 'sparkle', 'victory', 'defeat', 'boss', 'fire', 'water', 'leaf', 'spark', 'quake', 'wind',
  'ice', 'goo', 'shadow', 'light', 'cook', 'metal', 'psy', 'punch', 'rock', 'fluff',
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/**
 * Names that get the facade's +/-4% random pitch per play: the ones a player hears many times in a row
 * (menu taps, hits, coins counting up), so a mashed button never sounds like a machine.
 */
export const JITTERED: readonly SfxName[] = [
  'click', 'back', 'select', 'hit', 'hitWeak', 'miss', 'coin', 'eat', 'dig', 'punch', 'rock', 'fluff',
  'water', 'goo', 'sparkle',
];

type Ctx = BaseAudioContext;

// ---------------------------------------------------------------------------------------------
// Helpers: the engine's voices with this play's pitch and volume folded in
// ---------------------------------------------------------------------------------------------

const NOTE_HZ = new Map<string, number>();
/** Note name ('C5', 'Bb4', 'F#6') -> Hz. */
function hz(name: string): number {
  let f = NOTE_HZ.get(name);
  if (f === undefined) {
    const m = noteMidi(name);
    if (m === null) throw new Error(`sfx: bad note '${name}'`);
    f = midiToHz(m);
    NOTE_HZ.set(name, f);
  }
  return f;
}

/** An oscillator voice; f0/f1 scaled by the play's pitch, vol by its volume. */
function tone(c: Ctx, d: AudioNode, t: number, s: SfxOpts, o: OscOpts): number {
  return osc(c, d, t, { ...o, f0: (o.f0 ?? 440) * s.p, f1: o.f1 === undefined ? undefined : o.f1 * s.p, vol: (o.vol ?? 0.3) * s.v });
}
/** A filtered noise burst; the filter follows the pitch so a jittered whoosh wobbles too. */
function hiss(c: Ctx, d: AudioNode, t: number, s: SfxOpts, o: NoiseOpts): number {
  return noise(c, d, t, { ...o, f0: (o.f0 ?? 2000) * s.p, f1: o.f1 === undefined ? undefined : o.f1 * s.p, vol: (o.vol ?? 0.3) * s.v });
}
/** Ring modulation: metallic clangs and electric buzz. */
function clang(c: Ctx, d: AudioNode, t: number, s: SfxOpts, o: RingOpts): number {
  return ring(c, d, t, {
    ...o, f0: (o.f0 ?? 180) * s.p, f1: o.f1 === undefined ? undefined : o.f1 * s.p,
    modF: (o.modF ?? 1300) * s.p, modF1: o.modF1 === undefined ? undefined : o.modF1 * s.p, vol: (o.vol ?? 0.3) * s.v,
  });
}
/** Amplitude-wobbled oscillator: whirrs, snores, wobbly status. */
function wobble(c: Ctx, d: AudioNode, t: number, s: SfxOpts, o: AmOpts): number {
  return am(c, d, t, { ...o, f0: (o.f0 ?? 2000) * s.p, f1: o.f1 === undefined ? undefined : o.f1 * s.p, vol: (o.vol ?? 0.3) * s.v });
}
/** The detuned glassy chord, for twinkles and magic. */
function chime(c: Ctx, d: AudioNode, t: number, s: SfxOpts, notes: readonly string[], dur: number, vol: number, trem = 5): number {
  return glass(c, d, t, { freqs: notes.map((n) => hz(n) * s.p), dur, vol: vol * s.v, trem, detune: 7, attack: 0.01 });
}
/** A short echo bus fed for `life` seconds from `t`: voices routed into it get a small room around them. */
function room(c: Ctx, d: AudioNode, t: number, life: number, o: EchoOpts = {}): GainNode {
  return echo(c, d, { taps: 3, time: 0.085, decay: 0.55, wet: 0.32, lowpass: 4200, ...o, when: t, life });
}
/** Play `notes` one after another, `step` seconds apart, each as one `tone` with `o`. Returns the last end. */
function run(c: Ctx, d: AudioNode, t: number, s: SfxOpts, notes: readonly string[], step: number, o: OscOpts): number {
  let end = t;
  notes.forEach((n, i) => { end = tone(c, d, t + i * step, s, { ...o, f0: hz(n) }); });
  return end;
}
/** A warm 8-bit note: a lowpassed square with a triangle under it, so it chirps without buzzing. */
function chip(c: Ctx, d: AudioNode, t: number, s: SfxOpts, note: string, dur: number, vol: number, extra: OscOpts = {}): number {
  const f = hz(note);
  tone(c, d, t, s, { type: 'square', f0: f, dur, vol: vol * 0.6, attack: 0.004, hold: dur * 0.35, lp: 3200, ...extra });
  return tone(c, d, t, s, { type: 'triangle', f0: f, dur, vol: vol * 0.8, attack: 0.004, hold: dur * 0.35, ...extra });
}
/** A soft round thump: the body of every impact. */
function thump(c: Ctx, d: AudioNode, t: number, s: SfxOpts, from: number, to: number, dur: number, vol: number): number {
  return tone(c, d, t, s, { type: 'sine', f0: from, f1: to, glide: dur * 0.7, dur, vol, attack: 0.002 });
}

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------

export const SFX: Record<SfxName, SfxDef> = {
  // ---- interface ----
  /** A tiny wooden blip: every menu tap. */
  click: (c, d, t, s) => {
    tone(c, d, t, s, { type: 'square', f0: 1320, f1: 1100, dur: 0.035, vol: 0.09, lp: 3000 });
    return tone(c, d, t, s, { type: 'triangle', f0: 660, dur: 0.04, vol: 0.16 });
  },
  /** Two notes stepping down: closing a menu. */
  back: (c, d, t, s) => {
    chip(c, d, t, s, 'G5', 0.05, 0.16);
    return chip(c, d, t + 0.055, s, 'D5', 0.07, 0.16);
  },
  /** Two notes stepping up with a little room: picking something. */
  select: (c, d, t, s) => {
    const e = room(c, d, t, 0.2, { wet: 0.25 });
    chip(c, e, t, s, 'E5', 0.05, 0.16);
    return chip(c, e, t + 0.055, s, 'B5', 0.1, 0.17) + 0.15;
  },
  /** A rubbery "bonk-bonk": not allowed. */
  error: (c, d, t, s) => {
    for (const at of [0, 0.12]) {
      tone(c, d, t + at, s, { type: 'square', f0: 196, f1: 175, dur: 0.09, vol: 0.14, lp: 1100, hold: 0.04 });
      tone(c, d, t + at, s, { type: 'triangle', f0: 98, dur: 0.09, vol: 0.2, hold: 0.04 });
    }
    return t + 0.21;
  },

  // ---- battle ----
  /** A solid bonk: a normal hit. */
  hit: (c, d, t, s) => {
    hiss(c, d, t, s, { type: 'lowpass', f0: 3200, f1: 400, dur: 0.09, vol: 0.3 });
    tone(c, d, t, s, { type: 'square', f0: 150, f1: 60, dur: 0.06, vol: 0.08, lp: 900 });
    return thump(c, d, t, s, 220, 70, 0.13, 0.42);
  },
  /** KA-BLAM: a double impact with a crunch, a bright "super!" ping and a room tail. Clearly the big one. */
  hitSuper: (c, d, t, s) => {
    const e = room(c, d, t, 0.35, { wet: 0.3, time: 0.07 });
    thump(c, e, t, s, 190, 42, 0.32, 0.5);
    hiss(c, e, t, s, { type: 'lowpass', f0: 6000, f1: 300, dur: 0.24, vol: 0.34 });
    tone(c, e, t, s, { type: 'square', f0: 320, f1: 70, dur: 0.2, vol: 0.12, lp: 1800 });
    thump(c, e, t + 0.075, s, 150, 45, 0.22, 0.4);
    hiss(c, e, t + 0.075, s, { type: 'bandpass', f0: 1400, f1: 500, q: 0.8, dur: 0.16, vol: 0.32 });
    run(c, e, t + 0.04, s, ['C6', 'G6'], 0.05, { type: 'square', dur: 0.09, vol: 0.06, lp: 4000, attack: 0.003 });
    return t + 0.6;
  },
  /** A muffled "plap" into a cushion: not very effective. */
  hitWeak: (c, d, t, s) => {
    hiss(c, d, t, s, { type: 'lowpass', f0: 650, f1: 220, dur: 0.07, vol: 0.22 });
    tone(c, d, t, s, { type: 'triangle', f0: 150, f1: 105, dur: 0.09, vol: 0.24, lp: 450 });
    return tone(c, d, t + 0.05, s, { type: 'sine', f0: 280, f1: 190, dur: 0.08, vol: 0.06 });
  },
  /** A whiff of air and a sheepish little drop. */
  miss: (c, d, t, s) => {
    hiss(c, d, t, s, { type: 'bandpass', f0: 500, f1: 3200, q: 1.2, dur: 0.22, attack: 0.07, vol: 0.75 });
    return tone(c, d, t + 0.16, s, { type: 'sine', f0: 900, f1: 480, dur: 0.12, vol: 0.13 });
  },
  /** A hit with a bright metallic "shing!" ringing over it. */
  crit: (c, d, t, s) => {
    const e = room(c, d, t, 0.3, { wet: 0.35, time: 0.06 });
    clang(c, e, t, s, { type: 'square', f0: 1760, modF: 2650, dur: 0.3, vol: 0.1 });
    hiss(c, e, t, s, { type: 'highpass', f0: 6500, dur: 0.14, vol: 0.18 });
    hiss(c, d, t, s, { type: 'lowpass', f0: 4200, f1: 400, dur: 0.12, vol: 0.32 });
    thump(c, d, t, s, 210, 50, 0.2, 0.42);
    return t + 0.5;
  },
  /** A sad slide all the way down, a tiny wobble, and a soft flop at the bottom. */
  faint: (c, d, t, s) => {
    const vib = { rate: 7, depth: 28 };
    tone(c, d, t, s, { type: 'square', f0: 784, f1: 110, dur: 0.95, vol: 0.12, hold: 0.45, lp: 1600, vib, attack: 0.01 });
    tone(c, d, t, s, { type: 'triangle', f0: 392, f1: 55, dur: 0.95, vol: 0.2, hold: 0.45, vib, attack: 0.01 });
    thump(c, d, t + 0.92, s, 130, 60, 0.14, 0.3);
    return hiss(c, d, t + 0.92, s, { type: 'lowpass', f0: 500, dur: 0.12, vol: 0.16 });
  },
  /** A rising sparkle of a C chord with a glassy bloom at the top. */
  heal: (c, d, t, s) => {
    const e = room(c, d, t, 0.6);
    run(c, e, t, s, ['C6', 'E6', 'G6', 'C7'], 0.065, { type: 'triangle', dur: 0.22, vol: 0.14, attack: 0.004 });
    run(c, e, t, s, ['C5', 'E5', 'G5', 'C6'], 0.065, { type: 'sine', dur: 0.22, vol: 0.08, attack: 0.004 });
    chime(c, e, t + 0.26, s, ['E6', 'C7'], 0.45, 0.05, 7);
    return t + 0.95;
  },
  /** Ta-da-da-DAAA! An arpeggio up to a trilling top note over a C chord. */
  levelUp: (c, d, t, s) => {
    const e = room(c, d, t, 0.9, { wet: 0.22 });
    const step = 0.07;
    ['C5', 'E5', 'G5'].forEach((n, i) => chip(c, e, t + i * step, s, n, 0.08, 0.2));
    chip(c, e, t + 3 * step, s, 'C6', 0.12, 0.2);
    chip(c, e, t + 3 * step + 0.13, s, 'G5', 0.06, 0.18);
    const top = t + 3 * step + 0.2;
    chip(c, e, top, s, 'C6', 0.6, 0.22, { vib: { rate: 9, depth: 22 }, hold: 0.3 });
    chip(c, e, top, s, 'E5', 0.6, 0.1, { hold: 0.3 });
    tone(c, e, top, s, { type: 'triangle', f0: hz('C4'), dur: 0.5, vol: 0.18, hold: 0.25 });
    chime(c, e, top + 0.05, s, ['G6', 'C7'], 0.5, 0.035, 8);
    return top + 0.9;
  },
  /** Three quick upward swoops: "you feel stronger!" */
  statUp: (c, d, t, s) => {
    const e = room(c, d, t, 0.3, { wet: 0.2 });
    [300, 450, 600].forEach((f, i) => {
      tone(c, e, t + i * 0.07, s, { type: 'square', f0: f, f1: f * 2, dur: 0.08, vol: 0.08, lp: 2600, curve: 'lin' });
      tone(c, e, t + i * 0.07, s, { type: 'triangle', f0: f, f1: f * 2, dur: 0.08, vol: 0.12, curve: 'lin' });
    });
    chip(c, e, t + 0.23, s, 'E6', 0.12, 0.12);
    return t + 0.5;
  },
  /** Three droopy downward swoops: "uh oh". */
  statDown: (c, d, t, s) => {
    [1200, 900, 600].forEach((f, i) => {
      tone(c, d, t + i * 0.09, s, { type: 'square', f0: f, f1: f / 2, dur: 0.1, vol: 0.08, lp: 1900 });
      tone(c, d, t + i * 0.09, s, { type: 'triangle', f0: f, f1: f / 2, dur: 0.1, vol: 0.12 });
    });
    return t + 0.3;
  },
  /** An icky wub-wub wobble: something has come over you. */
  status: (c, d, t, s) => {
    wobble(c, d, t, s, { type: 'square', f0: 330, f1: 220, rate: 11, rate1: 7, depth: 1, dur: 0.45, vol: 0.14, lp: 1500, hold: 0.15 });
    return tone(c, d, t, s, { type: 'sine', f0: 165, f1: 120, dur: 0.45, vol: 0.18, hold: 0.15, vib: { rate: 6, depth: 40 } });
  },

  // ---- burrow and rewards ----
  /** Bling-blinggg: a coin in the pouch. */
  coin: (c, d, t, s) => {
    chip(c, d, t, s, 'B5', 0.07, 0.16);
    return chip(c, d, t + 0.07, s, 'E6', 0.28, 0.17, { hold: 0.06 });
  },
  /** Nom, nom, nom... mm! */
  eat: (c, d, t, s) => {
    [0, 0.11, 0.22].forEach((at, i) => {
      hiss(c, d, t + at, s, { type: 'bandpass', f0: 1900 - i * 200, q: 1.5, dur: 0.05, vol: 0.3 });
      tone(c, d, t + at, s, { type: 'triangle', f0: 310 - i * 20, f1: 200, dur: 0.06, vol: 0.14 });
    });
    return tone(c, d, t + 0.34, s, { type: 'sine', f0: hz('C5'), f1: hz('E5'), dur: 0.16, vol: 0.12, curve: 'lin', hold: 0.04 });
  },
  /** A magical swirl rising through three glassy chords to a big bright finish. */
  evolve: (c, d, t, s) => {
    const e = room(c, d, t, 1.4, { wet: 0.3, time: 0.1 });
    tone(c, e, t, s, { type: 'sine', f0: 220, f1: 1760, dur: 1.0, vol: 0.12, hold: 0.6, vib: { rate: 8, depth: 30 }, attack: 0.05 });
    tone(c, e, t, s, { type: 'triangle', f0: 110, f1: 880, dur: 1.0, vol: 0.1, hold: 0.6, attack: 0.05 });
    chime(c, e, t + 0.05, s, ['C5', 'G5'], 0.35, 0.04);
    chime(c, e, t + 0.35, s, ['E5', 'B5'], 0.35, 0.04);
    chime(c, e, t + 0.65, s, ['G5', 'D6'], 0.35, 0.04);
    hiss(c, e, t + 0.2, s, { type: 'highpass', f0: 6000, dur: 0.8, attack: 0.3, vol: 0.06 });
    const top = t + 1.0;
    ['C6', 'E6', 'G6'].forEach((n) => chip(c, e, top, s, n, 0.55, 0.1, { hold: 0.2 }));
    tone(c, e, top, s, { type: 'triangle', f0: hz('C4'), dur: 0.5, vol: 0.2, hold: 0.2 });
    chime(c, e, top, s, ['C7', 'G7'], 0.5, 0.03, 8);
    return top + 0.6;
  },
  /** Fwip... pop! One dragon out, the next one in. */
  swap: (c, d, t, s) => {
    hiss(c, d, t, s, { type: 'bandpass', f0: 900, f1: 4200, q: 1.5, dur: 0.1, vol: 0.2 });
    tone(c, d, t, s, { type: 'sine', f0: 380, f1: 1500, dur: 0.1, vol: 0.12 });
    tone(c, d, t + 0.12, s, { type: 'sine', f0: 950, f1: 420, dur: 0.06, vol: 0.24 });
    return hiss(c, d, t + 0.12, s, { type: 'highpass', f0: 3000, dur: 0.03, vol: 0.14 });
  },
  /** Two scoops of earth and a patter of pebbles. */
  dig: (c, d, t, s) => {
    for (const [at, f] of [[0, 950], [0.13, 1050]]) {
      hiss(c, d, t + at, s, { type: 'bandpass', f0: f, f1: f * 0.52, q: 0.8, dur: 0.09, vol: 0.85 });
      tone(c, d, t + at, s, { type: 'triangle', f0: 190, f1: 120, dur: 0.06, vol: 0.14 });
    }
    [[0.08, 1400], [0.21, 1750], [0.27, 1200]].forEach(([at, f]) => tone(c, d, t + at, s, { type: 'triangle', f0: f, dur: 0.025, vol: 0.13 }));
    return t + 0.3;
  },
  /** The wheel whirring up to speed, squeaking as it goes. */
  wheel: (c, d, t, s) => {
    wobble(c, d, t, s, { type: 'triangle', f0: 480, f1: 720, rate: 12, rate1: 32, depth: 0.85, dur: 0.6, vol: 0.18, lp: 2500, attack: 0.04, hold: 0.3 });
    hiss(c, d, t, s, { type: 'bandpass', f0: 700, f1: 1400, q: 2, dur: 0.6, vol: 0.06, attack: 0.1, hold: 0.3 });
    for (const at of [0.1, 0.3, 0.46]) tone(c, d, t + at, s, { type: 'sine', f0: 1800, f1: 2300, dur: 0.06, vol: 0.07, curve: 'lin' });
    return t + 0.6;
  },
  /** A snuffly "hnnnk" in and a whistly "fweee" out. */
  snore: (c, d, t, s) => {
    hiss(c, d, t, s, { type: 'bandpass', f0: 500, f1: 1100, q: 2, dur: 0.45, attack: 0.3, vol: 0.12 });
    wobble(c, d, t + 0.05, s, { type: 'sawtooth', f0: 92, f1: 104, rate: 28, depth: 0.9, dur: 0.42, attack: 0.25, vol: 0.16, lp: 700 });
    return tone(c, d, t + 0.52, s, { type: 'sine', f0: 1500, f1: 880, dur: 0.42, vol: 0.07, attack: 0.04, hold: 0.15, vib: { rate: 5, depth: 25 } });
  },
  /** Four tinkling stars. */
  sparkle: (c, d, t, s) => {
    const e = room(c, d, t, 0.4, { wet: 0.4, time: 0.06 });
    run(c, e, t, s, ['E6', 'B6', 'G#6', 'E7'], 0.06, { type: 'sine', dur: 0.18, vol: 0.12, attack: 0.002 });
    run(c, e, t, s, ['E6', 'B6', 'G#6', 'E7'], 0.06, { type: 'triangle', dur: 0.08, vol: 0.06, attack: 0.002 });
    return t + 0.6;
  },
  /** A short winner's jingle: up the C chord and a held, trilling top with harmony. */
  victory: (c, d, t, s) => {
    const e = room(c, d, t, 1.1, { wet: 0.22 });
    chip(c, e, t, s, 'G4', 0.09, 0.2);
    chip(c, e, t + 0.1, s, 'C5', 0.09, 0.2);
    chip(c, e, t + 0.2, s, 'E5', 0.09, 0.2);
    chip(c, e, t + 0.3, s, 'G5', 0.14, 0.2);
    chip(c, e, t + 0.46, s, 'E5', 0.08, 0.18);
    const top = t + 0.56;
    chip(c, e, top, s, 'C6', 0.65, 0.2, { hold: 0.35, vib: { rate: 8, depth: 18 } });
    chip(c, e, top, s, 'G5', 0.65, 0.08, { hold: 0.35 });
    chip(c, e, top, s, 'E5', 0.65, 0.08, { hold: 0.35 });
    tone(c, e, top, s, { type: 'triangle', f0: hz('C3'), dur: 0.6, vol: 0.18, hold: 0.3 });
    return top + 0.95;
  },
  /** The sad trombone: wah, wah, wah, waaaah. */
  defeat: (c, d, t, s) => {
    const notes: [string, number][] = [['G4', 0], ['F#4', 0.3], ['F4', 0.6]];
    for (const [n, at] of notes) {
      const f = hz(n);
      tone(c, d, t + at, s, { type: 'square', f0: f, f1: f * 0.97, dur: 0.27, vol: 0.12, lp: 1100, attack: 0.03, hold: 0.12 });
      tone(c, d, t + at, s, { type: 'triangle', f0: f / 2, f1: f * 0.485, dur: 0.27, vol: 0.14, attack: 0.03, hold: 0.12 });
    }
    const f = hz('E4');
    const vib = { rate: 5.5, depth: 45 };
    tone(c, d, t + 0.9, s, { type: 'square', f0: f, f1: f * 0.9, dur: 0.85, vol: 0.13, lp: 1100, attack: 0.03, hold: 0.45, vib });
    return tone(c, d, t + 0.9, s, { type: 'triangle', f0: f / 2, f1: f * 0.45, dur: 0.85, vol: 0.15, attack: 0.03, hold: 0.45, vib });
  },
  /** Dun, dun, DUNNN! ... followed by a squeaky little villain snicker: heh heh heh. */
  boss: (c, d, t, s) => {
    const stab = (at: number, notes: readonly string[], dur: number, hold: number, vib: boolean) => {
      for (const n of notes) tone(c, d, t + at, s, { type: 'square', f0: hz(n), dur, vol: 0.07, lp: 1300, attack: 0.01, hold, vib: vib ? { rate: 6, depth: 14 } : null });
      tone(c, d, t + at, s, { type: 'triangle', f0: hz(notes[0]) / 2, dur, vol: 0.2, attack: 0.01, hold });
      thump(c, d, t + at, s, 110, 45, 0.25, 0.35);
    };
    stab(0, ['C3', 'G3'], 0.16, 0.06, false);
    stab(0.22, ['C3', 'G3'], 0.16, 0.06, false);
    stab(0.46, ['C3', 'F#3', 'C4'], 0.75, 0.4, true);
    hiss(c, d, t + 0.46, s, { type: 'lowpass', f0: 1200, f1: 200, dur: 0.6, vol: 0.12 });
    run(c, d, t + 1.18, s, ['G5', 'E5', 'C5'], 0.075, { type: 'square', dur: 0.05, vol: 0.06, lp: 3000 });
    return t + 1.42;
  },

  // ---- move types (see moveSfx in ./index.ts) ----
  /** FIRE: a whoomph of flame with crackles. */
  fire: (c, d, t, s) => {
    hiss(c, d, t, s, { type: 'lowpass', f0: 400, f1: 4000, q: 2, dur: 0.36, attack: 0.05, hold: 0.08, vol: 0.36 });
    tone(c, d, t, s, { type: 'sawtooth', f0: 120, f1: 80, dur: 0.32, vol: 0.08, lp: 600 });
    for (const at of [0.04, 0.1, 0.15, 0.22, 0.29]) hiss(c, d, t + at, s, { type: 'highpass', f0: 3500, dur: 0.012, vol: 0.2 });
    return t + 0.4;
  },
  /** WATER: bloop-bloop-bloop and a little splash. */
  water: (c, d, t, s) => {
    [[0, 300, 950], [0.07, 420, 1150], [0.14, 360, 1050]].forEach(([at, a, b]) => tone(c, d, t + at, s, { type: 'sine', f0: a, f1: b, dur: 0.07, vol: 0.22 }));
    hiss(c, d, t + 0.02, s, { type: 'highpass', f0: 3000, f1: 5000, dur: 0.22, vol: 0.13, attack: 0.02 });
    return t + 0.25;
  },
  /** LEAF: a flutter of rustling leaves and a slicing swish. */
  leaf: (c, d, t, s) => {
    [0, 0.05, 0.1, 0.15, 0.21].forEach((at, i) => hiss(c, d, t + at, s, { type: 'bandpass', f0: 3000 + (i % 2) * 1200, q: 1, dur: 0.045, vol: 0.42 }));
    tone(c, d, t + 0.02, s, { type: 'sine', f0: 1100, f1: 1900, dur: 0.24, vol: 0.1, vib: { rate: 12, depth: 40 }, attack: 0.03 });
    return tone(c, d, t + 0.24, s, { type: 'triangle', f0: 1700, f1: 800, dur: 0.07, vol: 0.16 });
  },
  /** LIGHTNING: bzzzt-zap with a crack on top. */
  spark: (c, d, t, s) => {
    clang(c, d, t, s, { type: 'sawtooth', f0: 110, f1: 170, modF: 900, modF1: 2600, dur: 0.3, vol: 0.2, lp: 5000 });
    hiss(c, d, t, s, { type: 'highpass', f0: 4000, dur: 0.035, vol: 0.32 });
    [[0.04, 880], [0.08, 1320], [0.12, 660], [0.17, 1760]].forEach(([at, f]) => tone(c, d, t + at, s, { type: 'square', f0: f, dur: 0.03, vol: 0.07, lp: 4000 }));
    return t + 0.32;
  },
  /** EARTH: a deep rumble with three heavy thuds. */
  quake: (c, d, t, s) => {
    tone(c, d, t, s, { type: 'sine', f0: 70, f1: 42, dur: 0.75, vol: 0.32, attack: 0.02, hold: 0.25 });
    hiss(c, d, t, s, { type: 'lowpass', f0: 260, dur: 0.75, vol: 0.38, attack: 0.04, hold: 0.25 });
    for (const at of [0, 0.24, 0.44]) thump(c, d, t + at, s, 120, 48, 0.14, 0.3);
    return t + 0.75;
  },
  /** WINGED: a whoosh, and another whoosh back. */
  wind: (c, d, t, s) => {
    hiss(c, d, t, s, { type: 'bandpass', f0: 400, f1: 1700, q: 1.5, dur: 0.42, attack: 0.15, hold: 0.06, vol: 0.85 });
    return hiss(c, d, t + 0.2, s, { type: 'bandpass', f0: 1600, f1: 650, q: 2, dur: 0.34, attack: 0.1, vol: 0.65 });
  },
  /** FROST: a sharp crack and crystals tinkling into place. */
  ice: (c, d, t, s) => {
    const e = room(c, d, t, 0.4, { wet: 0.35, time: 0.05 });
    hiss(c, d, t, s, { type: 'highpass', f0: 4200, dur: 0.045, vol: 0.32 });
    chime(c, e, t, s, ['C7', 'G7'], 0.4, 0.05, 11);
    run(c, e, t + 0.05, s, ['A7', 'E7', 'C8'], 0.055, { type: 'sine', dur: 0.12, vol: 0.06, attack: 0.002 });
    return t + 0.55;
  },
  /** SLIME: blorp... bloop. */
  goo: (c, d, t, s) => {
    tone(c, d, t, s, { type: 'sine', f0: 520, f1: 150, dur: 0.15, vol: 0.3, lp: 1200 });
    tone(c, d, t, s, { type: 'triangle', f0: 260, f1: 90, dur: 0.15, vol: 0.12 });
    return wobble(c, d, t + 0.14, s, { type: 'sine', f0: 160, f1: 430, rate: 22, depth: 0.7, dur: 0.14, vol: 0.28 });
  },
  /** DARKNESS: an eerie, sinking double-voiced swoop. */
  shadow: (c, d, t, s) => {
    const vib = { rate: 4, depth: 25 };
    tone(c, d, t, s, { type: 'sawtooth', f0: 330, f1: 110, dur: 0.55, vol: 0.12, lp: 900, detune: -15, vib, attack: 0.04, hold: 0.15 });
    tone(c, d, t, s, { type: 'sawtooth', f0: 330, f1: 110, dur: 0.55, vol: 0.12, lp: 900, detune: 15, vib, attack: 0.04, hold: 0.15 });
    return hiss(c, d, t, s, { type: 'bandpass', f0: 320, f1: 140, q: 2, dur: 0.55, vol: 0.18, attack: 0.08 });
  },
  /** LIGHT: a bright beam rising into a glassy chord. */
  light: (c, d, t, s) => {
    const e = room(c, d, t, 0.6, { wet: 0.3 });
    tone(c, e, t, s, { type: 'sine', f0: 800, f1: 2400, dur: 0.3, vol: 0.17, attack: 0.02 });
    tone(c, e, t, s, { type: 'triangle', f0: 400, f1: 1200, dur: 0.3, vol: 0.11, attack: 0.02 });
    chime(c, e, t + 0.15, s, ['G6', 'C7', 'E7'], 0.5, 0.045, 9);
    return t + 0.75;
  },
  /** COOKING: a hot sizzle in the pan and a kitchen-timer "ding!". */
  cook: (c, d, t, s) => {
    hiss(c, d, t, s, { type: 'highpass', f0: 4500, dur: 0.38, vol: 0.13, attack: 0.02, hold: 0.15 });
    for (const at of [0.03, 0.09, 0.13, 0.2, 0.26, 0.31]) hiss(c, d, t + at, s, { type: 'bandpass', f0: 2800, q: 3, dur: 0.012, vol: 0.2 });
    const ding = hz('E6');
    tone(c, d, t + 0.36, s, { type: 'sine', f0: ding, dur: 0.5, vol: 0.18, attack: 0.002 });
    return tone(c, d, t + 0.36, s, { type: 'sine', f0: ding * 2.76, dur: 0.2, vol: 0.05, attack: 0.001 });
  },
  /** METAL: a ringing clang. */
  metal: (c, d, t, s) => {
    clang(c, d, t, s, { type: 'square', f0: 220, modF: 1450, dur: 0.42, vol: 0.18, lp: 6000 });
    hiss(c, d, t, s, { type: 'bandpass', f0: 3600, q: 4, dur: 0.06, vol: 0.3 });
    tone(c, d, t, s, { type: 'sine', f0: 880, dur: 0.42, vol: 0.06, vib: { rate: 7, depth: 8 } });
    return thump(c, d, t, s, 160, 70, 0.12, 0.25);
  },
  /** MIND: a woozy wee-oo-wee warble, climbing. */
  psy: (c, d, t, s) => {
    tone(c, d, t, s, { type: 'sine', f0: 420, f1: 1250, dur: 0.5, vol: 0.15, vib: { rate: 9, depth: 120 }, attack: 0.03, hold: 0.2 });
    return wobble(c, d, t, s, { type: 'triangle', f0: 840, f1: 1680, rate: 8, rate1: 20, depth: 0.9, dur: 0.5, vol: 0.1, attack: 0.03, hold: 0.2 });
  },
  /** BRAWL: a quick wind-up and a punchy POW. */
  punch: (c, d, t, s) => {
    hiss(c, d, t, s, { type: 'bandpass', f0: 700, f1: 2200, q: 1.5, dur: 0.06, vol: 0.16 });
    thump(c, d, t + 0.05, s, 170, 55, 0.15, 0.55);
    hiss(c, d, t + 0.05, s, { type: 'lowpass', f0: 2600, f1: 500, dur: 0.07, vol: 0.36 });
    return tone(c, d, t + 0.05, s, { type: 'square', f0: 230, f1: 80, dur: 0.05, vol: 0.1, lp: 1500 });
  },
  /** ROCK: a heavy crunch and a tumble of pebbles. */
  rock: (c, d, t, s) => {
    hiss(c, d, t, s, { type: 'lowpass', f0: 1300, f1: 200, dur: 0.2, vol: 0.42 });
    thump(c, d, t, s, 105, 45, 0.2, 0.42);
    [[0.12, 900], [0.18, 1250], [0.25, 760], [0.3, 1050]].forEach(([at, f]) => {
      tone(c, d, t + at, s, { type: 'triangle', f0: f, dur: 0.03, vol: 0.09 });
      hiss(c, d, t + at, s, { type: 'bandpass', f0: 2200, q: 2, dur: 0.015, vol: 0.12 });
    });
    return t + 0.34;
  },
  /** FLUFF: a soft poof and a springy boing. */
  fluff: (c, d, t, s) => {
    hiss(c, d, t, s, { type: 'lowpass', f0: 900, f1: 300, dur: 0.22, attack: 0.03, vol: 0.55 });
    return tone(c, d, t + 0.05, s, { type: 'sine', f0: 300, f1: 720, dur: 0.2, vol: 0.2, vib: { rate: 16, depth: 60 } });
  },
};
