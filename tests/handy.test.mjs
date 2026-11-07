/*
 * Handy-Ansicht: Kopfzeile mit Menü darf keine Knöpfe verdecken.
 * Die Statusleiste des iPhones (Uhrzeit, Akku) wird mit 50 px simuliert.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, openApp, dbRows } from './helpers.mjs';

useBrowser();
const IPHONE = { width: 390, height: 844 };

async function openPhone() {
  const app = await openApp({ rows: dbRows(), viewport: IPHONE });
  await app.page.addStyleTag({ content: ':root{--sat:50px !important}' });
  return app;
}
/** Ist der Knopf an seiner Mitte wirklich antippbar (nicht vom Menü verdeckt)? */
const tappable = (app, sel) => app.ev(sel => {
  const el = document.querySelector(sel), r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { hit: !!hit && (hit === el || el.contains(hit)), y: Math.round(r.top + r.height / 2) };
}, sel);

test('Menü überdeckt beim Start keinen Inhalt', async () => {
  const app = await openPhone();
  await app.act('go', 'reports');
  const r = await app.ev(() => ({ head: document.querySelector('header.top').getBoundingClientRect().bottom, main: document.querySelector('#main').getBoundingClientRect().top }));
  assert.ok(r.main >= r.head - 1, `Inhalt beginnt bei ${r.main}px, Menü endet bei ${r.head}px`);
  await app.close();
});

test('Quittungen/Kassabuch lässt sich nach leichtem Scrollen umschalten', async () => {
  const app = await openPhone();
  await app.act('go', 'reports');
  for (const scroll of [0, 10, 30]) {
    await app.ev(y => window.scrollTo(0, y), scroll);
    for (const [kind, other] of [['kassabuch', 'quittungen'], ['quittungen', 'kassabuch']]) {
      const sel = `[data-act="repKind"][data-id="${kind}"]`;
      const t = await tappable(app, sel);
      assert.ok(t.hit, `«${kind}» ist bei ${scroll}px Scrollweite verdeckt`);
      const box = await app.page.locator(sel).boundingBox();
      await app.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      assert.equal(await app.ev(() => ui.rep.kind), kind);
      assert.notEqual(kind, other);
      await app.ev(y => window.scrollTo(0, y), scroll);
    }
  }
  await app.close();
});

test('Umschalter ist auf dem Handy gross genug zum Antippen', async () => {
  const app = await openPhone();
  await app.act('go', 'reports');
  const box = await app.page.locator('[data-act="repKind"][data-id="kassabuch"]').boundingBox();
  assert.ok(box.height >= 44, `Höhe ${box.height}px`);
  assert.ok(box.width >= 140, `Breite ${box.width}px`);
  await app.close();
});
