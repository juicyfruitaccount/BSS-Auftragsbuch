/*
 * Berechnungen und Formatierungen: Preise, Rabatte, Saitenpreise, Texte.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, openApp, dbRows, customer, order } from './helpers.mjs';

useBrowser();
let app;
before(async () => { app = await openApp({ rows: dbRows({ customers: [customer()], orders: [order()] }) }); });
after(async () => { await app.close(); });

describe('Preis eines Auftrags', () => {
  test('Arbeit + Saite ergibt das Total', async () => {
    const r = await app.ev(() => calc({ labor: 25, stringPrice: 22 }));
    assert.deepEqual(r, { items: 0, sub: 47, disc: 0, total: 47 });
  });

  test('Material wird mit Menge multipliziert', async () => {
    const r = await app.ev(() => calc({ labor: 25, stringPrice: 22, items: [{ price: 12, qty: 1 }, { price: 3, qty: 2 }] }));
    assert.equal(r.items, 18);
    assert.equal(r.total, 65);
  });

  test('Material ohne Mengenangabe zählt einmal', async () => {
    assert.equal(await app.ev(() => calc({ labor: 0, stringPrice: 0, items: [{ price: 4.5 }] }).total), 4.5);
  });

  test('Prozent-Rabatt wird auf 5 Rappen gerundet', async () => {
    const r = await app.ev(() => calc({ labor: 25, stringPrice: 22.3, discount: { type: 'pct', value: 10 } }));
    assert.equal(r.sub, 47.3);
    assert.equal(r.disc, 4.75); // 4.73 → 4.75
    assert.equal(r.total, 42.55);
  });

  test('Rabatt in CHF wird abgezogen', async () => {
    assert.equal(await app.ev(() => total({ labor: 25, stringPrice: 22, discount: { type: 'abs', value: 7 } })), 40);
  });

  test('CHF-Rabatt kann nicht höher sein als der Betrag', async () => {
    const r = await app.ev(() => calc({ labor: 25, stringPrice: 22, discount: { type: 'abs', value: 100 } }));
    assert.equal(r.disc, 47);
    assert.equal(r.total, 0);
  });

  test('Prozent-Rabatt über 100 % wird auf 100 % begrenzt', async () => {
    assert.equal(await app.ev(() => total({ labor: 25, stringPrice: 22, discount: { type: 'pct', value: 150 } })), 0);
  });

  test('Rabatt von 0 oder leer wird ignoriert', async () => {
    assert.equal(await app.ev(() => total({ labor: 25, stringPrice: 22, discount: { type: 'pct', value: '' } })), 47);
    assert.equal(await app.ev(() => discLabel({ type: 'pct', value: 0 })), '');
  });

  test('Rabatt-Bezeichnung auf der Quittung', async () => {
    assert.equal(await app.ev(() => discLabel({ type: 'pct', value: 15 })), 'Rabatt 15%');
    assert.equal(await app.ev(() => discLabel({ type: 'abs', value: 5 })), 'Rabatt');
  });

  test('Zahlen mit Komma werden verstanden', async () => {
    assert.equal(await app.ev(() => total({ labor: '25,50', stringPrice: '20' })), 45.5);
    assert.equal(await app.ev(() => num('abc')), 0);
  });
});

describe('Saitenpreis aus dem Katalog', () => {
  test('bekannte Saite liefert den Katalogpreis', async () => {
    assert.equal(await app.ev(() => calcStringPrice('Babolat RPM Blast', '')), 22);
  });

  test('Gross-/Kleinschreibung und Leerzeichen spielen keine Rolle', async () => {
    assert.equal(await app.ev(() => calcStringPrice('  babolat rpm blast ', '')), 22);
  });

  test('Hybrid: Mittelwert beider Saiten', async () => {
    assert.equal(await app.ev(() => calcStringPrice('Babolat RPM Blast', 'Wilson NXT')), 23);
  });

  test('Hybrid wird auf 5 Rappen gerundet', async () => {
    const r = await app.ev(() => { S.strings.push({ id: 'tmp', name: 'Test 21.15', price: 21.15 }); const v = calcStringPrice('Test 21.15', 'Solinco Hyper-G'); S.strings.pop(); return v; });
    assert.equal(r, 20.6); // (21.15 + 20) / 2 = 20.575 → 20.60
  });

  test('gleiche Saite längs und quer ist kein Hybrid', async () => {
    assert.equal(await app.ev(() => calcStringPrice('Wilson NXT', 'Wilson NXT')), 24);
  });

  test('unbekannte Quersaite: Preis der Längssaite', async () => {
    assert.equal(await app.ev(() => calcStringPrice('Wilson NXT', 'Unbekannte Saite')), 24);
  });

  test('unbekannte Längssaite: kein Preis', async () => {
    assert.equal(await app.ev(() => calcStringPrice('Gibt es nicht', '')), null);
  });
});

describe('Texte und Formate', () => {
  test('Betrag in Schweizer Franken', async () => {
    const t = await app.ev(() => money(1234.5));
    assert.match(t, /^CHF 1.234\.50$/); // Tausender-Trennzeichen je nach System ’ oder '
    assert.equal(await app.ev(() => money(undefined)), 'CHF 0.00');
  });

  test('Bespannhärte: gleich oder längs/quer', async () => {
    assert.equal(await app.ev(() => tensionTxt({ tMain: 23, tCross: 23 })), '23 kg');
    assert.equal(await app.ev(() => tensionTxt({ tMain: 24, tCross: 23 })), '24/23 kg');
    assert.equal(await app.ev(() => tensionTxt({ tMain: 24, tCross: '' })), '24 kg');
    assert.equal(await app.ev(() => tensionTxt({})), '');
  });

  test('Spezifikationswerte mit einer Kommastelle', async () => {
    assert.equal(await app.ev(() => fmt1('305')), '305.0');
    assert.equal(await app.ev(() => fmt1('304,55')), '304.6');
    assert.equal(await app.ev(() => fmt1('')), '');
    assert.equal(await app.ev(() => fmt1('xy')), '');
  });

  test('Datum im Schweizer Format', async () => {
    assert.equal(await app.ev(() => fmtD('2026-11-07')), '07.11.2026');
    assert.equal(await app.ev(() => fmtDs('2026-11-07')), 'Sa 07.11.');
    assert.equal(await app.ev(() => fmtD('')), '–');
  });

  test('Tage dazuzählen über Monats- und Jahresende', async () => {
    assert.equal(await app.ev(() => addDays('2026-11-29', 2)), '2026-12-01');
    assert.equal(await app.ev(() => addDays('2026-12-31', 1)), '2027-01-01');
    assert.equal(await app.ev(() => addDays('2026-03-28', 2)), '2026-03-30'); // Zeitumstellung
  });

  test('WhatsApp-Link mit Schweizer Nummer', async () => {
    const link = await app.ev(() => waLink('079 412 33 21', 'Hallo Marco'));
    assert.equal(link, 'https://wa.me/41794123321?text=Hallo%20Marco');
    assert.match(await app.ev(() => waLink('+41 79 412 33 21', 'x')), /wa\.me\/41794123321\?/);
    assert.match(await app.ev(() => waLink('0041 79 412 33 21', 'x')), /wa\.me\/41794123321\?/);
    assert.equal(await app.ev(() => waLink('', 'x')), '');
  });

  test('Vorname aus dem vollen Namen', async () => {
    assert.equal(await app.ev(() => firstName('  Sandra   Meier ')), 'Sandra');
    assert.equal(await app.ev(() => firstName('')), '');
  });

  test('HTML in Eingaben wird unschädlich gemacht', async () => {
    assert.equal(await app.ev(() => esc('<b>"Tom" & \'Jerry\'</b>')), '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
  });

  test('Vergleich der Daten unabhängig von der Reihenfolge der Felder', async () => {
    assert.equal(await app.ev(() => stable({ b: 1, a: { d: [1, { z: 2 }], c: 'x' } }) === stable({ a: { c: 'x', d: [1, { z: 2 }] }, b: 1 })), true);
    assert.equal(await app.ev(() => stable({ a: 1, b: undefined }) === stable({ a: 1 })), true);
  });
});

describe('Auftragsnummern und Quittungsdatum', () => {
  test('nächste Nummer folgt auf die höchste vorhandene', async () => {
    const r = await app.ev(() => { const saved = S.nextNo; S.nextNo = 1; const n = nextNo(); S.nextNo = saved; return n; });
    assert.equal(r, 2); // Auftrag Nr. 1 existiert
  });

  test('Quittungsdatum: erstellt > bezahlt > fertig > Eingang', async () => {
    assert.equal(await app.ev(() => receiptDate({ receiptAt: 'a', paidAt: 'b', doneAt: 'c', receivedAt: 'd' })), 'a');
    assert.equal(await app.ev(() => receiptDate({ paidAt: 'b', doneAt: 'c', receivedAt: 'd' })), 'b');
    assert.equal(await app.ev(() => receiptDate({ doneAt: 'c', receivedAt: 'd' })), 'c');
    assert.equal(await app.ev(() => receiptDate({ receivedAt: 'd' })), 'd');
  });
});
