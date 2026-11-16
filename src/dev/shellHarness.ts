// Dev harness for the shell screens (dev/shell.html): the title, the intro + starter pick, the
// dialog / confirm overlays and a Chief Nibbles sheet, each on its own, with the real overlays wired
// in and every other screen stubbed by src/dev/harness.ts.
//
//   dev/shell.html?scene=title            title on the default test save (CONTINUE enabled)
//   dev/shell.html?scene=title&nosave=1   title with an empty burrow (CONTINUE disabled)
//   dev/shell.html?scene=intro            the new-game intro
//   dev/shell.html?scene=dialog[&speaker=none]  a dialog over the title
//   dev/shell.html?scene=confirm          a confirm over the title
//   dev/shell.html?scene=chief            Chief Nibbles at several sizes
import { bootHarness } from './harness.ts';
import { app } from '../ui/app.ts';
import type { Scene } from '../ui/scene.ts';
import { createTitleScene } from '../ui/scenes/title.ts';
import { createIntroScene } from '../ui/scenes/intro.ts';
import { createConfirmScene, createDialogScene } from '../ui/scenes/dialog.ts';
import { CHIEF_PORTRAIT_SIZE, drawChief, drawChiefPortrait } from '../ui/chief.ts';
import { drawText } from '../lib/engine/text.ts';
import { UI, VIEW_H, VIEW_W } from '../ui/widgets.ts';
import { drawBurrow } from '../art/backdrops.ts';

const params = new URLSearchParams(location.search);
const which = params.get('scene') ?? 'title';
const speaker = params.get('speaker') === 'none' ? 'none' : 'chief';

function chiefSheet(): Scene {
  return {
    name: 'chief-sheet',
    update() {},
    draw(ctx) {
      drawBurrow(ctx, app.time);
      ctx.fillStyle = 'rgba(27,20,38,0.45)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const t = app.time;
      drawChief(ctx, 90, 300, 3, t, false);
      drawChief(ctx, 250, 300, 3, t, true);
      drawChief(ctx, 360, 300, 2, t, true, { facing: -1 });
      drawChief(ctx, 430, 300, 1, t, false);
      drawChief(ctx, 480, 300, 1.5, t, false, { pose: 'happy' });
      drawChiefPortrait(ctx, 540, 40, t, false);
      drawChiefPortrait(ctx, 540, 50 + CHIEF_PORTRAIT_SIZE, t, true);
      drawText(ctx, 'CHIEF NIBBLES', 20, 12, { size: 2, color: UI.gold });
    },
  };
}

const lines = [
  "Welcome to the Secret Burrow, agent! Mind the sunflower seeds, they're load-bearing.",
  'This is a second page, a bit longer, so we can see how the box copes with text that wraps onto more than one line of the dialog box without spilling out of it at all.',
  'Last one!',
];

bootHarness(() => {
  switch (which) {
    case 'intro': return createIntroScene();
    case 'chief': return chiefSheet();
    default: return createTitleScene();
  }
}, {
  setup: (s) => {
    if (params.get('nosave')) { s.dragons = []; s.squad = []; s.dex = { seen: [], owned: [] }; }
  },
  nav: {
    title: () => app.scenes.reset(createTitleScene()),
    intro: () => app.scenes.reset(createIntroScene()),
    dialog: (l, onDone, sp) => app.scenes.push(createDialogScene(l, onDone, sp)),
    confirm: (text, onYes, onNo) => app.scenes.push(createConfirmScene(text, onYes, onNo)),
  },
});

if (which === 'dialog') {
  app.nav.dialog(lines, () => console.log('[dialog] done'), speaker);
} else if (which === 'confirm') {
  app.nav.confirm('Start a new game? Your saved burrow (day 3, 9 dragons) will be erased for good. No take-backs!',
    () => console.log('[confirm] yes'), () => console.log('[confirm] no'));
}
