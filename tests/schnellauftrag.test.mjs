/*
 * Schnellauftrag unterwegs und das spätere Nacherfassen am Computer.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, openApp, dbRows, customer, order, racket, TODAY } from './helpers.mjs';

useBrowser();
const PHONE = { width: 390, height: 844 };
const save = app => app.page.click('#qf button.primary');

describe('Schnellauftrag', () => {
  test('neuer Kunde mit Marke, Modell, Overgrip und Abholtermin', async () => {
    const app = await openApp({ rows: dbRows(), viewport: PHONE });
    await app.page.click('.fab'); // schwebender Knopf auf dem Handy
    await app.page.fill('#q-name', 'Giulia Rossi');
    await app.act('qNew');
    await app.page.fill('#q-phone', '078 111 22 33');
    await app.page.selectOption('#q-brand', 'Head');
    await app.page.selectOption('#q-model', 'md3');
    await app.page.fill('#q-main', 'Solinco Hyper-G');
    await app.page.fill('#q-tMain', '22');
    await app.act('qOG', '1');
    await app.page.selectOption('#q-og', 'm1');
    await app.act('qDue', '3');
    await save(app);

    const r = await app.ev(() => ({ c: S.customers[0], o: S.orders[0] }));
    assert.equal(r.c.name, 'Giulia Rossi');
    assert.equal(r.c.phone, '078 111 22 33');
    assert.equal(r.c.rackets.length, 1);
    const rk = r.c.rackets[0];
    assert.equal(rk.modelId, 'md3');
    assert.equal(rk.model, 'Speed MP');
    assert.equal(rk.incomplete, true, 'Schläger ist zum Vervollständigen markiert');
    assert.equal(r.o.quick, true);
    assert.equal(r.o.racketId, rk.id, 'Schläger ist mit dem Auftrag verknüpft');
    assert.equal(r.o.main, 'Solinco Hyper-G');
    assert.equal(r.o.tMain, '22');
    assert.equal(r.o.tCross, '22', 'Querhärte wie Längs');
    assert.equal(r.o.stringPrice, 20);
    assert.equal(r.o.labor, 25);
    assert.equal(r.o.receivedAt, TODAY);
    assert.equal(r.o.dueAt, '2026-11-10');
    assert.deepEqual(r.o.items, [{ materialId: 'm1', name: 'Wilson Pro Overgrip (3 Stk.)', price: 12, qty: 1 }]);
    assert.equal(await app.ev(() => total(S.orders[0])), 57);
    assert.match(await app.toast(), /Schnellauftrag #1 gespeichert/);
    await app.saved();
    assert.ok((await app.db()).some(x => x.col === 'orders' && x.data.quick), 'online gespeichert');
    await app.close();
  });

  test('bestehenden Kunden über den Namen finden: Vorlieben werden übernommen', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()] }), viewport: PHONE });
    await app.act('quickOrder');
    await app.page.fill('#q-name', 'sand');
    assert.match(await app.page.innerText('#q-sugg'), /Sandra Meier/);
    await app.act('qPick', 'c1');
    assert.equal(await app.page.getAttribute('[data-act="qRacket"][data-id="r1"]', 'aria-pressed'), 'true');
    assert.equal(await app.page.inputValue('#q-main'), 'Wilson NXT');
    assert.equal(await app.page.inputValue('#q-tMain'), '23');
    await save(app);
    const o = await app.ev(() => S.orders[0]);
    assert.equal(o.customerId, 'c1');
    assert.equal(o.racketId, 'r1');
    assert.equal(o.prestretch, '10%');
    assert.deepEqual(o.items, [], 'ohne Overgrip kein Material');
    assert.equal(await app.ev(() => S.customers.length), 1);
    await app.close();
  });

  test('Kunden über die Telefonnummer finden', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()] }) });
    await app.act('quickOrder');
    await app.page.fill('#q-name', '0762881054');
    assert.match(await app.page.innerText('#q-sugg'), /Sandra Meier/);
    await app.close();
  });

  test('unbekannte Marke: Notiz statt Schläger', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('quickOrder');
    await app.page.fill('#q-name', 'Tom');
    await app.act('qNew');
    await app.page.fill('#q-rnote', 'Yonex, blau');
    await app.page.fill('#q-main', 'Wilson NXT');
    await save(app);
    const r = await app.ev(() => ({ o: S.orders[0], n: S.customers[0].rackets.length }));
    assert.equal(r.o.racketId, '');
    assert.equal(r.o.racketNote, 'Yonex, blau');
    assert.equal(r.n, 0);
    await app.close();
  });

  test('neue Marke ohne Modellname', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('quickOrder');
    await app.page.fill('#q-name', 'Tom');
    await app.act('qNew');
    await app.page.selectOption('#q-brand', '__new');
    await app.page.fill('#q-newBrand', 'Pacific');
    await app.page.fill('#q-main', 'Wilson NXT');
    await save(app);
    const rk = await app.ev(() => S.customers[0].rackets[0]);
    assert.equal(rk.brand, 'Pacific');
    assert.equal(rk.model, '');
    assert.equal(rk.incomplete, true);
    await app.close();
  });

  test('Overgrip gewünscht, aber keines in den Stammdaten', async () => {
    const app = await openApp({ rows: dbRows({ materials: [] }) });
    await app.act('quickOrder');
    await app.page.fill('#q-name', 'Tom');
    await app.act('qNew');
    await app.page.fill('#q-main', 'Wilson NXT');
    await app.act('qOG', '1');
    await save(app);
    const o = await app.ev(() => S.orders[0]);
    assert.deepEqual(o.items, []);
    assert.match(o.notes, /Neues Overgrip gewünscht/);
    await app.close();
  });

  test('ohne Saite wird nicht gespeichert', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('quickOrder');
    await app.page.fill('#q-name', 'Tom');
    await app.act('qNew');
    await save(app);
    assert.match(await app.toast(), /Bitte die Saite angeben/);
    assert.equal(await app.ev(() => S.orders.length + S.customers.length), 0);
    await app.close();
  });

  test('Schläger mit gewünschtem Tuning wird zum Tuning-Auftrag', async () => {
    const tuned = racket({ tuning: { wanted: true, weight: '', balance: '', sw: '300.0', grip: '', notes: 'Blei bei 12 Uhr' } });
    const app = await openApp({ rows: dbRows({ customers: [customer({ rackets: [tuned] })] }) });
    await app.act('quickOrder');
    await app.page.fill('#q-name', 'Sandra');
    await app.act('qPick', 'c1');
    await save(app);
    const o = await app.ev(() => S.orders[0]);
    assert.ok(o.tuning, 'Vorher/Nachher-Werte sind beim Auftrag festgehalten');
    assert.equal(o.tuning.before.sw, '285.0');
    assert.equal(o.tuning.after.sw, '300.0');
    await app.close();
  });
});

describe('Nacherfassen am Computer', () => {
  const quickRows = () => dbRows({
    customers: [customer({ phone: '', email: '', rackets: [{ id: 'r9', modelId: '', brand: 'Head', model: '', pattern: '', head: '', specs: { measured: 'unbesaitet' }, tuning: { wanted: false }, pref: { main: '', cross: '', tMain: '', tCross: '', prestretch: '0%', knots: '4', notes: '' }, incomplete: true }] })],
    orders: [order({ quick: true, racketId: 'r9' }), order({ id: 'o2', no: 2, quick: true, racketId: '', racketNote: 'Wilson, rot' })],
  });

  test('Filter «Nacherfassen» zeigt die Schnellaufträge', async () => {
    const app = await openApp({ rows: quickRows() });
    await app.act('filter', 'quick');
    assert.equal(await app.page.locator('article.order').count(), 2);
    assert.match(await app.mainText(), /Wilson, rot/);
    await app.close();
  });

  test('Kundenansicht zeigt, was noch fehlt', async () => {
    const app = await openApp({ rows: quickRows() });
    await app.ev(() => A.openCustomer('c1'));
    assert.match(await app.mainText(), /Noch offen: Kontaktdaten, Schläger-Details\./);
    await app.close();
  });

  test('Schläger vervollständigen entfernt die Markierung', async () => {
    const app = await openApp({ rows: quickRows() });
    await app.ev(() => A.openCustomer('c1'));
    await app.act('editRacket', 'c1|r9');
    await app.page.selectOption('#r-modelId', 'md3');
    await app.page.fill('#sp-weight', '300');
    await app.page.click('[data-submit="saveRacket"] button.primary');
    const rk = await app.ev(() => S.customers[0].rackets[0]);
    assert.equal(rk.incomplete, false);
    assert.equal(rk.model, 'Speed MP');
    assert.equal(rk.pattern, '16x19');
    assert.equal(rk.specs.weight, '300.0');
    await app.close();
  });

  test('Schläger aus der Notiz erfassen und verknüpfen', async () => {
    const app = await openApp({ rows: quickRows() });
    await app.ev(() => A.openCustomer('c1'));
    await app.act('quickRacket', 'c1|o2');
    assert.match(await app.modalText(), /Notiz vom Schnellauftrag: Wilson, rot/);
    await app.page.selectOption('#r-brand', 'Wilson');
    await app.page.selectOption('#r-modelId', 'md2');
    await app.page.click('[data-submit="saveRacket"] button.primary');
    const r = await app.ev(() => ({ o: S.orders.find(o => o.id === 'o2'), rk: S.customers[0].rackets }));
    assert.equal(r.rk.length, 2);
    assert.equal(r.o.racketId, r.rk[1].id);
    assert.equal(r.o.racketNote, '');
    assert.equal(r.rk[1].pref.main, 'Wilson NXT', 'Besaitung aus dem Auftrag als Vorliebe übernommen');
    await app.close();
  });

  test('neuer Auftrag über den Assistenten vervollständigt den Schläger ebenfalls', async () => {
    const app = await openApp({ rows: quickRows() });
    await app.act('newOrder');
    await app.page.selectOption('#w-cid', 'c1');
    await app.page.click('#wiz button.primary');
    await app.page.selectOption('#r-modelId', 'md3');
    await app.page.click('#wiz button.primary');
    await app.page.fill('#o-main', 'Wilson NXT');
    await app.page.click('#wiz button.primary');
    await app.page.click('#wiz button.primary');
    const rk = await app.ev(() => S.customers[0].rackets.find(r => r.id === 'r9'));
    assert.equal(rk.model, 'Speed MP');
    assert.equal(rk.incomplete, false, 'Markierung «Unvollständig» ist weg');
    await app.close();
  });

  test('«Vollständig» entfernt den Auftrag aus «Nacherfassen»', async () => {
    const app = await openApp({ rows: quickRows() });
    await app.ev(() => A.openCustomer('c1'));
    await app.act('quickDone', 'o1');
    assert.equal(await app.ev(() => S.orders.find(o => o.id === 'o1').quick), false);
    await app.close();
  });
});
