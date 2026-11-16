// The scene stack. Only the top scene updates; overlays (modals) draw the scenes below them first,
// dimmed; replace() and reset() fade through ink.
//
// Lifecycle:
//   push(s)     s.enter()                      instant; the scene below is paused, not exited
//   pop()       top.exit(), then below.resume()
//   replace(s)  fade out, top.exit(), s.enter(), fade in
//   reset(s)    fade out, every scene exits (top first), s.enter(), fade in
// While the screen fades out nothing updates; while it fades back in the new top scene updates
// with its input muted, so a click that started the fade can never land on the next screen.
import type { Input, Pointer } from './input.ts';

export interface Scene {
  readonly name: string;
  enter?(): void;
  exit?(): void;
  /** The scene above this one was popped and this one is on top again. */
  resume?(): void;
  update(dt: number, input: Input): void;
  draw(ctx: CanvasRenderingContext2D): void;
  /** Draw the scene below first, dimmed (modals). */
  readonly overlay?: boolean;
}

export interface SceneManager {
  push(s: Scene): void;
  pop(): void;
  /** Swap the top scene for `s`, fading through ink. */
  replace(s: Scene): void;
  /** Clear the whole stack and start over with `s`, fading through ink. */
  reset(s: Scene): void;
  top(): Scene | null;
  readonly depth: number;
  /** A replace/reset fade is running. */
  readonly busy: boolean;
  update(dt: number, input: Input): void;
  draw(ctx: CanvasRenderingContext2D): void;
}

const INK = '#1b1426';
const FADE_OUT = 0.13;
const FADE_IN = 0.14;
/** How dark the scene under an overlay gets, and how quickly the dim comes in. */
const DIM_ALPHA = 0.58;
const DIM_RAMP = 0.12;

/** An input that reports the pointer position but no presses, keys or wheel. */
function mutedInput(src: Input): Input {
  const pointer: Pointer = { x: 0, y: 0, down: false, pressed: false, released: false, inside: false };
  const no = (): boolean => false;
  return {
    get pointer() {
      pointer.x = src.pointer.x; pointer.y = src.pointer.y; pointer.inside = src.pointer.inside;
      return pointer;
    },
    pressed: no, held: no, confirm: no, back: no, anyPressed: no,
    get wheel() { return 0; },
    beginUpdate() { /* owned by the loop */ },
    endUpdate() { /* owned by the loop */ },
    injectClick: (x, y) => src.injectClick(x, y),
    injectKey: (k) => src.injectKey(k),
    dispose() { /* not ours */ },
  };
}

export function createSceneManager(): SceneManager {
  const stack: Scene[] = [];
  /** Seconds each scene has been on the stack (drives the overlay dim ramp). */
  const age = new Map<Scene, number>();
  let fade: { phase: 'out' | 'in'; t: number; action: (() => void) | null } | null = null;
  let muted: Input | null = null;
  let mutedSrc: Input | null = null;

  function enter(s: Scene): void {
    stack.push(s);
    age.set(s, 0);
    s.enter?.();
  }
  function remove(): Scene | undefined {
    const s = stack.pop();
    if (s) { age.delete(s); s.exit?.(); }
    return s;
  }

  function startFade(action: () => void): void {
    if (!stack.length && !fade) {
      // Nothing on screen to fade away: act now and fade in from ink.
      action();
      fade = { phase: 'in', t: 0, action: null };
      return;
    }
    if (fade && fade.phase === 'out') { fade.action = action; return; }   // newest request wins
    // Fading in (or idle): fade back out from the current darkness so the ink stays continuous.
    const t = fade ? (1 - Math.min(1, fade.t / FADE_IN)) * FADE_OUT : 0;
    fade = { phase: 'out', t, action };
  }

  const mgr: SceneManager = {
    push(s) { enter(s); },
    pop() {
      if (!stack.length) return;
      remove();
      stack[stack.length - 1]?.resume?.();
    },
    replace(s) {
      startFade(() => { remove(); enter(s); });
    },
    reset(s) {
      startFade(() => { while (stack.length) remove(); enter(s); });
    },
    top: () => stack[stack.length - 1] ?? null,
    get depth() { return stack.length; },
    get busy() { return fade !== null; },

    update(dt, input) {
      for (const [s, a] of age) age.set(s, a + dt);
      if (fade) {
        fade.t += dt;
        if (fade.phase === 'out') {
          if (fade.t < FADE_OUT) return;
          const act = fade.action;
          fade = { phase: 'in', t: 0, action: null };
          act?.();
          return;
        }
        if (fade.t >= FADE_IN) fade = null;
      }
      const top = stack[stack.length - 1];
      if (!top) return;
      if (fade) {
        if (mutedSrc !== input || !muted) { muted = mutedInput(input); mutedSrc = input; }
        top.update(dt, muted);
      } else {
        top.update(dt, input);
      }
    },

    draw(ctx) {
      // The lowest scene that is visible: walk down through overlays.
      let base = stack.length - 1;
      while (base > 0 && stack[base].overlay) base--;
      if (base < 0) {
        ctx.fillStyle = INK;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
      for (let i = Math.max(0, base); i < stack.length; i++) {
        const s = stack[i];
        if (i > base) {
          const a = DIM_ALPHA * Math.min(1, (age.get(s) ?? DIM_RAMP) / DIM_RAMP);
          ctx.save();
          ctx.globalAlpha = a;
          ctx.fillStyle = INK;
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.restore();
        }
        ctx.save();
        s.draw(ctx);
        ctx.restore();
      }
      if (fade) {
        const k = fade.phase === 'out' ? Math.min(1, fade.t / FADE_OUT) : 1 - Math.min(1, fade.t / FADE_IN);
        if (k > 0) {
          ctx.save();
          ctx.globalAlpha = k;
          ctx.fillStyle = INK;
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.restore();
        }
      }
    },
  };
  return mgr;
}
