# BSS-Auftragsbuch

Auftrags- und Kundenverwaltung für den BSS-Besaitungsservice.

- Läuft als Webseite über GitHub Pages, auf Computer und Handy.
- Daten liegen in einer eigenen Supabase-Datenbank, Zugriff nur mit Login.
- Dieses Repository enthält nur den Programmcode und die Stammdaten-Vorlage (`seed.json`), keine Kundendaten.

## Tests

Die automatischen Tests laden die App in einem unsichtbaren Chromium-Browser und
klicken sich durch die Abläufe. Statt der echten Datenbank verwenden sie eine
simulierte (`tests/fake-supabase.js`), echte Kundendaten werden also nie gelesen
oder verändert.

| Datei | Was geprüft wird |
| --- | --- |
| `tests/berechnungen.test.mjs` | Preise, Material, Rabatte, Saitenpreise (auch Hybrid), Formate, WhatsApp-Links |
| `tests/auftraege.test.mjs` | Auftrag in vier Schritten, Status, Kunde informieren, Abrechnung, Quittung, Löschen |
| `tests/schnellauftrag.test.mjs` | Schnellauftrag unterwegs und Nacherfassen am Computer |
| `tests/stammdaten.test.mjs` | Schlägermodelle, Schläger der Kunden, Spezifikation, Tuning, Saiten, Material, Einstellungen, Sicherung |
| `tests/einkauf-kassabuch.test.mjs` | Materialeinkauf mit MWST-Berechnung und Kassabuch |
| `tests/tuning-reports.test.mjs` | Tuning-Report (Werte, WhatsApp, Drucken) sowie Reports und Umsatz |
| `tests/sync.test.mjs` | Anmeldung, Laden und Speichern, Verbindungsfehler, Änderungen von einem anderen Gerät |

Die Tests laufen bei jeder Änderung automatisch auf GitHub (Reiter «Actions»).

Lokal ausführen (Node.js 22 oder neuer):

```sh
npm install
npx playwright install chromium
npm test
```
