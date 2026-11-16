// The Pantry Shop: an overlay over the Burrow, run by Auntie Sprinkles, a chef dragon hamster.
//
//   left    her little shop: awning, shelves, counter, a speech bubble that reacts to every purchase
//   right   the SHOP shelves as rows (icon, name, effect, owned count, price) and a detail box with
//           the full description and BUY X1 / BUY X5 (disabled when unaffordable; poking them anyway
//           gets an error sound and a gentle word from the shopkeeper)
//
// Keys: Up/Down pick a row, Enter or 1 buys one, 5 buys five, Escape closes.
import { drawText, measureText } from '../../lib/engine/text.ts';
import { app } from '../app.ts';
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import {
  Button, ButtonGroup, ScrollList, Typewriter, UI, drawCoins, drawInset, drawPanel, drawPlaque,
  drawKeycap, drawSelection, drawTypewriter, fillRoundRect, foodEffectText, hit, itemEffectText, tint, wrapText, type Rect,
} from '../widgets.ts';
import { drawCoinIcon, drawFoodIcon, drawItemIcon } from '../icons.ts';
import { drawDragon, type Pose } from '../../art/dragon.ts';
import { createFx } from '../../art/fx.ts';
import { music, sfx } from '../../audio/index.ts';
import { FOODS, ITEMS, isFood } from '../../data/index.ts';
import type { DragonVisual, FoodId, ItemId } from '../../data/schema.ts';
import { SHOP, buy, owned, shopName } from '../../game/shop.ts';
import { BAG_MAX } from '../../game/habitat.ts';

type Ctx = CanvasRenderingContext2D;
type ShopId = FoodId | ItemId;
interface Entry { id: ShopId; price: number }

/** Auntie Sprinkles: a plump, cream-coloured chef hamster with a whisk of a tail. */
const SHOPKEEPER: DragonVisual = {
  body: '#f2c48a', belly: '#fff1dc', accent: '#e8734a', wing: '#ffd9b0', eye: '#2a1a1a', cheek: '#ff8f9a',
  size: 1.1, build: 0.12, wings: 'stubby', horns: 'nubs', tail: 'whisk', pattern: 'patches',
  extras: ['chefHat', 'apron', 'bowtie'],
};
const KEEPER_NAME = 'AUNTIE SPRINKLES';

const GREETINGS = [
  'Welcome to the Pantry Shop, agent! Everything is fresh. Except my jokes.',
  'Hello, dear! Snacks for heroes, cakes for emergencies.',
  'Psst. Dragonfruit is magic. Do not tell the mice.',
];
const THANKS = [
  'Lovely choice! Mind the crumbs.',
  'Ka-ching! Your dragons will thank you.',
  'Pleasure doing business, agent!',
  'Ooh, good pick. I had one for breakfast.',
  'Wrapped with love and a sprinkle of seeds!',
];
const BULK = [
  'Five at once? A bulk buyer! I like you.',
  'That is a LOT of snacks. I respect it.',
  'Five! Shall I fetch a wheelbarrow?',
];

/** A one-line effect summary for a food or item (shared wording with the bag). */
function effectLine(id: ShopId): string {
  if (isFood(id)) {
    return foodEffectText(FOODS[id]);
  }
  return itemEffectText(ITEMS[id as ItemId]);
}

function drawEntryIcon(ctx: Ctx, id: ShopId, cx: number, cy: number, s: number): void {
  if (isFood(id)) drawFoodIcon(ctx, id, cx, cy, s);
  else drawItemIcon(ctx, id as ItemId, cx, cy, s);
}

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

export function createShopScene(): Scene {
  const P: Rect = { x: 8, y: 16, w: 624, h: 334 };
  const BOOTH: Rect = { x: P.x + 10, y: P.y + 12, w: 200, h: P.h - 22 };
  const LIST: Rect = { x: 228, y: 56, w: 392, h: 22 * 10 };
  const DETAIL: Rect = { x: 222, y: 284, w: 404, h: 58 };
  const entries: Entry[] = SHOP.map((e) => ({ id: e.id, price: e.price }));
  const fx = createFx();
  const say = new Typewriter(55);
  say.set(pick(GREETINGS));
  let shownCoins = app.state.coins;
  let coinPulse = 0;
  let poseName: Pose = 'idle';
  let poseTime = 0;
  /** Row id -> seconds left of its "just bought" glow. */
  const glow = new Map<ShopId, number>();
  let shake = 0;

  const list = new ScrollList<Entry>({
    rect: LIST, rowH: 22, items: () => entries, drawRow,
    onSelect: () => sfx('click', { volume: 0.5 }),
    onActivate: () => attempt(1),
  });

  const selected = (): Entry | undefined => entries[list.selected];
  const canBuy = (qty: number): boolean => {
    const e = selected();
    return !!e && app.state.coins >= e.price * qty && owned(app.state, e.id) + qty <= BAG_MAX;
  };

  const group = new ButtonGroup();
  group.keyboard = false;
  const buy1 = group.add({
    label: 'BUY X1', sub: '', rect: { x: DETAIL.x + DETAIL.w - 98, y: DETAIL.y + 4, w: 92, h: 24 }, color: UI.good,
    hotkey: '1', enabled: () => canBuy(1), onClick: () => attempt(1),
    decorate: (ctx, face) => drawKeycap(ctx, '1', face.x + face.w - 13, face.y + 4),
  });
  const buy5 = group.add({
    label: 'BUY X5', sub: '', rect: { x: DETAIL.x + DETAIL.w - 98, y: DETAIL.y + 31, w: 92, h: 24 }, color: UI.good,
    hotkey: '5', enabled: () => canBuy(5), onClick: () => attempt(5),
    decorate: (ctx, face) => drawKeycap(ctx, '5', face.x + face.w - 13, face.y + 4),
  });
  group.add({
    label: 'BACK', rect: { x: P.x + P.w - 76, y: P.y + 6, w: 68, h: 20 }, hotkey: 'Escape', align: 'left',
    onClick: () => { sfx('back'); app.scenes.pop(); },
    decorate: (ctx, face) => drawKeycap(ctx, 'ESC', face.x + face.w - 23, face.y + Math.floor((face.h - 12) / 2)),
  });

  function speak(text: string, pose: Pose): void {
    say.set(text);
    poseName = pose;
    poseTime = 0;
  }

  function attempt(qty: number): void {
    const e = selected();
    if (!e) return;
    const name = shopName(e.id);
    const have = owned(app.state, e.id);
    if (have + qty > BAG_MAX) {
      sfx('error'); shake = 0.3;
      speak(`Your shelves are stuffed! You can carry ${BAG_MAX} ${name} at most.`, 'hurt');
      return;
    }
    const cost = e.price * qty;
    if (cost > app.state.coins) {
      sfx('error'); shake = 0.3;
      speak(`Oh dear, you are ${cost - app.state.coins} coins short. The Treasure Tunnels are full of shiny coins!`, 'hurt');
      return;
    }
    const r = buy(app.state, e.id, qty);
    if (!r.ok) { sfx('error'); shake = 0.3; speak(r.line, 'hurt'); return; }
    app.save();
    sfx('coin');
    if (qty > 1) sfx('coin', { delay: 0.08, pitch: 1.2 });
    speak(qty > 1 ? pick(BULK) : pick(THANKS), 'happy');
    glow.set(e.id, 0.7);
    coinPulse = 0.5;
    // coins fly off the counter, the price floats up from the coin chip
    const rowY = LIST.y + list.selected * 22 - list.scroll + 11;
    fx.burst(LIST.x + 14, rowY, UI.gold, 6 + qty * 2);
    fx.floatText(LIST.x + LIST.w - 22, rowY - 4, `-${cost}`, '#ff8a7a');
    fx.floatText(LIST.x + 304, rowY - 4, `+${qty}`, '#8ef07a');
  }

  function coinX(): number {
    return P.x + P.w - 84 - (measureText(String(Math.floor(shownCoins))) + 21);
  }

  // ---------------------------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------------------------

  function drawRow(ctx: Ctx, e: Entry, r: Rect, sel: boolean, hov: boolean): void {
    drawSelection(ctx, r, sel, hov);
    const g = glow.get(e.id) ?? 0;
    if (g > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(1, g * 2) * 0.45;
      fillRoundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 2, '#9cf08a');
      ctx.restore();
    }
    drawEntryIcon(ctx, e.id, r.x + 13, r.y + 11, 14);
    drawText(ctx, shopName(e.id), r.x + 26, r.y + 8, { color: UI.text, shadow: false });
    drawText(ctx, effectLine(e.id), r.x + 128, r.y + 8, { color: UI.textDim, shadow: false });
    const have = owned(app.state, e.id);
    drawText(ctx, 'X' + have, r.x + 300, r.y + 8, { color: have > 0 ? UI.text : UI.textDim, shadow: false });
    const afford = app.state.coins >= e.price;
    const pt = String(e.price);
    const px = r.x + r.w - 6 - measureText(pt);
    drawCoinIcon(ctx, px - 8, r.y + 11, 4);
    drawText(ctx, pt, px, r.y + 8, { color: afford ? UI.text : UI.bad, shadow: false });
  }

  function drawBooth(ctx: Ctx): void {
    const b = BOOTH;
    const t = app.time;
    // back wall: warm planks
    ctx.save();
    ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
    ctx.fillStyle = '#d9a86c'; ctx.fillRect(b.x, b.y, b.w, b.h);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = i % 2 ? '#cf9c60' : '#dcae74';
      ctx.fillRect(b.x, b.y + 14 + i * 34, b.w, 33);
      ctx.fillStyle = '#b9824a';
      ctx.fillRect(b.x, b.y + 14 + i * 34 + 33, b.w, 1);
    }
    // shelves with stock (what the shop sells, read from the content)
    const foods = entries.filter((e) => isFood(e.id));
    const items = entries.filter((e) => !isFood(e.id));
    const shelf = (y: number, row: Entry[]): void => {
      row.forEach((e, i) => drawEntryIcon(ctx, e.id, b.x + 24 + i * 38, y - 9, 14));
      ctx.fillStyle = '#7a4a28'; ctx.fillRect(b.x + 8, y, b.w - 16, 5);
      ctx.fillStyle = '#a8703c'; ctx.fillRect(b.x + 8, y, b.w - 16, 1);
      ctx.fillStyle = '#5a341c'; ctx.fillRect(b.x + 14, y + 5, 3, 4); ctx.fillRect(b.x + b.w - 17, y + 5, 3, 4);
    };
    shelf(b.y + 52, foods);
    shelf(b.y + 86, items);
    // awning
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 ? '#fff1dc' : '#e8574c';
      ctx.fillRect(b.x + i * 20, b.y, 20, 12);
      ctx.beginPath(); ctx.arc(b.x + i * 20 + 10, b.y + 12, 10, 0, Math.PI); ctx.fill();
    }
    ctx.fillStyle = 'rgba(27,20,38,0.25)'; ctx.fillRect(b.x, b.y + 22, b.w, 2);
    // the shopkeeper
    let pose: Pose = poseName, poseT = 0;
    if (poseName === 'happy' && poseTime > 1.1) pose = poseName = 'idle';
    if (poseName === 'hurt') { poseT = Math.min(1, poseTime / 0.6); if (poseTime > 0.8) poseName = 'idle'; }
    if (poseName === 'idle' && !say.done) pose = 'idle';
    drawDragon(ctx, SHOPKEEPER, b.x + 100, b.y + 294, { scale: 2, facing: 1, t, pose, poseT });
    // counter
    const cy = b.y + 270;
    ctx.fillStyle = UI.ink; ctx.fillRect(b.x, cy - 1, b.w, b.h - (cy - b.y) + 1);
    ctx.fillStyle = '#9a6440'; ctx.fillRect(b.x, cy + 6, b.w, b.h);
    ctx.fillStyle = '#c38a58'; ctx.fillRect(b.x, cy, b.w, 7);
    ctx.fillStyle = '#e0aa70'; ctx.fillRect(b.x, cy, b.w, 1);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = '#86552f'; ctx.fillRect(b.x + 16 + i * 34, cy + 9, 1, b.h); }
    // a jar of seeds and a little bell on the counter
    fillRoundRect(ctx, b.x + 14, cy - 15, 14, 15, 3, UI.ink);
    fillRoundRect(ctx, b.x + 15, cy - 14, 12, 13, 2, '#d8f0ff');
    drawFoodIcon(ctx, 'seeds', b.x + 21, cy - 6, 9);
    fillRoundRect(ctx, b.x + 13, cy - 18, 16, 4, 1, '#e8574c');
    ctx.fillStyle = UI.ink; ctx.fillRect(b.x + 168, cy - 10, 16, 10); ctx.fillRect(b.x + 175, cy - 13, 2, 3);
    ctx.fillStyle = '#f6c63c'; ctx.fillRect(b.x + 169, cy - 9, 14, 8);
    ctx.fillStyle = '#fff0a0'; ctx.fillRect(b.x + 171, cy - 8, 4, 2);
    ctx.restore();
    // name plaque on the counter front
    const pw = measureText(KEEPER_NAME) + 12;
    drawPlaque(ctx, KEEPER_NAME, b.x + Math.round((b.w - pw) / 2), cy + 18);
    drawInsetFrame(ctx, b);
    // speech bubble
    const sb: Rect = { x: b.x + 8, y: b.y + 104, w: b.w - 16, h: 56 };
    fillRoundRect(ctx, sb.x, sb.y + 2, sb.w, sb.h, 5, 'rgba(27,20,38,0.2)');
    fillRoundRect(ctx, sb.x, sb.y, sb.w, sb.h, 5, UI.ink);
    fillRoundRect(ctx, sb.x + 1, sb.y + 1, sb.w - 2, sb.h - 2, 4, '#ffffff');
    const tx = b.x + 120;
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = UI.ink; ctx.fillRect(tx - 7 + i, sb.y + sb.h - 1 + i, 14 - i * 2 + 1, 1);
      if (i < 6) { ctx.fillStyle = '#ffffff'; ctx.fillRect(tx - 6 + i, sb.y + sb.h - 2 + i, 13 - i * 2, 1); }
    }
    drawTypewriter(ctx, say, sb.x + 8, sb.y + 8, sb.w - 16, { color: UI.text, shadow: false });
  }

  function drawInsetFrame(ctx: Ctx, b: Rect): void {
    ctx.fillStyle = UI.ink;
    ctx.fillRect(b.x - 1, b.y - 1, b.w + 2, 1); ctx.fillRect(b.x - 1, b.y + b.h, b.w + 2, 1);
    ctx.fillRect(b.x - 1, b.y, 1, b.h); ctx.fillRect(b.x + b.w, b.y, 1, b.h);
  }

  function drawDetail(ctx: Ctx): void {
    const e = selected();
    const d = DETAIL;
    drawInset(ctx, d.x, d.y, d.w, d.h, { fill: UI.panelLight });
    if (!e) return;
    const bx = d.x + 8;
    fillRoundRect(ctx, bx, d.y + 8, 36, 36, 4, tint(UI.panelDark, 0.2));
    drawEntryIcon(ctx, e.id, bx + 18, d.y + 26, 26);
    const tx = bx + 44, tw = buy1.spec.rect.x - tx - 8;
    drawText(ctx, shopName(e.id).toUpperCase(), tx, d.y + 6, { color: UI.text, shadow: false });
    const desc = isFood(e.id) ? FOODS[e.id].description : ITEMS[e.id as ItemId].description;
    const lines = wrapText(desc, tw).slice(0, 3);
    lines.forEach((l, i) => drawText(ctx, l, tx, d.y + 17 + i * 9, { color: UI.textDim, shadow: false }));
    const kind = isFood(e.id) ? 'SNACK: FEED IT AT THE SNACK BAR' : ITEMS[e.id as ItemId].fieldUse ? 'ITEM: USE IT FROM THE BAG OR IN BATTLE' : 'ITEM: FOR BATTLE ONLY';
    if (lines.length < 4) drawText(ctx, kind, tx, d.y + d.h - 11, { color: tint(UI.info, -0.3), shadow: false });
    buy1.spec.sub = `${e.price} COINS`;
    buy5.spec.sub = `${e.price * 5} COINS`;
  }

  function drawHeader(ctx: Ctx): void {
    drawText(ctx, 'ITEM', LIST.x + 26, LIST.y - 11, { color: UI.textDim, shadow: false });
    drawText(ctx, 'EFFECT', LIST.x + 128, LIST.y - 11, { color: UI.textDim, shadow: false });
    drawText(ctx, 'HAVE', LIST.x + 296, LIST.y - 11, { color: UI.textDim, shadow: false });
    drawText(ctx, 'PRICE', LIST.x + LIST.w - 6, LIST.y - 11, { color: UI.textDim, shadow: false, align: 'right' });
    // coins chip, with a little jolt when spent or refused
    const jx = shake > 0 ? Math.round(Math.sin(shake * 60) * 2) : 0;
    const cx = coinX() + jx;
    const w = drawCoins(ctx, shownCoins, cx, P.y + 9);
    if (coinPulse > 0 || shake > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(coinPulse, shake) * 2) * 0.45;
      fillRoundRect(ctx, cx, P.y + 9, w, 13, 3, shake > 0 ? UI.bad : '#ffffff');
      ctx.restore();
    }
  }

  return {
    name: 'shop',
    overlay: true,
    enter() {
      music('burrow');
      shownCoins = app.state.coins;
      // start on the first thing the player can afford
      const i = entries.findIndex((e) => e.price <= app.state.coins);
      list.selected = Math.max(0, i);
    },
    update(dt: number, input: Input) {
      fx.update(dt);
      say.update(dt);
      poseTime += dt;
      coinPulse = Math.max(0, coinPulse - dt);
      shake = Math.max(0, shake - dt);
      for (const [k, v] of glow) { if (v - dt <= 0) glow.delete(k); else glow.set(k, v - dt); }
      if (shownCoins !== app.state.coins) {
        const diff = app.state.coins - shownCoins;
        shownCoins += Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * 0.15));
        if (Math.sign(app.state.coins - shownCoins) !== Math.sign(diff)) shownCoins = app.state.coins;
      }
      // a click on the speech bubble finishes the sentence
      if (input.pointer.pressed && hit({ x: BOOTH.x, y: BOOTH.y + 100, w: BOOTH.w, h: 64 }, input.pointer.x, input.pointer.y)) say.skip();
      // poking a disabled BUY still answers (with a polite no)
      const p = input.pointer;
      for (const [b, qty] of [[buy1, 1], [buy5, 5]] as [Button, number][]) {
        if (b.isEnabled) continue;
        if ((p.pressed && hit(b.spec.rect, p.x, p.y)) || input.pressed(String(qty))) { attempt(qty); return; }
      }
      list.update(input);
      group.update(input);
      // Enter buys one, so the focus ring belongs on BUY X1 (hidden while it is disabled)
      group.focus = 0;
    },
    draw(ctx: Ctx) {
      drawPanel(ctx, P.x, P.y, P.w, P.h, { title: 'PANTRY SHOP' });
      drawBooth(ctx);
      drawHeader(ctx);
      drawInset(ctx, LIST.x - 4, LIST.y - 3, LIST.w + 8, LIST.h + 6);
      list.draw(ctx);
      drawDetail(ctx);
      group.draw(ctx);
      fx.draw(ctx);
    },
  };
}
