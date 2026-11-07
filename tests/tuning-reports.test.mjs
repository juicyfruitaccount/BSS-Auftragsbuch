/*
 * Tuning-Report sowie Quittungs-Reports und Umsatz.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, openApp, dbRows, customer, order, racket } from './helpers.mjs';

useBrowser();
const tunedRacket = () => racket({ tuning: { wanted: true, weight: '311.0', balance: '', sw: '298.0', grip: 'L3 (4 3/8)', notes: '6 g Blei bei 12 Uhr' } });
const tuningOrder = (over = {}) => order({
  status: 'fertig', doneAt: '2026-11-06',
  tuning: { before: { weight: '305.0', balance: '320.0', sw: '285.0', grip: 'L2 (4 1/4)' }, after: { weight: '311.0', balance: '', sw: '298.0', grip: 'L3 (4 3/8)' }, notes: '6 g Blei bei 12 Uhr', done: false },
  ...over,
});

describe('Tuning-Report', () => {
  test('Auftrag für einen Schläger mit Tuning hält Vorher- und Zielwerte fest', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer({ rackets: [tunedRacket()] })] }) });
    await app.act('newOrder');
    await app.page.selectOption('#w-cid', 'c1');
    for (let i = 0; i < 4; i++) await app.page.click('#wiz button.primary');
    const t = await app.ev(() => S.orders[0].tuning);
    assert.deepEqual(t.before, { weight: '305.0', balance: '320.0', sw: '285.0', grip: 'L2 (4 1/4)' });
    assert.deepEqual(t.after, { weight: '311.0', balance: '', sw: '298.0', grip: 'L3 (4 3/8)' });
    assert.equal(t.notes, '6 g Blei bei 12 Uhr');
    assert.equal(await app.page.isVisible(`[data-act="tuningReport"]`), true);
    await app.close();
  });

  test('Filter «Tuning» zeigt auch abgeholte Tuning-Aufträge', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [tuningOrder({ status: 'abgeholt' }), order({ id: 'o2', no: 2 })] }) });
    await app.act('filter', 'tuning');
    assert.equal(await app.page.locator('article.order').count(), 1);
    await app.close();
  });

  test('Auftrag ohne Tuning hat keinen Tuning-Report', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) });
    assert.equal(await app.page.isVisible('[data-act="tuningReport"]'), false);
    await app.close();
  });

  test('Report zeigt Kunde, Schläger, Auftrag und die Änderungen', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [tuningOrder()] }) });
    await app.act('tuningReport', 'o1');
    const text = await app.modalText();
    assert.match(text, /Tuning-Report/);
    assert.match(text, /BSS Test/);
    assert.match(text, /Auftrag #1/);
    assert.match(text, /06\.11\.2026/);
    assert.match(text, /Sandra Meier/);
    assert.match(text, /Wilson Blade 98 v9 · 18x20, 98 in²/);
    assert.match(text, /Gewicht\s+305\.0 g\s+311\.0 g\s+\+6\.0 g/);
    assert.match(text, /Schwunggewicht\s+285\.0 kg·cm²\s+298\.0 kg·cm²\s+\+13\.0 kg·cm²/);
    assert.match(text, /Griffgrösse\s+L2 \(4 1\/4\)\s+L3 \(4 3\/8\)/);
    assert.match(text, /6 g Blei bei 12 Uhr/);
    await app.close();
  });

  test('WhatsApp-Text mit Vorher → Nachher', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [tuningOrder()] }) });
    const t = await app.ev(() => tuningText(S.orders[0]));
    assert.equal(t, [
      '*Tuning-Report* – BSS Test',
      'Kunde: Sandra Meier',
      'Schläger: Wilson Blade 98 v9 · 18x20, 98 in²',
      'Auftrag #1 vom 06.11.2026',
      '',
      'Gewicht: 305.0 g → 311.0 g (+6.0 g)',
      'Balance: 320.0 mm → –',
      'Schwunggewicht: 285.0 kg·cm² → 298.0 kg·cm² (+13.0 kg·cm²)',
      'Griffgrösse: L2 (4 1/4) → L3 (4 3/8)',
      '',
      'Massnahmen: 6 g Blei bei 12 Uhr',
    ].join('\n'));
    await app.act('tuningReport', 'o1');
    const href = await app.page.getAttribute('#modal a[href^="https://wa.me/"]', 'href');
    assert.ok(href.startsWith('https://wa.me/41762881054?text='));
    assert.equal(decodeURIComponent(href.split('text=')[1]), t);
    await app.close();
  });

  test('gemessene Werte speichern und am Schläger übernehmen', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer({ rackets: [tunedRacket()] })], orders: [tuningOrder()] }) });
    await app.act('tuningReport', 'o1');
    await app.act('tuningEdit', 'o1');
    await app.page.fill('#tr-a-weight', '310,8');
    await app.page.fill('#tr-a-balance', '323');
    await app.page.fill('#tr-a-sw', '297.5');
    await app.page.click('[data-submit="saveTuning"] button.primary');
    const r = await app.ev(() => ({ o: S.orders[0].tuning, rk: S.customers[0].rackets[0] }));
    assert.deepEqual(r.o.after, { weight: '310.8', balance: '323.0', sw: '297.5', grip: 'L3 (4 3/8)' });
    assert.equal(r.o.done, true);
    assert.equal(r.rk.specs.weight, '310.8', 'Schläger hat jetzt die neuen Werte');
    assert.equal(r.rk.specs.grip, 'L3 (4 3/8)');
    assert.equal(r.rk.specs.ra, '62', 'andere Werte bleiben');
    assert.equal(r.rk.tuning.wanted, false, 'Tuning ist abgeschlossen');
    assert.match(await app.modalText(), /Gewicht\s+305\.0 g\s+310\.8 g\s+\+5\.8 g/);
    await app.close();
  });

  test('ohne Häkchen bleibt der Schläger unverändert', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer({ rackets: [tunedRacket()] })], orders: [tuningOrder()] }) });
    await app.act('tuningReport', 'o1');
    await app.act('tuningEdit', 'o1');
    await app.page.uncheck('#tr-apply');
    await app.page.click('[data-submit="saveTuning"] button.primary');
    const rk = await app.ev(() => S.customers[0].rackets[0]);
    assert.equal(rk.specs.weight, '305.0');
    assert.equal(rk.tuning.wanted, true);
    await app.close();
  });

  test('Drucken zeigt nur den Report', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [tuningOrder()] }) });
    await app.ev(() => { window.print = () => { window.__printed = { printing: document.body.classList.contains('printing'), text: document.querySelector('#print-root').innerText }; window.dispatchEvent(new Event('afterprint')); }; });
    await app.act('tuningReport', 'o1');
    await app.act('tuningPrint', 'o1');
    await app.page.waitForFunction(() => window.__printed);
    const p = await app.ev(() => window.__printed);
    assert.equal(p.printing, true);
    assert.match(p.text, /Tuning-Report[\s\S]*Sandra Meier/);
    assert.equal(await app.ev(() => document.body.classList.contains('printing')), false, 'nach dem Drucken wieder normale Ansicht');
    await app.close();
  });

  test('PDF ohne Internetverbindung: verständliche Meldung, kein Absturz', async () => {
    const app = await openApp({ rows: dbRows({ customers: [customer()], orders: [tuningOrder()] }) });
    await app.act('tuningReport', 'o1');
    await app.act('tuningPdf', 'o1');
    await app.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /PDF konnte nicht erstellt werden/.test(t.textContent)));
    assert.equal(await app.page.isDisabled('[data-act="tuningPdf"]'), false);
    await app.close();
  });
});

describe('Reports', () => {
  const rows = () => dbRows({
    customers: [customer(), customer({ id: 'c2', name: 'Marco Keller', rackets: [] })],
    orders: [
      order({ id: 'a', no: 1, receiptAt: '2026-10-15', paid: true, paidAt: '2026-10-15', status: 'abgeholt' }),
      order({ id: 'b', no: 2, customerId: 'c2', racketId: '', receiptAt: '2026-11-02', paid: true, paidAt: '2026-11-02', items: [{ name: 'Dämpfer Standard', price: 3, qty: 2 }], discount: { type: 'abs', value: 5 } }),
      order({ id: 'c', no: 3, receiptAt: '2026-11-05', paid: false }),
      order({ id: 'd', no: 4, receivedAt: '2026-11-06', paid: false }), // noch keine Quittung
    ],
  });

  test('Standard: dieser Monat, nur erstellte Quittungen', async () => {
    const app = await openApp({ rows: rows() });
    await app.act('go', 'reports');
    assert.deepEqual(await app.ev(() => [ui.rep.from, ui.rep.to]), ['2026-11-01', '2026-11-30']);
    assert.deepEqual(await app.ev(() => repRows().map(o => o.id)), ['b', 'c']);
    assert.equal(await app.page.locator('table.rep tbody tr').count(), 2);
    await app.close();
  });

  test('Zeitraum «Letzter Monat» und «Dieses Jahr»', async () => {
    const app = await openApp({ rows: rows() });
    await app.act('go', 'reports');
    await app.act('repPeriod', 'lastMonth');
    assert.deepEqual(await app.ev(() => [ui.rep.from, ui.rep.to, repRows().map(o => o.id)]), ['2026-10-01', '2026-10-31', ['a']]);
    await app.act('repPeriod', 'year');
    assert.deepEqual(await app.ev(() => repRows().map(o => o.id)), ['a', 'b', 'c']);
    await app.act('repPeriod', 'quarter');
    assert.deepEqual(await app.ev(() => [ui.rep.from, ui.rep.to]), ['2026-10-01', '2026-12-31']);
    await app.close();
  });

  test('auch Aufträge ohne Quittung einbeziehen', async () => {
    const app = await openApp({ rows: rows() });
    await app.act('go', 'reports');
    await app.page.uncheck('#rep-only');
    assert.deepEqual(await app.ev(() => repRows().map(o => o.id)), ['b', 'c', 'd']);
    await app.close();
  });

  test('nach Zahlung filtern', async () => {
    const app = await openApp({ rows: rows() });
    await app.act('go', 'reports');
    await app.act('repPay', 'offen');
    assert.deepEqual(await app.ev(() => repRows().map(o => o.id)), ['c']);
    await app.act('repPay', 'bezahlt');
    assert.deepEqual(await app.ev(() => repRows().map(o => o.id)), ['b']);
    await app.close();
  });

  test('Zeilen abwählen: fehlen in Summe und Export', async () => {
    const app = await openApp({ rows: rows() });
    await app.act('go', 'reports');
    await app.page.uncheck('#rr-c');
    const m = await app.ev(() => repMatrix());
    assert.equal(m.body.length, 1);
    const totalCol = m.head.indexOf('Total CHF');
    assert.equal(m.foot[totalCol], 50); // 25 + 24 + 6 − 5
    await app.close();
  });

  test('Spalten ein- und ausblenden', async () => {
    const app = await openApp({ rows: rows() });
    await app.act('go', 'reports');
    await app.act('repCol', 'racket');
    assert.ok(await app.ev(() => repCols().some(c => c.k === 'racket')));
    await app.act('repCol', 'racket');
    assert.ok(!(await app.ev(() => repCols().some(c => c.k === 'racket'))));
    await app.close();
  });

  test('Tabelle kopieren für Excel', async () => {
    const app = await openApp({ rows: rows() });
    await app.act('go', 'reports');
    await app.act('repCopy');
    const lines = (await app.page.inputValue('#tsv')).split('\n');
    assert.equal(lines[0], ['Datum', 'Quittung Nr.', 'Kunde', 'Saite', 'Arbeit CHF', 'Saite CHF', 'Material', 'Material CHF', 'Rabatt CHF', 'Total CHF', 'Zahlung'].join('\t'));
    assert.equal(lines[1], ['02.11.2026', '2', 'Marco Keller', 'Wilson NXT', '25.00', '24.00', '2× Dämpfer Standard', '6.00', '-5.00', '50.00', 'Bezahlt'].join('\t'));
    assert.equal(lines[3], ['Total', '', '', '', '50.00', '48.00', '', '6.00', '-5.00', '99.00', ''].join('\t'));
    await app.close();
  });

  test('Umsatz pro Jahr', async () => {
    const app = await openApp({ rows: rows() });
    await app.act('go', 'umsatz');
    const t = await app.mainText();
    const m = v => app.ev(x => money(x), v);
    assert.ok(t.includes('UMSATZ 2026') || t.includes('Umsatz 2026'));
    assert.ok(t.includes(await m(197)), 'Total aller Aufträge 2026'); // 49 + 50 + 49 + 49
    assert.ok(t.includes(await m(98)), 'offen'); // c und d
    await app.close();
  });
});
