// The shared modal overlays: a typewriter message box (createDialogScene) and a yes/no box
// (createConfirmScene). Both are overlays, so the scene underneath stays visible, dimmed by the
// scene manager. Each pops itself BEFORE calling its callback, so a callback is free to navigate.
//
// Dialog: Enter, Space or a click finishes the current line; the next press advances. Escape skips
// to the end. When the speaker is 'chief', Chief Nibbles' portrait sits in a frame on the left and
// his name is on the plaque.
// Confirm: YES / NO buttons (Y / N hotkeys, arrows + Enter, click); Escape answers NO. NO has the
// focus at first, so mashing Enter never says yes to something by accident.
import { app, type Speaker } from '../app.ts';
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import { drawText } from '../../lib/engine/text.ts';
import {
  ButtonGroup, Typewriter, UI, VIEW_H, VIEW_W, drawMessageBox, drawPanel, fillRoundRect, tint, wrapText,
} from '../widgets.ts';
import { CHIEF_PORTRAIT_SIZE, drawChiefPortrait } from '../chief.ts';
import { sfx } from '../../audio/index.ts';

type Ctx = CanvasRenderingContext2D;

const LINE_STEP = 10;
const BOX_MARGIN = 12;
const SLIDE_TIME = 0.16;

const easeOut = (u: number): number => 1 - (1 - u) * (1 - u) * (1 - u);

/** The blinking "more" prompt. */
function drawPrompt(ctx: Ctx, x: number, y: number, t: number, last: boolean): void {
  if (Math.floor(t * 2.5) % 2 === 1) return;
  const glyph = last ? '★' : '▶';
  drawText(ctx, glyph, x, y, { color: UI.accent, shadowColor: tint(UI.accent, -0.55) });
}

/**
 * A modal message box. Lines are revealed one at a time with a typewriter; after the last one the
 * box pops itself and calls onDone.
 */
export function createDialogScene(lines: string[], onDone?: () => void, speaker: Speaker = 'none'): Scene {
  const pages = lines.length ? lines.map((l) => String(l)) : [''];
  const chief = speaker === 'chief';
  const fast = app.state?.settings?.fastText !== false;
  const tw = new Typewriter(fast ? 72 : 42);
  let index = 0;
  let age = 0;
  let closed = false;
  let blips = 0;

  // Layout: as wide as the screen allows, tall enough for the longest page (text never overflows).
  const boxX = BOX_MARGIN, boxW = VIEW_W - BOX_MARGIN * 2;
  const portraitPad = chief ? CHIEF_PORTRAIT_SIZE + 12 : 0;
  // the message box's text column (drawMessageBox wraps in boxW - 32 - indent, indent = textX - boxX - 12)
  const textX = boxX + 16 + portraitPad;
  const textW = boxX + boxW - 20 - textX;
  const maxLines = Math.max(1, ...pages.map((p) => wrapText(p, textW, 1).length));
  const textH = maxLines * LINE_STEP - 3;
  const boxH = Math.max(chief ? CHIEF_PORTRAIT_SIZE + 22 : 52, textH + 30);
  const boxY = VIEW_H - BOX_MARGIN - boxH;

  tw.onChar = () => {
    blips++;
    if (blips % 3 === 0) sfx('click', { volume: 0.22, pitch: chief ? 0.62 : 0.95 });
  };

  function finish(): void {
    if (closed) return;
    closed = true;
    app.scenes.pop();
    onDone?.();
  }

  function advance(): void {
    if (!tw.done) { tw.skip(); return; }
    if (index < pages.length - 1) {
      index++;
      tw.set(pages[index]);
      sfx('select', { volume: 0.5 });
    } else {
      sfx('click');
      finish();
    }
  }

  return {
    name: 'dialog',
    overlay: true,
    enter() {
      tw.set(pages[0]);
    },
    update(dt: number, input: Input) {
      age += dt;
      tw.update(dt);
      if (closed) return;
      if (input.back()) { sfx('back'); finish(); return; }
      if (input.confirm() || input.pointer.pressed) advance();
    },
    draw(ctx: Ctx) {
      const slide = Math.round((1 - easeOut(Math.min(1, age / SLIDE_TIME))) * (boxH + BOX_MARGIN + 8));
      const y = boxY + slide;
      drawMessageBox(ctx, boxX, y, boxW, boxH, tw, {
        arrow: false, size: 1, indent: textX - boxX - 12, name: chief ? 'CHIEF NIBBLES' : undefined,
      });
      if (chief) drawChiefPortrait(ctx, boxX + 10, y + boxH - CHIEF_PORTRAIT_SIZE - 10, app.time, !tw.done);
      // page pips, bottom centre of the text area
      if (pages.length > 1) {
        const pipW = 4, gap = 3;
        const total = pages.length * pipW + (pages.length - 1) * gap;
        let px = Math.round(textX + textW / 2 - total / 2);
        const py = y + boxH - 9;
        for (let i = 0; i < pages.length; i++) {
          fillRoundRect(ctx, px, py, pipW, 3, 1, i <= index ? UI.accent : tint(UI.panelDark, -0.05));
          px += pipW + gap;
        }
      }
      if (tw.done) drawPrompt(ctx, boxX + boxW - 18, y + boxH - 16, age, index === pages.length - 1);
    },
  };
}

/**
 * A modal yes/no question. YES calls onYes, NO (or Escape) calls onNo. The box pops itself first.
 */
export function createConfirmScene(text: string, onYes: () => void, onNo?: () => void): Scene {
  const W = 340;
  const textW = W - 40;
  const lines = wrapText(String(text), textW, 1);
  const textH = lines.length * LINE_STEP - 3;
  const btnW = 104, btnH = 24;
  const H = 18 + textH + 16 + btnH + 16;
  const x = Math.round((VIEW_W - W) / 2);
  const y = Math.round((VIEW_H - H) / 2);
  const btnY = y + H - 16 - btnH;
  let age = 0;
  let answered = false;

  function answer(yes: boolean): void {
    if (answered) return;
    answered = true;
    app.scenes.pop();
    if (yes) onYes(); else onNo?.();
  }

  const group = new ButtonGroup();
  group.add({
    label: 'YES', hotkey: 'y', color: UI.good, textColor: UI.textLight,
    rect: { x: x + W / 2 - btnW - 8, y: btnY, w: btnW, h: btnH },
    onClick: () => { sfx('select'); answer(true); },
  });
  group.add({
    label: 'NO', hotkey: 'n',
    rect: { x: x + W / 2 + 8, y: btnY, w: btnW, h: btnH },
    onClick: () => { sfx('back'); answer(false); },
  });
  group.focus = 1;

  return {
    name: 'confirm',
    overlay: true,
    update(dt: number, input: Input) {
      age += dt;
      if (answered) return;
      if (input.back()) { sfx('back'); answer(false); return; }
      group.update(input);
    },
    draw(ctx: Ctx) {
      // a quick pop: the panel grows from 90% and the content fades in with it
      const u = Math.min(1, age / 0.12);
      const k = 0.9 + 0.1 * easeOut(u);
      ctx.save();
      ctx.translate(VIEW_W / 2, VIEW_H / 2);
      ctx.scale(k, k);
      ctx.translate(-VIEW_W / 2, -VIEW_H / 2);
      ctx.globalAlpha *= 0.4 + 0.6 * u;
      drawPanel(ctx, x, y, W, H, { fill: UI.panelLight });
      // a little question mark seal in the corner
      fillRoundRect(ctx, x + W - 22, y - 7, 15, 15, 4, UI.ink);
      fillRoundRect(ctx, x + W - 21, y - 6, 13, 13, 3, UI.accent);
      drawText(ctx, '?', x + W - 17, y - 3, { color: UI.textLight, shadowColor: tint(UI.accent, -0.5) });
      lines.forEach((l, i) => {
        drawText(ctx, l, x + W / 2, y + 18 + i * LINE_STEP, { align: 'center', color: UI.text, shadowColor: tint(UI.panelLight, -0.16) });
      });
      group.draw(ctx);
      ctx.restore();
    },
  };
}
