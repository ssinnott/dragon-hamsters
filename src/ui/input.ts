// Pointer, keyboard and wheel input for the fixed-step loop.
//
// DOM events never touch game state directly: every listener only appends to a queue, and
// `beginUpdate()` drains that queue into this update's flags. So a press is seen by exactly one
// fixed update, whether the frame runs several updates (the first one drains, the rest see
// nothing) or none (the events wait in the queue for the next update). A drain stops at the second
// pointer transition, so a down and an up that landed in the same frame are seen by two
// consecutive updates, exactly like `injectClick` produces them.
//
// The loop calls, per fixed update:
//   input.beginUpdate(); scenes.update(DT, input); input.endUpdate();
//
// Keys are KeyboardEvent.key values ('Enter', ' ', 'Escape', 'ArrowUp', '1', 'a'). Single-character
// keys are normalised to lower case, both when recorded and when queried, so pressed('A') and
// pressed('a') are the same question and Shift does not hide a hotkey.

/** The single game pointer (mouse, primary touch or pen), in internal 640x360 coordinates. */
export interface Pointer {
  x: number;
  y: number;
  /** Button / finger is held. */
  down: boolean;
  /** Went down during this update. */
  pressed: boolean;
  /** Went up during this update. */
  released: boolean;
  /** Over the game canvas (false after a touch ends or the mouse leaves). */
  inside: boolean;
}

export interface Input {
  readonly pointer: Pointer;
  /** Key went down this update. KeyboardEvent.key: 'Enter', ' ', 'Escape', 'ArrowUp', '1', 'a' (lower-case letters). */
  pressed(key: string): boolean;
  /** Key is held. */
  held(key: string): boolean;
  /** Wheel delta (pixels, positive = scroll down) since the last update. */
  readonly wheel: number;
  /** Enter or Space pressed. */
  confirm(): boolean;
  /** Escape or Backspace pressed. */
  back(): boolean;
  /** Any key or the pointer pressed this update ("press any key"). */
  anyPressed(): boolean;
  /** Drain the queued DOM events into this update's flags. */
  beginUpdate(): void;
  /** Clear per-update flags. */
  endUpdate(): void;
  /** Queue a click at internal coordinates: a press on the next update, the release on the one after. */
  injectClick(x: number, y: number): void;
  /** Queue a key tap: pressed on the next update. */
  injectKey(key: string): void;
  /** Remove every DOM listener (dev pages and tests). */
  dispose(): void;
}

type QueuedEvent =
  | { k: 'move'; x: number; y: number }
  | { k: 'down'; x: number; y: number }
  | { k: 'up'; x: number; y: number; touch: boolean }
  | { k: 'leave' }
  | { k: 'keydown'; key: string; repeat: boolean }
  | { k: 'keyup'; key: string }
  | { k: 'wheel'; dy: number }
  | { k: 'blur' };

const LEGACY_KEYS: Record<string, string> = {
  Spacebar: ' ', Esc: 'Escape', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
};

/** Canonical form of a KeyboardEvent.key: single characters lower-cased, legacy names modernised. */
export function normalizeKey(key: string): string {
  if (key.length === 1) return key.toLowerCase();
  return LEGACY_KEYS[key] ?? key;
}

/** Navigation keys whose auto-repeat counts as a fresh press (holding an arrow scrolls a list). */
const REPEATING = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);
/** Named keys the browser must not act on (scrolling, focus moves, history back). */
const NAMED_GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace', 'Tab',
  'PageUp', 'PageDown', 'Home', 'End',
]);

function isGameKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;   // keep browser shortcuts (reload, devtools)
  return e.key.length === 1 || NAMED_GAME_KEYS.has(normalizeKey(e.key));
}

/**
 * Listen to `target` (pointer, wheel) and the window (keys, blur).
 * @param toInternal maps client coordinates to internal canvas space (Canvas.toInternal)
 */
export function createInput(target: HTMLElement, toInternal: (cx: number, cy: number) => { x: number; y: number }): Input {
  const queue: QueuedEvent[] = [];
  const pointer: Pointer = { x: -1, y: -1, down: false, pressed: false, released: false, inside: false };
  const pressedKeys = new Set<string>();
  const heldKeys = new Set<string>();
  let wheel = 0;
  let activePointerId: number | null = null;

  const bounds = (): { w: number; h: number } => {
    const c = target as HTMLCanvasElement;
    return { w: c.width || 640, h: c.height || 360 };
  };
  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const p = toInternal(e.clientX, e.clientY);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (!e.isPrimary || e.button !== 0) return;
    activePointerId = e.pointerId;
    try { target.setPointerCapture(e.pointerId); } catch { /* synthetic events have no capture */ }
    if (typeof target.focus === 'function') target.focus({ preventScroll: true });
    const p = local(e);
    queue.push({ k: 'move', x: p.x, y: p.y }, { k: 'down', x: p.x, y: p.y });
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    const p = local(e);
    queue.push({ k: 'move', x: p.x, y: p.y });
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (!e.isPrimary || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    activePointerId = null;
    const p = local(e);
    queue.push({ k: 'up', x: p.x, y: p.y, touch: e.pointerType === 'touch' });
  };
  const onPointerCancel = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    activePointerId = null;
    queue.push({ k: 'up', x: pointer.x, y: pointer.y, touch: true });
  };
  const onPointerLeave = (e: PointerEvent): void => {
    if (!e.isPrimary || activePointerId !== null) return;   // captured drags keep reporting
    queue.push({ k: 'leave' });
  };
  const onWheel = (e: WheelEvent): void => {
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 360 : 1;
    queue.push({ k: 'wheel', dy: e.deltaY * scale });
    e.preventDefault();
  };
  const onContextMenu = (e: Event): void => { e.preventDefault(); };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (isGameKey(e)) e.preventDefault();
    queue.push({ k: 'keydown', key: normalizeKey(e.key), repeat: e.repeat });
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (isGameKey(e)) e.preventDefault();
    queue.push({ k: 'keyup', key: normalizeKey(e.key) });
  };
  const onBlur = (): void => { queue.push({ k: 'blur' }); };

  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerCancel);
  target.addEventListener('pointerleave', onPointerLeave);
  target.addEventListener('wheel', onWheel, { passive: false });
  target.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  function setPos(x: number, y: number): void {
    pointer.x = x;
    pointer.y = y;
    const b = bounds();
    pointer.inside = x >= 0 && y >= 0 && x < b.w && y < b.h;
  }

  function clearFlags(): void {
    pressedKeys.clear();
    pointer.pressed = false;
    pointer.released = false;
    wheel = 0;
  }

  function apply(e: QueuedEvent): void {
    switch (e.k) {
      case 'move': setPos(e.x, e.y); break;
      case 'down':
        setPos(e.x, e.y);
        if (!pointer.down) { pointer.down = true; pointer.pressed = true; }
        break;
      case 'up':
        setPos(e.x, e.y);
        if (pointer.down) { pointer.down = false; pointer.released = true; }
        // A finger that lifted is no longer hovering anywhere.
        if (e.touch) pointer.inside = false;
        break;
      case 'leave': pointer.inside = false; break;
      case 'keydown':
        if (!heldKeys.has(e.key)) { heldKeys.add(e.key); pressedKeys.add(e.key); }
        else if (e.repeat && REPEATING.has(e.key)) pressedKeys.add(e.key);
        break;
      case 'keyup': heldKeys.delete(e.key); break;
      case 'wheel': wheel += e.dy; break;
      case 'blur':
        heldKeys.clear();
        if (pointer.down) { pointer.down = false; pointer.released = true; }
        break;
    }
  }

  const input: Input = {
    pointer,
    pressed: (key) => pressedKeys.has(normalizeKey(key)),
    held: (key) => heldKeys.has(normalizeKey(key)),
    get wheel() { return wheel; },
    confirm: () => pressedKeys.has('Enter') || pressedKeys.has(' '),
    back: () => pressedKeys.has('Escape') || pressedKeys.has('Backspace'),
    anyPressed: () => pressedKeys.size > 0 || pointer.pressed,
    beginUpdate() {
      clearFlags();
      let pointerEdges = 0;
      while (queue.length) {
        const e = queue[0];
        // One pointer transition per update: a down+up in one frame becomes press, then release.
        if ((e.k === 'down' || e.k === 'up') && pointerEdges > 0) break;
        // A second tap of the same key waits for the next update instead of merging into one press.
        if (e.k === 'keydown' && pressedKeys.has(e.key)) break;
        queue.shift();
        const wasDown = pointer.down;
        apply(e);
        if (pointer.down !== wasDown) pointerEdges++;
      }
    },
    endUpdate: clearFlags,
    injectClick(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      queue.push({ k: 'move', x: ix, y: iy }, { k: 'down', x: ix, y: iy }, { k: 'up', x: ix, y: iy, touch: false });
    },
    injectKey(key) {
      const k = normalizeKey(key);
      queue.push({ k: 'keydown', key: k, repeat: false }, { k: 'keyup', key: k });
    },
    dispose() {
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerCancel);
      target.removeEventListener('pointerleave', onPointerLeave);
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      queue.length = 0;
    },
  };
  return input;
}
