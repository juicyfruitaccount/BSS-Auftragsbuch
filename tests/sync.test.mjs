/*
 * Anmeldung und Online-Speicherung: Laden, Speichern, Löschen,
 * Änderungen von einem anderen Gerät, Verbindungsfehler.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { useBrowser, openApp, dbRows, customer, order } from './helpers.mjs';

useBrowser();
const sleep = ms => new Promise(r => setTimeout(r, ms));

describe('Anmeldung', () => {
  test('ohne Anmeldung erscheint die Anmeldemaske', async () => {
    const app = await openApp({ session: false });
    await app.page.waitForSelector('form[data-submit="login"]');
    assert.equal(await app.page.innerText('#sync'), 'Nicht angemeldet');
    assert.equal(await app.page.isVisible('.fab'), false);
    await app.close();
  });

  test('falsches Passwort: verständliche Meldung', async () => {
    const app = await openApp({ session: false });
    await app.page.fill('#lg-email', 'giusi@example.ch');
    await app.page.fill('#lg-pw', 'falsch');
    await app.page.click('form[data-submit="login"] button');
    await app.page.waitForSelector('text=E-Mail oder Passwort stimmt nicht.');
    assert.equal(await app.ev(() => ready), false);
    await app.close();
  });

  test('richtiges Passwort lädt die Daten', async () => {
    const app = await openApp({ session: false, rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.page.fill('#lg-email', 'giusi@example.ch');
    await app.page.fill('#lg-pw', 'geheim');
    await app.page.click('form[data-submit="login"] button');
    await app.page.waitForFunction(() => ready === true);
    assert.equal(await app.page.innerText('#sync'), 'Synchronisiert');
    assert.equal(await app.page.locator('article.order').count(), 1);
    await app.close();
  });

  test('Abmelden leert die Ansicht', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.act('go', 'einstellungen');
    assert.match(await app.mainText(), /Angemeldet als giusi@example\.ch/);
    await app.act('logout');
    await app.act('confirmYes');
    await app.page.waitForSelector('form[data-submit="login"]');
    assert.equal(await app.ev(() => S.customers.length + S.orders.length), 0);
    assert.equal((await app.db()).length > 0, true, 'online bleiben die Daten erhalten');
    await app.close();
  });
});

describe('Laden und Speichern', () => {
  test('erster Start: Stammdaten aus seed.json werden angelegt', async () => {
    const seed = JSON.parse(await readFile(new URL('../seed.json', import.meta.url)));
    const app = await openApp({ rows: [] });
    await app.saved();
    const r = await app.ev(() => ({ s: S.strings.length, m: S.materials.length, md: S.models.length, c: S.customers.length }));
    assert.deepEqual(r, { s: seed.strings.length, m: seed.materials.length, md: seed.models.length, c: 0 });
    const db = await app.db();
    assert.equal(db.filter(x => x.col === 'strings').length, seed.strings.length);
    assert.equal(db.filter(x => x.col === 'models').length, seed.models.length);
    assert.ok(db.some(x => x.col === 'meta' && x.id === 'app'));
    await app.close();
  });

  test('vorhandene Daten werden geladen und nicht ständig neu gespeichert', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.saved();
    await sleep(1200);
    assert.deepEqual(await app.writes(), [], 'keine Schreibvorgänge ohne Änderung');
    await app.close();
  });

  test('eine Änderung speichert genau diesen Eintrag', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.saved();
    await app.act('markPaid', 'o1');
    await app.saved();
    const w = await app.writes();
    assert.deepEqual(w.map(x => [x.op, x.col, x.id]), [['upsert', 'orders', 'o1']]);
    assert.equal(w[0].data.paid, true);
    assert.equal(await app.page.innerText('#sync'), 'Synchronisiert');
    await app.close();
  });

  test('mehrere schnelle Änderungen werden zusammengefasst', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.saved();
    await app.act('advance', 'o1');
    await app.act('advance', 'o1');
    await app.act('close');
    await app.saved();
    const w = await app.writes();
    assert.equal(w.length, 1);
    assert.equal(w[0].data.status, 'fertig');
    await app.close();
  });

  test('Auftragsnummer läuft nach der online gespeicherten Nummer weiter', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], nextNo: 35 }) });
    await app.act('newOrder');
    await app.page.selectOption('#w-cid', 'c1');
    for (let i = 0; i < 4; i++) await app.page.click('#wiz button.primary');
    assert.equal(await app.ev(() => S.orders[0].no), 35);
    await app.saved();
    assert.equal((await app.db()).find(x => x.col === 'meta').data.nextNo, 36);
    await app.close();
  });

  test('vorübergehender Verbindungsfehler: wird erneut versucht', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }), failWrites: 2 });
    await app.saved();
    await app.act('markPaid', 'o1');
    await app.page.waitForFunction(() => window.__fakeSb.failWrites === 0);
    await app.saved();
    assert.equal((await app.db()).find(x => x.id === 'o1').data.paid, true);
    assert.equal(await app.page.innerText('#sync'), 'Synchronisiert');
    await app.close();
  });
});

describe('Änderungen von einem anderen Gerät', () => {
  test('neuer Auftrag vom Handy erscheint sofort', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()] }) });
    await app.saved();
    await app.ev(o => window.__fakeSb.emit('INSERT', 'orders', o.id, o), order({ id: 'h1', no: 7, quick: true }));
    await app.page.waitForSelector('[data-act="advance"][data-id="h1"]');
    assert.equal(await app.ev(() => S.orders.length), 1);
    await sleep(600);
    assert.deepEqual(await app.writes(), [], 'wird nicht zurückgeschrieben');
    await app.close();
  });

  test('Änderung vom anderen Gerät wird übernommen', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.saved();
    await app.ev(o => window.__fakeSb.emit('UPDATE', 'orders', 'o1', o), order({ status: 'in_arbeit' }));
    assert.equal(await app.ev(() => S.orders[0].status), 'in_arbeit');
    await app.close();
  });

  test('gelöschter Kunde verschwindet', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer(), customer({ id: 'c2', name: 'Zweiter', rackets: [] })] }) });
    await app.saved();
    await app.ev(() => window.__fakeSb.emit('DELETE', 'customers', 'c2'));
    assert.deepEqual(await app.ev(() => S.customers.map(c => c.id)), ['c1']);
    await app.close();
  });

  test('eigene, noch nicht gespeicherte Änderung wird nicht überschrieben', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    await app.saved();
    // lokale Änderung, die noch nicht gespeichert ist
    await app.ev(() => { clearTimeout(syncTimer); S.orders[0].notes = 'lokal'; });
    await app.ev(o => window.__fakeSb.emit('UPDATE', 'orders', 'o1', o), order({ notes: 'vom Handy' }));
    assert.equal(await app.ev(() => S.orders[0].notes), 'lokal');
    await app.ev(() => save());
    await app.saved();
    assert.equal((await app.db()).find(x => x.id === 'o1').data.notes, 'lokal');
    await app.close();
  });

  test('geänderte Einstellungen werden übernommen', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.saved();
    await app.ev(() => window.__fakeSb.emit('UPDATE', 'meta', 'app', { settings: { name: 'Neuer Name', address: '', labor: 30, msg: 'x' }, nextNo: 12 }));
    assert.deepEqual(await app.ev(() => ({ n: S.settings.name, l: S.settings.labor, no: S.nextNo })), { n: 'Neuer Name', l: 30, no: 12 });
    await app.close();
  });
});
