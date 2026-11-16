// The Bag: an overlay over the Burrow listing the pantry's snacks (counts and effects) and the battle
// items (counts and descriptions). Field items (heal, revive, cure) are used on a dragon picked from
// a second list (HP, status, and what the item would do for each); snacks point the player to the
// Snack Bar, where they are eaten.
//
// Keys: Up/Down pick, Enter uses / picks, Escape goes back (dragon list -> item list -> burrow).
import { drawText, measureText } from '../../lib/engine/text.ts';
import { app } from '../app.ts';
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import {
  ButtonGroup, ScrollList, UI, drawHpBar, drawInset, drawPanel, drawSelection, drawStatusBadge, fillRoundRect,
  tint, wrapText, type Rect,
} from '../widgets.ts';
import { drawActivityIcon, drawFoodIcon, drawItemIcon } from '../icons.ts';
import { drawDragon, dragonHeight } from '../../art/dragon.ts';
import { createFx } from '../../art/fx.ts';
import { music, sfx } from '../../audio/index.ts';
import { ACTIVITIES, FOODS, ITEMS, getSpecies } from '../../data/index.ts';
import { FOOD_IDS, ITEM_IDS, type FoodId, type ItemDef, type ItemId, type StageStat } from '../../data/schema.ts';
import { useItemOutside } from '../../game/habitat.ts';
import { dragonName, dragonStats, isFainted } from '../../game/dragons.ts';
import type { GameState, OwnedDragon } from '../../game/types.ts';

type Ctx = CanvasRenderingContext2D;

type Entry = { kind: 'food'; id: FoodId } | { kind: 'item'; id: ItemId };
interface Target { d: OwnedDragon; ok: boolean; tag: string }

const STAGE_SHORT: Record<StageStat, string> = {
  atk: 'ATK', def: 'DEF', spa: 'SP.ATK', spd: 'SP.DEF', spe: 'SPD', acc: 'ACC', eva: 'EVA',
};

function itemEffect(def: ItemDef): string {
  const e = def.effect;
  switch (e.kind) {
    case 'heal': return e.fraction >= 1 ? 'HEALS ALL HP' : `HEALS ${Math.round(e.fraction * 100)}% HP`;
    case 'revive': return `REVIVES WITH ${Math.round(e.fraction * 100)}% HP`;
    case 'cure': return 'CURES STATUS';
    case 'stages': {
      const parts = (Object.keys(e.changes) as StageStat[]).map((k) => {
        const n = e.changes[k] ?? 0;
        return `${n > 0 ? '+' : ''}${n} ${STAGE_SHORT[k]}`;
      });
      return 'BATTLE: ' + parts.join(' ');
    }
    default: return '';
  }
}

function entryName(e: Entry): string { return e.kind === 'food' ? FOODS[e.id].name : ITEMS[e.id].name; }
function entryCount(e: Entry): number { return e.kind === 'food' ? app.state.food[e.id] ?? 0 : app.state.items[e.id] ?? 0; }
function entryEffect(e: Entry): string {
  if (e.kind === 'item') return itemEffect(ITEMS[e.id]);
  const f = FOODS[e.id];
  return `FULL +${f.fullness} HAPPY +${f.happiness}` + (f.xp > 0 ? ` +${f.xp} XP` : '');
}
function drawEntryIcon(ctx: Ctx, e: Entry, cx: number, cy: number, s: number): void {
  if (e.kind === 'food') drawFoodIcon(ctx, e.id, cx, cy, s);
  else drawItemIcon(ctx, e.id, cx, cy, s);
}

/** A little keyboard key with a label (hotkey hints). Returns its width. */
function drawKeycap(ctx: Ctx, key: string, x: number, y: number): number {
  const tw = measureText(key);
  const w = Math.max(9, tw + 4), h = 12;
  x = Math.round(x); y = Math.round(y);
  fillRoundRect(ctx, x, y, w, h, 2, UI.ink);
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, 1, UI.nightDark);
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 3, 1, UI.nightLight);
  ctx.fillStyle = tint(UI.nightLight, 0.25);
  ctx.fillRect(x + 2, y + 1, w - 4, 1);
  drawText(ctx, key, x + Math.floor((w - tw) / 2), y + 2, { color: UI.textLight, shadow: false });
  return w;
}

/** Deep copy of the save for a dry run (what would this item do for that dragon?). */
function dryRun(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

export function createBagScene(): Scene {
  const P: Rect = { x: 8, y: 16, w: 624, h: 334 };
  const LIST: Rect = { x: 22, y: 50, w: 304, h: 26 * 11 };
  const DETAIL: Rect = { x: 338, y: 36, w: 282, h: 302 };
  const entries: Entry[] = [
    ...FOOD_IDS.map((id): Entry => ({ kind: 'food', id })),
    ...ITEM_IDS.map((id): Entry => ({ kind: 'item', id })),
  ];
  let mode: 'items' | 'dragons' = 'items';
  let targets: Target[] = [];
  let line = '';
  let lineOk = true;
  let lineT = 0;
  let foodNudge = 0;
  const fx = createFx();
  /** Displayed HP per dragon, rolling toward the real value after a heal. */
  const shownHp = new Map<string, number>();

  const items = new ScrollList<Entry>({
    rect: { x: LIST.x, y: LIST.y, w: LIST.w, h: 26 * 10 }, rowH: 26, items: () => entries, drawRow: drawEntryRow,
    onSelect: () => { sfx('click', { volume: 0.5 }); line = ''; },
    onActivate: (e) => activateEntry(e),
  });
  const dragons = new ScrollList<Target>({
    rect: LIST, rowH: 26, items: () => targets, drawRow: drawTargetRow,
    onSelect: () => sfx('click', { volume: 0.5 }),
    onActivate: (t) => useOn(t),
    empty: 'NO DRAGONS IN THE BURROW YET!',
  });

  const current = (): Entry | undefined => entries[items.selected];
  const currentItem = (): ItemId | null => { const e = current(); return e && e.kind === 'item' ? e.id : null; };

  const group = new ButtonGroup();
  group.keyboard = false;
  const useBtn = group.add({
    label: 'USE', rect: { x: DETAIL.x + DETAIL.w - 104, y: DETAIL.y + DETAIL.h - 32, w: 94, h: 22 }, color: UI.good,
    visible: () => {
      const it = currentItem();
      return !!it && ITEMS[it].fieldUse;
    },
    enabled: () => {
      const it = currentItem();
      if (!it || entryCount({ kind: 'item', id: it }) <= 0) return false;
      if (mode === 'items') return true;
      return !!targets[dragons.selected];
    },
    onClick: () => {
      if (mode === 'items') { const e = current(); if (e) activateEntry(e); }
      else { const t = targets[dragons.selected]; if (t) useOn(t); }
    },
  });
  group.add({
    label: 'BACK', rect: { x: P.x + P.w - 76, y: P.y + 6, w: 68, h: 20 }, hotkey: 'Escape', align: 'left',
    onClick: () => back(),
    decorate: (ctx, face) => drawKeycap(ctx, 'ESC', face.x + face.w - 23, face.y + Math.floor((face.h - 12) / 2)),
  });

  function back(): void {
    sfx('back');
    if (mode === 'dragons') { mode = 'items'; line = ''; return; }
    app.scenes.pop();
  }

  function refreshTargets(): void {
    const it = currentItem();
    if (!it) { targets = []; return; }
    const kind = ITEMS[it].effect.kind;
    targets = app.state.dragons.map((d) => {
      const sim = dryRun(app.state);
      const r = useItemOutside(sim, it, d.id);
      const after = sim.dragons.find((x) => x.id === d.id);
      let tag: string;
      if (r.ok) {
        if (kind === 'heal' && after) tag = `+${after.hp - d.hp} HP`;
        else if (kind === 'revive') tag = 'REVIVE!';
        else tag = 'CURE!';
      } else if (isFainted(d) && kind !== 'revive') tag = 'FAINTED';
      else if (kind === 'heal') tag = 'FULL HP';
      else if (kind === 'revive') tag = 'NOT FAINTED';
      else if (kind === 'cure') tag = 'NO STATUS';
      else tag = 'NO EFFECT';
      return { d, ok: r.ok, tag };
    });
  }

  function activateEntry(e: Entry): void {
    if (e.kind === 'food') {
      sfx('select');
      foodNudge = 0.6;
      line = `Snacks are eaten at the ${ACTIVITIES.feed.name.toUpperCase()}. Close the bag and click it, or press 1 in the Burrow!`;
      lineOk = true; lineT = 4;
      return;
    }
    const def = ITEMS[e.id];
    if (!def.fieldUse) {
      sfx('error');
      line = `${def.name} only works in battle. Save it for a tough fight!`;
      lineOk = false; lineT = 4;
      return;
    }
    if (entryCount(e) <= 0) {
      sfx('error');
      line = `You have no ${def.name} left. The Pantry Shop sells more.`;
      lineOk = false; lineT = 4;
      return;
    }
    sfx('select');
    mode = 'dragons';
    line = '';
    refreshTargets();
    // start on the first dragon it would actually help
    const i = targets.findIndex((t) => t.ok);
    dragons.selected = Math.max(0, i);
    dragons.ensureVisible(dragons.selected);
  }

  function useOn(t: Target): void {
    const it = currentItem();
    if (!it) return;
    const before = t.d.hp;
    const r = useItemOutside(app.state, it, t.d.id);
    line = r.line; lineOk = r.ok; lineT = 5;
    if (!r.ok) { sfx('error'); return; }
    app.save();
    sfx('heal');
    shownHp.set(t.d.id, before);
    const i = targets.indexOf(t);
    const y = dragons.rect.y + i * 26 - dragons.scroll + 13;
    fx.move('heal', { x: LIST.x + 16, y }, { x: LIST.x + 16, y }, 'LEAF');
    const gained = t.d.hp - before;
    fx.floatText(LIST.x + 160, y - 6, gained > 0 ? `+${gained} HP` : 'CURED!', '#8ef07a');
    refreshTargets();
    if (entryCount({ kind: 'item', id: it }) <= 0) {
      // all used up: back to the item list (the message stays)
      mode = 'items';
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------------------------

  function drawEntryRow(ctx: Ctx, e: Entry, r: Rect, sel: boolean, hov: boolean): void {
    drawSelection(ctx, r, sel, hov);
    const n = entryCount(e);
    if (e.kind === 'item' && e.id === ITEM_IDS[0]) {
      ctx.fillStyle = tint(UI.panel, -0.25);
      ctx.fillRect(r.x + 4, r.y, r.w - 8, 1);
    }
    ctx.save();
    if (n <= 0) ctx.globalAlpha = 0.45;
    drawEntryIcon(ctx, e, r.x + 14, r.y + 13, 16);
    ctx.restore();
    drawText(ctx, entryName(e), r.x + 30, r.y + 4, { color: n > 0 ? UI.text : UI.textDim, shadow: false });
    drawText(ctx, entryEffect(e), r.x + 30, r.y + 15, { color: UI.textDim, shadow: false });
    const c = 'X' + n;
    drawText(ctx, c, r.x + r.w - 6, r.y + 9, { align: 'right', color: n > 0 ? UI.text : UI.textDim, shadow: false });
    if (e.kind === 'item' && !ITEMS[e.id].fieldUse) {
      const tw = measureText('BATTLE');
      drawText(ctx, 'BATTLE', r.x + r.w - 32 - tw, r.y + 9, { color: tint(UI.info, -0.25), shadow: false });
    }
  }

  function drawTargetRow(ctx: Ctx, t: Target, r: Rect, sel: boolean, hov: boolean): void {
    drawSelection(ctx, r, sel, hov);
    const d = t.d;
    const v = getSpecies(d.speciesId).visual;
    const s = Math.min(0.55, 20 / Math.max(1, dragonHeight(v, 1)));
    const fainted = isFainted(d);
    drawDragon(ctx, v, r.x + 15, r.y + r.h - 3, { scale: s, t: app.time + d.id.length, pose: fainted ? 'faint' : 'idle', poseT: fainted ? 0.58 : 0 });
    drawText(ctx, dragonName(d).toUpperCase(), r.x + 30, r.y + 4, { color: UI.text, shadow: false });
    drawText(ctx, 'LV ' + d.level, r.x + 30, r.y + 15, { color: UI.textDim, shadow: false });
    const max = dragonStats(d).hp;
    const hp = shownHp.get(d.id) ?? d.hp;
    drawHpBar(ctx, r.x + 116, r.y + 3, 92, Math.round(hp), max);
    drawText(ctx, `${Math.round(hp)}/${max}`, r.x + 116, r.y + 15, { color: UI.textDim, shadow: false });
    if (d.status) drawStatusBadge(ctx, d.status, r.x + 172, r.y + 13);
    else if (fainted) drawText(ctx, 'FAINTED', r.x + 160, r.y + 15, { color: UI.bad, shadow: false });
    drawText(ctx, t.tag, r.x + r.w - 6, r.y + 9, { align: 'right', color: t.ok ? tint(UI.good, -0.35) : UI.textDim, shadow: false });
  }

  function drawDetail(ctx: Ctx): void {
    const d = DETAIL;
    drawInset(ctx, d.x, d.y, d.w, d.h, { fill: UI.panelLight });
    const e = current();
    if (!e) return;
    const x = d.x + 10;
    let y = d.y + 10;
    fillRoundRect(ctx, x, y, 44, 44, 5, tint(UI.panelDark, 0.25));
    drawEntryIcon(ctx, e, x + 22, y + 22, 32);
    const name = entryName(e).toUpperCase();
    const size = measureText(name, 2) <= d.w - 76 ? 2 : 1;
    drawText(ctx, name, x + 54, y + 4, { size, color: UI.text, shadowColor: tint(UI.panelLight, -0.2) });
    const n = entryCount(e);
    drawText(ctx, `YOU HAVE ${n}`, x + 54, y + 24, { color: n > 0 ? UI.text : UI.bad, shadow: false });
    drawText(ctx, e.kind === 'food' ? 'SNACK' : ITEMS[e.id].fieldUse ? 'HEALING ITEM' : 'BATTLE ITEM', x + 54, y + 35, { color: tint(UI.info, -0.3), shadow: false });
    y += 54;
    const desc = e.kind === 'food' ? FOODS[e.id].description : ITEMS[e.id].description;
    for (const l of wrapText(desc, d.w - 20)) { drawText(ctx, l, x, y, { color: UI.text, shadow: false }); y += 10; }
    y += 4;
    drawText(ctx, entryEffect(e), x, y, { color: tint(UI.good, -0.4), shadow: false });
    y += 16;
    if (e.kind === 'food') {
      // point the way to the Snack Bar
      const bob = Math.round(Math.sin(app.time * 5) * (foodNudge > 0 ? 3 : 1));
      fillRoundRect(ctx, x, y, d.w - 20, 40, 4, tint(UI.panelDark, 0.35));
      drawActivityIcon(ctx, 'feed', x + 18, y + 20 + bob, 22);
      const lines = wrapText(`Feed snacks at the ${ACTIVITIES.feed.name.toUpperCase()} in the Burrow. Feeding never uses an activity slot!`, d.w - 60);
      lines.slice(0, 3).forEach((l, i) => drawText(ctx, l, x + 34, y + 6 + i * 10, { color: UI.text, shadow: false }));
      y += 46;
    } else if (!ITEMS[e.id].fieldUse) {
      fillRoundRect(ctx, x, y, d.w - 20, 30, 4, tint(UI.panelDark, 0.35));
      const lines = wrapText('BATTLE ONLY: pick BAG during a fight to use it.', d.w - 32);
      lines.slice(0, 2).forEach((l, i) => drawText(ctx, l, x + 6, y + 6 + i * 10, { color: UI.text, shadow: false }));
      y += 36;
    } else if (mode === 'dragons') {
      drawText(ctx, 'USE IT ON WHO?', x, y, { size: 2, color: UI.accent, shadowColor: tint(UI.panelLight, -0.2) });
      y += 22;
    } else {
      drawText(ctx, 'PRESS USE TO PICK A DRAGON.', x, y, { color: UI.textDim, shadow: false });
      y += 14;
    }
    // the last thing that happened
    if (line && lineT > 0) {
      const lines = wrapText(line.toUpperCase(), d.w - 24).slice(0, 4);
      const by = Math.min(y, d.y + d.h - 40 - lines.length * 10);
      const fill = lineOk ? '#dff5d0' : '#ffe0d8';
      fillRoundRect(ctx, x - 2, by - 4, d.w - 16, lines.length * 10 + 6, 3, fill);
      lines.forEach((l, i) => drawText(ctx, l, x + 2, by + i * 10, { color: lineOk ? tint(UI.good, -0.5) : tint(UI.bad, -0.2), shadow: false }));
    }
  }

  return {
    name: 'bag',
    overlay: true,
    enter() { music('burrow'); },
    update(dt: number, input: Input) {
      fx.update(dt);
      lineT = Math.max(0, lineT - dt);
      foodNudge = Math.max(0, foodNudge - dt);
      for (const [id, v] of shownHp) {
        const d = app.state.dragons.find((x) => x.id === id);
        if (!d) { shownHp.delete(id); continue; }
        const nv = v + (d.hp - v) * Math.min(1, dt * 6);
        if (Math.abs(d.hp - nv) < 0.5) shownHp.delete(id); else shownHp.set(id, nv);
      }
      if (mode === 'items') items.update(input);
      else dragons.update(input);
      group.update(input);
    },
    draw(ctx: Ctx) {
      drawPanel(ctx, P.x, P.y, P.w, P.h, { title: mode === 'items' ? 'BAG' : 'BAG: PICK A DRAGON' });
      if (mode === 'items') {
        drawText(ctx, 'SNACKS AND ITEMS', LIST.x + 4, LIST.y - 13, { color: UI.textDim, shadow: false });
        drawText(ctx, 'HAVE', LIST.x + LIST.w - 6, LIST.y - 13, { align: 'right', color: UI.textDim, shadow: false });
        drawInset(ctx, LIST.x - 4, LIST.y - 3, LIST.w + 8, 26 * 10 + 6);
        items.draw(ctx);
      } else {
        drawText(ctx, 'DRAGON', LIST.x + 30, LIST.y - 13, { color: UI.textDim, shadow: false });
        drawText(ctx, 'HP', LIST.x + 116, LIST.y - 13, { color: UI.textDim, shadow: false });
        const it = currentItem();
        drawText(ctx, it ? itemEffect(ITEMS[it]) : '', LIST.x + LIST.w - 6, LIST.y - 13, { align: 'right', color: UI.textDim, shadow: false });
        drawInset(ctx, LIST.x - 4, LIST.y - 3, LIST.w + 8, LIST.h + 6);
        dragons.draw(ctx);
      }
      drawDetail(ctx);
      useBtn.spec.label = mode === 'items' ? 'USE' : 'USE IT!';
      group.draw(ctx);
      if (useBtn.isVisible) drawKeycap(ctx, 'ENTER', useBtn.spec.rect.x - 40, useBtn.spec.rect.y + 5);
      fx.draw(ctx);
    },
  };
}
