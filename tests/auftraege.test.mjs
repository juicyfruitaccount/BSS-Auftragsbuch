/*
 * Aufträge: Erfassung in vier Schritten, Status, Kunde informieren,
 * Abrechnung mit Material und Rabatt, Quittung, Löschen.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, openApp, dbRows, customer, order, racket, TODAY } from './helpers.mjs';

useBrowser();
const next = app => app.page.click('#wiz button.primary');

describe('Neuer Auftrag in vier Schritten', () => {
  test('neuer Kunde mit Schläger aus den Stammdaten', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('newOrder');
    // Schritt 1: Kunde
    await app.page.fill('#w-name', 'Marco Keller');
    await app.page.fill('#w-phone', '079 412 33 21');
    await next(app);
    // Schritt 2: Schläger
    await app.page.selectOption('#r-brand', 'Babolat');
    await app.page.selectOption('#r-modelId', 'md1');
    assert.match(await app.modalText(), /Saitenbild 16x20 · Kopfgrösse 98 in²/);
    await app.page.fill('#sp-weight', '305');
    await next(app);
    // Schritt 3: Besaitung
    await app.page.fill('#o-main', 'Babolat RPM Blast');
    await app.page.fill('#o-tMain', '24');
    await app.page.fill('#o-tCross', '23');
    await next(app);
    // Schritt 4: Abschluss
    assert.equal(await app.page.inputValue('#o-stringPrice'), '22');
    assert.equal(await app.page.inputValue('#o-labor'), '25');
    assert.match(await app.modalText(), /Tuning\s*Keine/i);
    await next(app);

    const r = await app.ev(() => ({ c: S.customers, o: S.orders }));
    assert.equal(r.c.length, 1);
    assert.equal(r.c[0].name, 'Marco Keller');
    assert.equal(r.c[0].rackets.length, 1);
    const rk = r.c[0].rackets[0];
    assert.equal(rk.model, 'Pure Aero 98');
    assert.equal(rk.pattern, '16x20');
    assert.equal(rk.specs.weight, '305.0');
    assert.equal(rk.pref.main, 'Babolat RPM Blast', 'Vorlieben werden gespeichert');
    assert.equal(r.o.length, 1);
    const o = r.o[0];
    assert.equal(o.no, 1);
    assert.equal(o.status, 'angenommen');
    assert.equal(o.racketId, rk.id);
    assert.equal(o.tMain, '24');
    assert.equal(o.tCross, '23');
    assert.equal(o.receivedAt, TODAY);
    assert.equal(o.dueAt, '2026-11-09');
    assert.equal(o.stringPrice, 22);
    assert.equal(await app.ev(() => total(S.orders[0])), 47);
    assert.equal(o.tuning, undefined, 'ohne Tuning kein Tuning-Auftrag');
    assert.match(await app.toast(), /Auftrag #1 erfasst/);

    await app.saved();
    const db = await app.db();
    assert.ok(db.some(x => x.col === 'orders' && x.id === o.id), 'Auftrag ist online gespeichert');
    assert.ok(db.some(x => x.col === 'customers' && x.data.name === 'Marco Keller'), 'Kunde ist online gespeichert');
    await app.close();
  });

  test('neue Marke und neues Modell lassen sich eintippen', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('newOrder');
    await app.page.fill('#w-name', 'Flavia');
    await next(app);
    await app.page.selectOption('#r-brand', '__new');
    assert.equal(await app.page.isVisible('#r-newBrand'), true);
    assert.equal(await app.page.isVisible('#r-newModel'), true, 'Feld für das neue Modell ist sichtbar');
    assert.equal(await app.page.isVisible('#r-modelId'), false);
    await app.page.fill('#r-newBrand', 'Pacific');
    await app.page.fill('#r-newModel', 'BXT X Force Pro');
    await app.page.selectOption('#r-newPattern', '16x19');
    await next(app);
    await app.page.fill('#o-main', 'Wilson NXT');
    await next(app);
    await next(app);
    const r = await app.ev(() => ({ m: S.models.find(m => m.brand === 'Pacific'), rk: S.customers[0].rackets[0] }));
    assert.equal(r.m.model, 'BXT X Force Pro');
    assert.equal(r.m.pattern, '16x19');
    assert.equal(r.rk.modelId, r.m.id);
    await app.close();
  });

  test('bestehender Kunde: Vorlieben des Schlägers sind vorausgefüllt', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()] }) });
    await app.act('newOrder');
    await app.page.selectOption('#w-cid', 'c1');
    await next(app);
    assert.equal(await app.page.inputValue('#r-brand'), 'Wilson');
    assert.equal(await app.page.inputValue('#r-modelId'), 'md2');
    await next(app);
    assert.equal(await app.page.inputValue('#o-main'), 'Wilson NXT');
    assert.equal(await app.page.inputValue('#o-tMain'), '23');
    assert.equal(await app.page.inputValue('#o-prestretch'), '10%');
    await next(app);
    await next(app);
    const o = await app.ev(() => S.orders[0]);
    assert.equal(o.customerId, 'c1');
    assert.equal(o.racketId, 'r1');
    assert.equal(o.prestretch, '10%');
    assert.equal(await app.ev(() => S.customers.length), 1, 'kein doppelter Kunde');
    await app.close();
  });

  test('ohne Namen geht es nicht weiter', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('newOrder');
    await next(app);
    assert.match(await app.toast(), /Bitte den Namen eingeben/);
    assert.equal(await app.ev(() => W.step), 1);
    await app.close();
  });

  test('ohne Saite geht es nicht weiter', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer({ rackets: [racket({ pref: { main: '', cross: '', tMain: '', tCross: '', prestretch: '0%', knots: '4' } })] })] }) });
    await app.act('newOrder');
    await app.page.selectOption('#w-cid', 'c1');
    await next(app);
    await next(app);
    await next(app);
    assert.match(await app.toast(), /Bitte die Längssaite angeben/);
    assert.equal(await app.ev(() => W.step), 3);
    await app.close();
  });

  test('Zurück behält die Eingaben', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('newOrder');
    await app.page.fill('#w-name', 'Luca Brunner');
    await next(app);
    await app.act('wizBack');
    assert.equal(await app.page.inputValue('#w-name'), 'Luca Brunner');
    await app.close();
  });

  test('Nur Kunde speichern legt keinen Auftrag an', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('go', 'kunden');
    await app.act('newCustomer');
    await app.page.fill('#w-name', 'Alessia');
    await app.act('wizCustOnly');
    const r = await app.ev(() => ({ c: S.customers.length, o: S.orders.length, view: ui.view }));
    assert.deepEqual(r, { c: 1, o: 0, view: 'kunde' });
    await app.close();
  });

  test('neue Saite landet automatisch im Katalog', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()] }) });
    await app.act('newOrder');
    await app.page.selectOption('#w-cid', 'c1');
    await next(app); await next(app);
    await app.page.fill('#o-main', 'Tecnifibre X-One');
    await next(app);
    await app.page.fill('#o-stringPrice', '28');
    await next(app);
    const s = await app.ev(() => S.strings.find(x => x.name === 'Tecnifibre X-One'));
    assert.equal(s.price, 28);
    await app.close();
  });
});

describe('Status und Kunde informieren', () => {
  test('Angenommen → In Arbeit → Fertig → Abgeholt', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.act('advance', 'o1');
    assert.equal(await app.ev(() => S.orders[0].status), 'in_arbeit');
    await app.act('advance', 'o1');
    const o = await app.ev(() => S.orders[0]);
    assert.equal(o.status, 'fertig');
    assert.equal(o.doneAt, TODAY);
    // Beim Fertigmelden öffnet sich die Nachricht an den Kunden
    const msg = await app.page.inputValue('#msgtxt');
    assert.equal(msg, 'Hallo Sandra, dein Wilson Blade 98 v9 ist fertig. Betrag: ' + await app.ev(() => money(49)));
    const href = await app.page.getAttribute('#walink', 'href');
    assert.ok(href.startsWith('https://wa.me/41762881054?text=Hallo%20Sandra'));
    await app.act('close');
    await app.act('advance', 'o1');
    assert.equal(await app.ev(() => S.orders[0].status), 'abgeholt');
    assert.equal(await app.page.isVisible('[data-act="advance"][data-id="o1"]'), false, 'abgeholte Aufträge sind aus der Liste «Aktiv»');
    await app.close();
  });

  test('überfällige Aufträge werden markiert', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order({ dueAt: '2026-11-05' })] }) });
    assert.match(await app.mainText(), /überfällig/);
    await app.close();
  });

  test('Suche findet Aufträge nach Kundenname', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer(), customer({ id: 'c2', name: 'Marco Keller', rackets: [] })], orders: [order(), order({ id: 'o2', no: 2, customerId: 'c2', racketId: '' })] }) });
    await app.page.fill('#q', 'marco');
    const n = await app.page.locator('article.order').count();
    assert.equal(n, 1);
    assert.match(await app.mainText(), /Marco Keller/);
    await app.close();
  });

  test('Bezahlt markieren setzt das Zahlungsdatum', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.act('markPaid', 'o1');
    const o = await app.ev(() => S.orders[0]);
    assert.equal(o.paid, true);
    assert.equal(o.paidAt, TODAY);
    await app.close();
  });
});

describe('Abrechnung und Quittung', () => {
  test('Material verkaufen und 10 % Rabatt geben', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.act('checkout', 'o1');
    await app.page.selectOption('#ck-mat', 'm2');
    await app.page.fill('#ck-qty', '2');
    await app.act('addItem');
    await app.page.selectOption('#ck-mat', 'm1');
    await app.act('addItem');
    await app.act('dQuick', '10');
    // 25 + 24 + 2×3 + 12 = 67, Rabatt 6.70 → 60.30
    assert.match(await app.page.innerText('#ck-sum'), /Total\s*CHF 60\.30/);
    await app.act('saveCheckout');
    const o = await app.ev(() => S.orders[0]);
    assert.equal(o.items.length, 2);
    assert.deepEqual(o.items.find(i => i.materialId === 'm2'), { materialId: 'm2', name: 'Dämpfer Standard', price: 3, qty: 2 });
    assert.deepEqual(o.discount, { type: 'pct', value: 10 });
    assert.equal(await app.ev(() => total(S.orders[0])), 60.3);
    await app.close();
  });

  test('gleiches Material zweimal hinzufügen erhöht die Menge', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.act('checkout', 'o1');
    await app.page.selectOption('#ck-mat', 'm2');
    await app.act('addItem');
    await app.act('addItem');
    assert.deepEqual(await app.ev(() => draft.items.map(i => i.qty)), [2]);
    await app.act('qtyDown', '0');
    await app.act('qtyDown', '0');
    assert.equal(await app.ev(() => draft.items.length), 0, 'Menge 0 entfernt die Position');
    await app.close();
  });

  test('Rabatt in CHF', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.act('checkout', 'o1');
    await app.act('dType', 'abs');
    await app.page.fill('#ck-disc', '9');
    assert.match(await app.page.innerText('#ck-sum'), /Total\s*CHF 40\.00/);
    await app.act('saveCheckout');
    assert.deepEqual(await app.ev(() => S.orders[0].discount), { type: 'abs', value: 9 });
    await app.close();
  });

  test('Abbrechen verwirft die Änderungen', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.act('checkout', 'o1');
    await app.act('dQuick', '20');
    await app.act('close');
    assert.equal(await app.ev(() => S.orders[0].discount), null);
    await app.close();
  });

  test('Quittung zeigt alle Positionen und speichert das Datum', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order({ items: [{ materialId: 'm1', name: 'Wilson Pro Overgrip (3 Stk.)', price: 12, qty: 1 }], discount: { type: 'pct', value: 10 } })] }) });
    await app.act('checkout', 'o1');
    await app.act('toReceipt');
    const text = await app.page.inputValue('#rcpt');
    assert.match(text, /^BSS Test\nTeststrasse 1\n5442 Fislisbach\n\nQUITTUNG Nr\. 1\nDatum: 07\.11\.2026\nKunde: Sandra Meier/);
    assert.match(text, /Besaitung Wilson Blade 98 v9, 23\/22 kg  CHF 25\.00/);
    assert.match(text, /Saite: Wilson NXT  CHF 24\.00/);
    assert.match(text, /Wilson Pro Overgrip \(3 Stk\.\)  CHF 12\.00/);
    assert.match(text, /Zwischensumme  CHF 61\.00/);
    assert.match(text, /Rabatt 10%  −CHF 6\.10/);
    assert.match(text, /TOTAL  CHF 54\.90/);
    assert.match(text, /Zahlung offen\./);
    assert.equal(await app.ev(() => S.orders[0].receiptAt), TODAY);
    await app.act('markPaidR', 'o1');
    assert.match(await app.page.inputValue('#rcpt'), /Betrag erhalten am 07\.11\.2026\. Besten Dank!/);
    await app.close();
  });

  test('Hybrid-Besaitung auf der Quittung', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order({ main: 'Babolat RPM Blast', cross: 'Wilson NXT', stringPrice: 23 })] }) });
    await app.ev(() => A.receipt('o1'));
    assert.match(await app.page.inputValue('#rcpt'), /Saiten Hybrid: Babolat RPM Blast \/ Wilson NXT  CHF 23\.00/);
    await app.close();
  });
});

describe('Löschen', () => {
  test('Kunde löschen entfernt auch seine Aufträge', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer(), customer({ id: 'c2', name: 'Andere', rackets: [] })], orders: [order(), order({ id: 'o2', no: 2, customerId: 'c2', racketId: '' })] }) });
    await app.ev(() => A.delCustomer('c1'));
    assert.match(await app.modalText(), /Kunde und 1 zugehörige Aufträge endgültig löschen\?/);
    await app.act('confirmYes');
    assert.deepEqual(await app.ev(() => ({ c: S.customers.map(c => c.id), o: S.orders.map(o => o.id) })), { c: ['c2'], o: ['o2'] });
    await app.saved();
    const db = await app.db();
    assert.equal(db.some(x => x.id === 'c1' || x.id === 'o1'), false, 'auch online gelöscht');
    await app.close();
  });

  test('Abbrechen löscht nichts', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.ev(() => A.delOrder('o1'));
    await app.act('close');
    assert.equal(await app.ev(() => S.orders.length), 1);
    await app.close();
  });
});
