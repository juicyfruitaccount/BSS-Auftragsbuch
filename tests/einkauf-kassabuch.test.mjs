/*
 * Materialeinkauf mit MWST-Berechnung und Kassabuch.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, openApp, dbRows, customer, order, purchase } from './helpers.mjs';

useBrowser();
const submit = app => app.page.click('[data-submit="savePurchase"] button.primary');

describe('MWST aus dem Totalbetrag', () => {
  test('Normalsatz 8.1 %', async () => {
    const app = await openApp({ rows: dbRows() });
    assert.equal(await app.ev(() => vatOf(108.1, 8.1)), 8.1);
    assert.equal(await app.ev(() => vatOf(100, 8.1)), 7.49);
    assert.deepEqual(await app.ev(() => pCalc({ total: 162.15, rate: 8.1 })), { total: 162.15, vat: 12.15, net: 150 });
    await app.close();
  });

  test('reduzierter Satz und ohne MWST', async () => {
    const app = await openApp({ rows: dbRows() });
    assert.equal(await app.ev(() => vatOf(102.6, 2.6)), 2.6);
    assert.equal(await app.ev(() => vatOf(50, 0)), 0);
    assert.equal(await app.ev(() => vatOf('', 8.1)), 0);
    assert.equal(await app.ev(() => vatOf('54,05', 8.1)), 4.05);
    await app.close();
  });
});

describe('Einkauf erfassen', () => {
  test('Einkauf mit Totalbetrag: MWST und Netto werden angezeigt und gespeichert', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('go', 'einkauf');
    assert.match(await app.mainText(), /Noch keine Einkäufe erfasst/);
    await app.act('newPurchase');
    assert.equal(await app.page.inputValue('#pu-date'), '2026-11-07');
    assert.equal(await app.page.inputValue('#pu-rate'), '8.1', 'Normalsatz ist vorgewählt');
    await app.page.fill('#pu-supplier', 'Tennis-Point');
    await app.page.fill('#pu-text', 'Babolat RPM Blast 200 m');
    await app.page.fill('#pu-cat', 'Saiten');
    await app.page.fill('#pu-total', '162,15');
    const box = await app.page.innerText('#pu-vat');
    assert.match(box, /davon MWST 8\.1 %\s*CHF 12\.15/);
    assert.match(box, /Netto\s*CHF 150\.00/);
    await app.page.selectOption('#pu-rate', '2.6');
    assert.match(await app.page.innerText('#pu-vat'), /davon MWST 2\.6 %\s*CHF 4\.11/);
    await app.page.selectOption('#pu-rate', '8.1');
    await submit(app);

    const p = await app.ev(() => S.purchases[0]);
    assert.equal(p.no, 1);
    assert.equal(p.date, '2026-11-07');
    assert.equal(p.supplier, 'Tennis-Point');
    assert.equal(p.text, 'Babolat RPM Blast 200 m');
    assert.equal(p.total, 162.15);
    assert.equal(p.rate, 8.1);
    assert.match(await app.toast(), /Einkauf E-1 erfasst/);
    const t = await app.mainText();
    assert.match(t, /Babolat RPM Blast 200 m/);
    assert.ok(t.includes(await app.ev(() => money(162.15))), 'Ausgaben im Jahr');
    assert.ok(t.includes(await app.ev(() => money(12.15))), 'MWST im Jahr');
    await app.saved();
    assert.ok((await app.db()).some(x => x.col === 'purchases' && x.data.text === 'Babolat RPM Blast 200 m'), 'online gespeichert');
    await app.close();
  });

  test('«Speichern & weiterer Beleg» öffnet ein neues Formular', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('go', 'einkauf');
    await app.act('newPurchase');
    await app.page.fill('#pu-supplier', 'Sport Shop');
    await app.page.fill('#pu-text', 'Overgrips');
    await app.page.fill('#pu-total', '45');
    await app.page.selectOption('#pu-rate', '2.6');
    await app.page.click('[data-submit="savePurchase"] button[name="more"]');
    assert.match(await app.modalText(), /Einkauf erfassen/);
    assert.equal(await app.page.inputValue('#pu-supplier'), 'Sport Shop', 'Lieferant bleibt');
    assert.equal(await app.page.inputValue('#pu-text'), '');
    assert.equal(await app.page.inputValue('#pu-rate'), '2.6', 'MWST-Satz bleibt');
    await app.page.fill('#pu-text', 'Dämpfer');
    await app.page.fill('#pu-total', '12');
    await submit(app);
    assert.deepEqual(await app.ev(() => S.purchases.map(p => [p.no, p.text, p.supplier])), [[1, 'Overgrips', 'Sport Shop'], [2, 'Dämpfer', 'Sport Shop']]);
    await app.close();
  });

  test('ohne Beschreibung oder Betrag wird nicht gespeichert', async () => {
    const app = await openApp({ rows: dbRows() });
    await app.act('go', 'einkauf');
    await app.act('newPurchase');
    await app.page.fill('#pu-total', '20');
    await submit(app);
    assert.match(await app.toast(), /Bitte eine Beschreibung eingeben/);
    await app.page.fill('#pu-text', 'Werkzeug');
    await app.page.fill('#pu-total', '0');
    await submit(app);
    assert.match(await app.toast(), /Bitte den Totalbetrag eingeben/);
    assert.equal(await app.ev(() => S.purchases.length), 0);
    await app.close();
  });

  test('Einkauf bearbeiten behält die Belegnummer', async () => {
    const app = await openApp({ rows: dbRows({ purchases: [purchase()] }) });
    await app.act('go', 'einkauf');
    await app.act('editPurchase', 'p1');
    assert.match(await app.modalText(), /Einkauf E-1/);
    await app.page.fill('#pu-total', '108.10');
    await submit(app);
    const p = await app.ev(() => S.purchases[0]);
    assert.equal(p.no, 1);
    assert.equal(p.total, 108.1);
    assert.equal(await app.ev(() => pCalc(S.purchases[0]).vat), 8.1);
    await app.close();
  });

  test('Einkauf löschen', async () => {
    const app = await openApp({ rows: dbRows({ purchases: [purchase()] }) });
    await app.saved();
    await app.act('go', 'einkauf');
    await app.act('editPurchase', 'p1');
    await app.act('delPurchase', 'p1');
    assert.match(await app.modalText(), /Einkauf E-1 «Babolat RPM Blast 200 m» endgültig löschen\?/);
    await app.act('confirmYes');
    assert.equal(await app.ev(() => S.purchases.length), 0);
    await app.saved();
    assert.equal((await app.db()).some(x => x.col === 'purchases'), false);
    await app.close();
  });

  test('Suche und Jahreswechsel', async () => {
    const app = await openApp({ rows: dbRows({ purchases: [purchase(), purchase({ id: 'p2', no: 2, text: 'Maschinenservice', supplier: 'Wise', cat: 'Werkzeug / Maschine', total: 120 }), purchase({ id: 'p3', no: 3, date: '2025-12-20', text: 'Saitenrolle Vorjahr' })] }) });
    await app.act('go', 'einkauf');
    assert.equal(await app.page.locator('tr.prow').count(), 2);
    await app.page.fill('#pq', 'maschine');
    assert.equal(await app.page.locator('tr.prow').count(), 1);
    await app.page.fill('#pq', '');
    await app.page.selectOption('#pyear', '2025');
    assert.equal(await app.page.locator('tr.prow').count(), 1);
    assert.match(await app.mainText(), /Saitenrolle Vorjahr/);
    await app.close();
  });

  test('neuer Einkauf übernimmt den zuletzt verwendeten MWST-Satz', async () => {
    const app = await openApp({ rows: dbRows({ purchases: [purchase({ rate: 0 })] }) });
    await app.act('go', 'einkauf');
    await app.act('newPurchase');
    assert.equal(await app.page.inputValue('#pu-rate'), '0');
    await app.close();
  });
});

describe('Kassabuch', () => {
  const rows = () => dbRows({
    customers: [customer()],
    orders: [
      order({ id: 'a', no: 1, paid: true, paidAt: '2026-10-20', status: 'abgeholt' }),
      order({ id: 'b', no: 2, paid: true, paidAt: '2026-11-02', status: 'abgeholt' }),
      order({ id: 'c', no: 3, paid: true, paidAt: '2026-11-05', discount: { type: 'abs', value: 5 } }),
      order({ id: 'd', no: 4, paid: false }),
    ],
    purchases: [
      purchase({ id: 'p1', no: 1, date: '2026-11-03' }),
      purchase({ id: 'p2', no: 2, date: '2026-11-05', supplier: 'Post', text: 'Porto', cat: 'Porto / Versand', total: 30, rate: 0 }),
      purchase({ id: 'p3', no: 3, date: '2026-10-10', text: 'Oktober-Einkauf', total: 50 }),
    ],
  });
  const openKassabuch = async () => {
    const app = await openApp({ rows: rows() });
    await app.act('go', 'reports');
    await app.act('repKind', 'kassabuch');
    return app;
  };

  test('Einnahmen und Ausgaben des Monats in zeitlicher Reihenfolge', async () => {
    const app = await openKassabuch();
    assert.deepEqual(await app.ev(() => kbRows().map(x => [x.date, x.ref, x.in, x.out])), [
      ['2026-11-02', 'Q-2', 49, 0],
      ['2026-11-03', 'E-1', 0, 162.15],
      ['2026-11-05', 'Q-3', 44, 0],
      ['2026-11-05', 'E-2', 0, 30],
    ]);
    await app.close();
  });

  test('unbezahlte Aufträge fehlen, mit Hinweis', async () => {
    const app = await openKassabuch();
    assert.ok(!(await app.ev(() => kbRows().some(x => x.ref === 'Q-4'))));
    assert.match(await app.mainText(), /Noch nicht bezahlte Aufträge \(1, CHF 49\.00\) sind nicht enthalten/);
    await app.close();
  });

  test('Summen, Ergebnis und Saldo mit Anfangsbestand', async () => {
    const app = await openKassabuch();
    await app.page.fill('#kb-start', '100');
    await app.page.locator('#kb-start').blur();
    const s = await app.ev(() => kbSums(kbRows()));
    assert.deepEqual(s, { start: 100, in: 93, out: 192.15, vat: 12.15, result: -99.15, end: 0.85 });
    const t = await app.mainText();
    assert.match(t, /Anfangsbestand\s+100\.00/);
    assert.match(t, /Total CHF\s+93\.00\s+192\.15\s+12\.15\s+0\.85/);
    await app.close();
  });

  test('Tabelle kopieren: Buchungen, Totale und Zusammenfassung', async () => {
    const app = await openKassabuch();
    await app.page.fill('#kb-start', '100');
    await app.page.locator('#kb-start').blur();
    await app.act('repCopy');
    const lines = (await app.page.inputValue('#tsv')).split('\n').map(l => l.split('\t'));
    assert.deepEqual(lines[0], ['Datum', 'Beleg', 'Text', 'Kategorie', 'Einnahmen CHF', 'Ausgaben CHF', 'MWST-Satz', 'MWST CHF', 'Saldo CHF']);
    assert.deepEqual(lines[1], ['01.11.2026', '', 'Anfangsbestand', '', '', '', '', '', '100.00']);
    assert.deepEqual(lines[2], ['02.11.2026', 'Q-2', 'Quittung Nr. 2 · Sandra Meier', 'Einnahmen Besaitung', '49.00', '', '', '', '149.00']);
    assert.deepEqual(lines[3], ['03.11.2026', 'E-1', 'Tennis-Point · Babolat RPM Blast 200 m', 'Saiten', '', '162.15', '8.1 %', '12.15', '-13.15']);
    assert.deepEqual(lines[5], ['05.11.2026', 'E-2', 'Post · Porto', 'Porto / Versand', '', '30.00', '0 %', '', '0.85']);
    assert.deepEqual(lines[6], ['Total', '', '', '', '93.00', '192.15', '', '12.15', '0.85']);
    const rest = lines.slice(8).map(l => l.join('\t'));
    assert.deepEqual(rest, [
      'Anfangsbestand\t100.00',
      'Total Einnahmen\t93.00',
      'Total Ausgaben\t192.15',
      'Ergebnis (Einnahmen − Ausgaben)\t-99.15',
      'Endbestand\t0.85',
      'Bezahlte MWST in den Ausgaben (Vorsteuer)\t12.15',
    ]);
    await app.close();
  });

  test('anderer Zeitraum: letzter Monat', async () => {
    const app = await openKassabuch();
    await app.act('repPeriod', 'lastMonth');
    assert.deepEqual(await app.ev(() => kbRows().map(x => x.ref)), ['E-3', 'Q-1']);
    await app.close();
  });

  test('Umschalten zurück zu den Quittungen', async () => {
    const app = await openKassabuch();
    assert.equal(await app.page.isVisible('#rep-only'), false);
    await app.act('repKind', 'quittungen');
    assert.equal(await app.page.isVisible('#rep-only'), true);
    assert.equal(await app.ev(() => reportData().title), 'Report Quittungen');
    await app.close();
  });

  test('Excel und PDF ohne Internetverbindung: verständliche Meldung', async () => {
    const app = await openKassabuch();
    await app.act('repXlsx');
    await app.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Excel-Datei konnte nicht erstellt werden/.test(t.textContent)));
    await app.act('repPdf');
    await app.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /PDF konnte nicht erstellt werden/.test(t.textContent)));
    await app.close();
  });
});
