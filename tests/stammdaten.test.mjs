/*
 * Stammdaten (Schlägermodelle, Saiten, Material), Schläger der Kunden und Einstellungen.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, openApp, dbRows, customer, racket } from './helpers.mjs';

useBrowser();
const submit = (app, name) => app.page.click(`[data-submit="${name}"] button.primary`);

describe('Schlägermodelle', () => {
  test('neues Modell erfassen', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('go', 'saiten');
    await app.act('newModel');
    await app.page.fill('#md-brand', 'Yonex');
    await app.page.fill('#md-model', 'EZONE 98');
    await app.page.selectOption('#md-pattern', '16x19');
    await app.page.selectOption('#md-head', '98');
    await submit(app, 'saveModel');
    const m = await app.ev(() => S.models.find(m => m.model === 'EZONE 98'));
    assert.deepEqual({ brand: m.brand, pattern: m.pattern, head: m.head }, { brand: 'Yonex', pattern: '16x19', head: '98' });
    await app.close();
  });

  test('doppeltes Modell wird abgelehnt', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('go', 'saiten');
    await app.act('newModel');
    await app.page.fill('#md-brand', 'wilson');
    await app.page.fill('#md-model', 'BLADE 98 V9');
    await submit(app, 'saveModel');
    assert.match(await app.toast(), /Dieses Modell gibt es bereits/);
    assert.equal(await app.ev(() => S.models.length), 3);
    await app.close();
  });

  test('Korrektur am Modell gilt auch für die Schläger der Kunden', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()] }) });
    await app.act('go', 'saiten');
    await app.act('editModel', 'md2');
    await app.page.selectOption('#md-pattern', '16x19');
    await submit(app, 'saveModel');
    assert.equal(await app.ev(() => S.customers[0].rackets[0].pattern), '16x19');
    await app.close();
  });

  test('Modelle sind nach Marke gruppiert', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.ev(() => { ui.view = 'saiten'; render(); });
    assert.deepEqual(await app.ev(() => brands()), ['Babolat', 'Head', 'Wilson']);
    assert.deepEqual(await app.ev(() => modelsOf('Wilson').map(m => m.id)), ['md2']);
    await app.close();
  });
});

describe('Schläger eines Kunden', () => {
  test('neue Marke und neues Modell direkt beim Kunden erfassen', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer({ rackets: [] })] }) });
    await app.ev(() => A.openCustomer('c1'));
    await app.act('newRacket', 'c1');
    await app.page.selectOption('#r-brand', '__new');
    await app.page.fill('#r-newBrand', 'Pacific');
    await app.page.fill('#r-newModel', 'BXT X Fast');
    await app.page.selectOption('#r-newHead', '100');
    await app.page.fill('#p-main', 'Wilson NXT');
    await submit(app, 'saveRacket');
    const r = await app.ev(() => ({ rk: S.customers[0].rackets[0], m: S.models.find(m => m.brand === 'Pacific') }));
    assert.equal(r.rk.brand, 'Pacific');
    assert.equal(r.rk.model, 'BXT X Fast');
    assert.equal(r.rk.head, '100');
    assert.equal(r.rk.modelId, r.m.id, 'Modell ist in den Stammdaten');
    assert.equal(r.rk.pref.main, 'Wilson NXT');
    await app.close();
  });

  test('ohne Marke wird nicht gespeichert', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer({ rackets: [] })] }) });
    await app.ev(() => A.openCustomer('c1'));
    await app.act('newRacket', 'c1');
    await submit(app, 'saveRacket');
    assert.match(await app.toast(), /Bitte eine Marke wählen/);
    assert.equal(await app.ev(() => S.customers[0].rackets.length), 0);
    await app.close();
  });

  test('Gewicht, Balance, Schwunggewicht mit einer Kommastelle', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()] }) });
    await app.ev(() => A.openCustomer('c1'));
    await app.act('editRacket', 'c1|r1');
    await app.page.fill('#sp-weight', '304,55');
    await app.page.fill('#sp-balance', '321');
    await app.page.locator('#sp-balance').blur();
    assert.equal(await app.page.inputValue('#sp-weight'), '304.6');
    await app.page.fill('#sp-sw', '');
    await submit(app, 'saveRacket');
    const s = await app.ev(() => S.customers[0].rackets[0].specs);
    assert.equal(s.weight, '304.6');
    assert.equal(s.balance, '321.0');
    assert.equal(s.sw, '');
    await app.close();
  });

  test('Griffgrösse «Andere…» erlaubt einen eigenen Wert', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()] }) });
    await app.ev(() => A.openCustomer('c1'));
    await app.act('editRacket', 'c1|r1');
    await app.page.selectOption('#sp-grip', '__other');
    assert.equal(await app.page.isVisible('#sp-grip-x'), true);
    await app.page.fill('#sp-grip-x', 'L2+ (aufgebaut)');
    await submit(app, 'saveRacket');
    assert.equal(await app.ev(() => S.customers[0].rackets[0].specs.grip), 'L2+ (aufgebaut)');
    await app.close();
  });

  test('Tuning: standardmässig «Keine», bei «Ja» Zielwerte erfassen', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()] }) });
    await app.ev(() => A.openCustomer('c1'));
    await app.act('editRacket', 'c1|r1');
    assert.equal(await app.page.inputValue('#tu-wanted'), '');
    assert.equal(await app.page.isVisible('#tu-sw'), false);
    await app.page.selectOption('#tu-wanted', '1');
    await app.page.fill('#tu-sw', '298');
    await app.page.fill('#tu-notes', '4 g Blei bei 3 und 9 Uhr');
    await submit(app, 'saveRacket');
    const t = await app.ev(() => S.customers[0].rackets[0].tuning);
    assert.equal(t.wanted, true);
    assert.equal(t.sw, '298.0');
    assert.equal(t.notes, '4 g Blei bei 3 und 9 Uhr');
    assert.match(await app.mainText(), /Schwunggewicht 285\.0 kg·cm² → 298\.0 kg·cm²/);
    await app.close();
  });

  test('Tuning wieder auf «Keine» löscht die Zielwerte', async () => {
    const tuned = racket({ tuning: { wanted: true, weight: '', balance: '', sw: '298.0', grip: '', notes: 'x' } });
    const app = await openApp({ rows: dbRows({ customers: [customer({ rackets: [tuned] })] }) });
    await app.ev(() => A.openCustomer('c1'));
    await app.act('editRacket', 'c1|r1');
    await app.page.selectOption('#tu-wanted', '');
    await submit(app, 'saveRacket');
    const t = await app.ev(() => S.customers[0].rackets[0].tuning);
    assert.equal(t.wanted, false);
    assert.equal(t.sw, '');
    await app.close();
  });
});

describe('Saiten, Material und Einstellungen', () => {
  test('Saite in den Katalog aufnehmen', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('go', 'saiten');
    await app.act('newString');
    await app.page.fill('#st-name', 'Luxilon ALU Power');
    await app.page.fill('#st-price', '24,50');
    await submit(app, 'saveString');
    assert.equal(await app.ev(() => calcStringPrice('Luxilon ALU Power', '')), 24.5);
    await app.close();
  });

  test('Material erfassen', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('go', 'saiten');
    await app.act('newMaterial');
    await app.page.fill('#m-name', 'Racket-Tuning');
    await app.page.fill('#m-cat', 'Service');
    await app.page.fill('#m-price', '15');
    await submit(app, 'saveMaterial');
    const m = await app.ev(() => S.materials.find(m => m.name === 'Racket-Tuning'));
    assert.deepEqual({ cat: m.cat, price: m.price }, { cat: 'Service', price: 15 });
    await app.close();
  });

  test('Einstellungen: Absender und Arbeitspreis', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('go', 'einstellungen');
    await app.page.fill('#s-name', 'Bellafiore Sport Services');
    await app.page.fill('#s-labor', '28');
    await submit(app, 'saveSettings');
    assert.deepEqual(await app.ev(() => ({ n: S.settings.name, l: S.settings.labor })), { n: 'Bellafiore Sport Services', l: 28 });
    await app.act('go', 'auftraege');
    await app.act('newOrder');
    assert.equal(await app.ev(() => W.vals.o_labor), '28', 'neuer Auftrag übernimmt den Arbeitspreis');
    await app.saved();
    const meta = (await app.db()).find(x => x.col === 'meta');
    assert.equal(meta.data.settings.name, 'Bellafiore Sport Services');
    await app.close();
  });

  test('Sicherung einspielen ersetzt die Daten', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()] }) });
    await app.act('go', 'einstellungen');
    await app.act('restore');
    await app.page.fill('#rs', JSON.stringify({ customers: [{ id: 'x1', name: 'Aus Sicherung', rackets: [] }], orders: [] }));
    await submit(app, 'doRestore');
    assert.deepEqual(await app.ev(() => S.customers.map(c => c.name)), ['Aus Sicherung']);
    await app.close();
  });

  test('ungültige Sicherung wird abgelehnt', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()] }) });
    await app.act('go', 'einstellungen');
    await app.act('restore');
    await app.page.fill('#rs', 'kein JSON');
    await submit(app, 'doRestore');
    assert.match(await app.toast(), /keine gültige Sicherung/);
    assert.equal(await app.ev(() => S.customers.length), 1);
    await app.close();
  });
});
