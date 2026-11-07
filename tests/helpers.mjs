/*
 * Gemeinsame Hilfsfunktionen für die Tests des BSS-Auftragsbuchs.
 *
 * Die App wird in einem echten (unsichtbaren) Chromium-Browser geladen.
 * Statt der echten Supabase-Datenbank kommt tests/fake-supabase.js zum Einsatz,
 * alle anderen Internet-Anfragen (Schriften, CDN) werden blockiert.
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://bss.test';
// Feste Uhrzeit, damit Datumsangaben in allen Tests gleich sind (Samstag)
export const NOW = '2026-11-07T10:00:00+01:00';
export const TODAY = '2026-11-07';

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.js': 'text/javascript' };

let browserP = null;
/** Ein Browser pro Testdatei, wird beim ersten Öffnen der App gestartet */
export function useBrowser() {
  after(async () => { if (browserP) { const b = await browserP; browserP = null; await b.close(); } });
}
const getBrowser = () => (browserP ||= chromium.launch());

/** Lädt die App. rows = Startinhalt der Datenbank, session=false zeigt die Anmeldung. */
export async function openApp({ rows = [], session = true, failWrites = 0, viewport = { width: 1200, height: 900 }, now = NOW } = {}) {
  const ctx = await (await getBrowser()).newContext({ viewport, locale: 'de-CH', timezoneId: 'Europe/Zurich' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e));
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(init => { window.__SB_INIT = init; }, { rows, session, failWrites });
  const fake = await readFile(path.join(ROOT, 'tests', 'fake-supabase.js'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN) {
      const file = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      try {
        const body = await readFile(path.join(ROOT, file));
        return route.fulfill({ status: 200, body, contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
      } catch { return route.fulfill({ status: 404, body: 'not found' }); }
    }
    if (url.href.includes('supabase-js')) return route.fulfill({ status: 200, body: fake, contentType: 'text/javascript' });
    return route.abort();
  });
  await page.goto(ORIGIN + '/');
  if (session) await page.waitForFunction(() => ready === true);
  const app = {
    page,
    errors,
    /** Code im Browser ausführen (Zugriff auf S, calc, A usw.) */
    ev: (fn, arg) => page.evaluate(fn, arg),
    /** Knopf mit data-act (und optional data-id) anklicken */
    act: (act, id) => page.click(id === undefined ? `[data-act="${act}"]` : `[data-act="${act}"][data-id="${id}"]`),
    /** Warten, bis alle Änderungen in der Datenbank gespeichert sind */
    saved: () => page.waitForFunction(() => {
      if (!ready || flushing) return false;
      const clean = COLS.every(col => (S[col] || []).every(x => synced[col + '/' + x.id] === stable(x)));
      const gone = Object.keys(synced).every(k => k.startsWith('meta/') || COLS.some(col => k.startsWith(col + '/') && (S[col] || []).some(x => col + '/' + x.id === k)));
      return clean && gone && synced['meta/app'] === stable(metaOf());
    }, null, { timeout: 15000 }),
    db: () => page.evaluate(() => window.__fakeSb.rows.map(r => ({ col: r.col, id: r.id, data: r.data }))),
    writes: () => page.evaluate(() => window.__fakeSb.writes()),
    toast: () => page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).pop() || ''),
    modalText: () => page.evaluate(() => document.querySelector('#modal').hidden ? '' : document.querySelector('#modal').innerText),
    mainText: () => page.evaluate(() => document.querySelector('#main').innerText),
    async close() {
      await ctx.close();
      assert.deepEqual(errors.map(e => String(e)), [], 'Die App hat einen JavaScript-Fehler ausgelöst');
    },
  };
  return app;
}

/* ---------- Testdaten ---------- */
export const STRINGS = [
  { id: 's1', name: 'Babolat RPM Blast', gauge: '1.25', type: 'Poly', price: 22 },
  { id: 's2', name: 'Wilson NXT', gauge: '1.30', type: 'Multifilament', price: 24 },
  { id: 's3', name: 'Solinco Hyper-G', gauge: '1.25', type: 'Poly', price: 20 },
];
export const MATERIALS = [
  { id: 'm1', name: 'Wilson Pro Overgrip (3 Stk.)', cat: 'Overgrip', price: 12 },
  { id: 'm2', name: 'Dämpfer Standard', cat: 'Dämpfer', price: 3 },
];
export const MODELS = [
  { id: 'md1', brand: 'Babolat', model: 'Pure Aero 98', pattern: '16x20', head: '98' },
  { id: 'md2', brand: 'Wilson', model: 'Blade 98 v9', pattern: '18x20', head: '98' },
  { id: 'md3', brand: 'Head', model: 'Speed MP', pattern: '16x19', head: '100' },
];
export const racket = (over = {}) => ({
  id: 'r1', modelId: 'md2', brand: 'Wilson', model: 'Blade 98 v9', pattern: '18x20', head: '98',
  specs: { measured: 'unbesaitet', weight: '305.0', balance: '320.0', sw: '285.0', grip: 'L2 (4 1/4)', ra: '62' },
  tuning: { wanted: false, weight: '', balance: '', sw: '', grip: '', notes: '' },
  pref: { main: 'Wilson NXT', cross: '', tMain: '23', tCross: '22', prestretch: '10%', knots: '4', notes: '' },
  ...over,
});
export const customer = (over = {}) => ({
  id: 'c1', name: 'Sandra Meier', phone: '076 288 10 54', email: 's.meier@example.ch', address: '', notes: '', rackets: [racket()], ...over,
});
export const order = (over = {}) => ({
  id: 'o1', no: 1, customerId: 'c1', racketId: 'r1', main: 'Wilson NXT', cross: '', tMain: '23', tCross: '22', prestretch: '10%', knots: '4',
  receivedAt: '2026-11-05', dueAt: '2026-11-07', status: 'angenommen', labor: 25, stringPrice: 24, paid: false, paidAt: '', notes: '',
  items: [], discount: null, ...over,
});
/** Datenbank-Zeilen aus einfachen Listen bauen */
export function dbRows({ customers = [], orders = [], strings = STRINGS, materials = MATERIALS, models = MODELS, settings = {}, nextNo } = {}) {
  const rows = [];
  const put = (col, list) => list.forEach(x => rows.push({ col, id: x.id, data: x }));
  put('customers', customers); put('orders', orders); put('strings', strings); put('materials', materials); put('models', models);
  rows.push({ col: 'meta', id: 'app', data: { settings: { name: 'BSS Test', address: 'Teststrasse 1\n5442 Fislisbach', labor: 25, msg: 'Hallo {vorname}, dein {schlaeger} ist fertig. Betrag: {betrag}', ...settings }, nextNo: nextNo ?? (orders.reduce((a, o) => Math.max(a, o.no), 0) + 1) } });
  return rows;
}
