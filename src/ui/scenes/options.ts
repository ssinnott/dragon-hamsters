// OPTIONS: a small modal over the Burrow (the gear in the HUD, or Escape in the hub). SOUND and
// MUSIC switches (the same ones as on the title screen), FAST TEXT, SAVE & BACK TO TITLE, and BACK.
// Every switch writes app.state.settings and saves, so it sticks.
//
// Keyboard: arrows + Enter, or the hotkeys S, M, F, Q; Escape (or O) closes the box.
import { app } from '../app.ts';
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import { drawText } from '../../lib/engine/text.ts';
import { ButtonGroup, UI, VIEW_H, VIEW_W, drawPanel, tint, wrapText } from '../widgets.ts';
import { drawNoteIcon, drawSpeakerIcon } from '../icons.ts';
import { setMusic, setSound, sfx } from '../../audio/index.ts';

type Ctx = CanvasRenderingContext2D;

const W = 264, H = 196;
const X = Math.round((VIEW_W - W) / 2), Y = Math.round((VIEW_H - H) / 2) - 6;
const BW = W - 40, BX = X + 20;

export function createOptionsScene(): Scene {
  let age = 0;
  let closed = false;
  const group = new ButtonGroup();
  const st = (): typeof app.state.settings => app.state.settings;

  function close(): void {
    if (closed) return;
    closed = true;
    sfx('back');
    app.scenes.pop();
  }

  const half = Math.floor((BW - 6) / 2);
  group.add({
    get label() { return st().sound ? 'SOUND ON' : 'SOUND OFF'; },
    hotkey: 's', color: '#d8ecf4',
    rect: { x: BX, y: Y + 22, w: half, h: 24 },
    icon: (ctx, cx, cy) => drawSpeakerIcon(ctx, cx, cy, st().sound, UI.text),
    onClick: () => { st().sound = !st().sound; setSound(st().sound); sfx('click'); app.save(); },
  });
  group.add({
    get label() { return st().music ? 'MUSIC ON' : 'MUSIC OFF'; },
    hotkey: 'm', color: '#e4dcf6',
    rect: { x: BX + BW - half, y: Y + 22, w: half, h: 24 },
    icon: (ctx, cx, cy) => drawNoteIcon(ctx, cx, cy, st().music, UI.text, UI.bad),
    onClick: () => { st().music = !st().music; setMusic(st().music); sfx('click'); app.save(); },
  });
  group.add({
    get label() { return st().fastText !== false ? 'FAST TEXT: ON' : 'FAST TEXT: OFF'; },
    get sub() { return st().fastText !== false ? 'WORDS ZIP ALONG' : 'WORDS TAKE THEIR TIME'; },
    hotkey: 'f', color: '#f4e4c4',
    rect: { x: BX, y: Y + 52, w: BW, h: 32 },
    onClick: () => { st().fastText = st().fastText === false; sfx('click'); app.save(); },
  });
  group.add({
    label: 'SAVE & BACK TO TITLE', hotkey: 'q', color: UI.info,
    rect: { x: BX, y: Y + 104, w: BW, h: 24 },
    onClick: () => {
      if (closed) return;
      closed = true;
      sfx('select');
      app.save();
      app.nav.title();
    },
  });
  group.add({
    label: 'BACK TO THE BURROW', hotkey: 'Escape', color: UI.good,
    rect: { x: BX, y: Y + H - 38, w: BW, h: 24 },
    onClick: () => close(),
  });
  group.focus = group.buttons.length - 1;

  return {
    name: 'options',
    overlay: true,
    enter() {
      sfx('select', { volume: 0.6 });
    },
    update(dt: number, input: Input) {
      age += dt;
      if (closed) return;
      if (input.pressed('o')) { close(); return; }
      group.update(input);
    },
    draw(ctx: Ctx) {
      const u = Math.min(1, age / 0.12);
      const off = Math.round((1 - u) * 8);
      ctx.save();
      ctx.globalAlpha *= 0.4 + 0.6 * u;
      ctx.translate(0, off);
      drawPanel(ctx, X, Y, W, H, { fill: UI.panelLight, title: 'OPTIONS' });
      // a reminder under SAVE & BACK TO TITLE: nothing is lost by leaving
      const note = wrapText('YOUR BURROW SAVES BY ITSELF. CONTINUE ON THE TITLE SCREEN TO COME BACK.', BW);
      note.slice(0, 2).forEach((l, i) => drawText(ctx, l, X + W / 2, Y + 133 + i * 10, { align: 'center', color: UI.textDim, shadow: false }));
      ctx.fillStyle = tint(UI.panelLight, -0.14);
      ctx.fillRect(BX, Y + 95, BW, 1);
      group.draw(ctx);
      ctx.restore();
    },
  };
}
