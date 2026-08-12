# SHK-Dienstplan

Angular-App (v22) zum Erstellen von Dienstplänen für studentische Hilfskräfte in der Bibliothek.
Reines Frontend, kein Backend: der Zustand liegt im `localStorage` des Browsers.

Voraussetzungen: Node 22 oder neuer, TypeScript 6 (kommt über die devDependencies mit).
Die App läuft zoneless — Zone.js ist nicht installiert, das Rendering hängt vollständig
an den Signals im Store.

## Starten

```bash
npm install
npm start     # Entwicklungsserver
npm test      # Vitest, 61 Tests
```

## Aufbau

| Datei | Zweck |
| --- | --- |
| `src/app/models/schedule.model.ts` | Datenmodell, Wochentage, Zeitslots, Antwortwerte |
| `src/app/services/schedule-store.service.ts` | Signal-Store, Persistenz, berechnete Warnungen |
| `src/app/services/export.service.ts` | JSON-Sicherung sowie CSV-Export für Excel |
| `src/app/components/opening-hours.component.*` | Schritt 1 |
| `src/app/components/availability.component.*` | Schritt 2 |
| `src/app/components/roster.component.*` | Schritt 3 |

Jede Komponente besteht aus drei Dateien: `.ts` mit der Logik, `.html` mit dem Template und
`.css` mit den komponentenlokalen Styles. Anwendungsweite Styles stehen in `src/styles.css`.

## Plantypen

Die App stellt immer **genau einen** Dienstplan dar. Er ist entweder ein Semesterplan oder ein
Ferienplan; der Typ wird in Schritt 1 gewählt.

| | Semesterplan | Ferienplan |
| --- | --- | --- |
| Wochenpläne | genau einer | einer je Kalenderwoche |
| Datumsbezug | keiner | Zeitraum von–bis |
| Verfügbarkeiten | einmal, wiederkehrend gültig | je Woche einzeln |
| Einteilung | einmal für die Musterwoche | je Woche einzeln |

Öffnungszeiten gelten in beiden Fällen je Wochentag und für alle Wochen gleich.

### Schlüssel

Ein Slot heißt `wochenschlüssel|wochentag-stunde`:

- `semester|1-9` — Montag 9–10 Uhr in der Musterwoche
- `2026-08-10|1-9` — Montag 9–10 Uhr in der Woche ab dem 10. August

Beide Modi teilen sich damit dieselbe Struktur für Verfügbarkeiten und Einteilung; der
Semesterplan ist schlicht der Sonderfall mit einem einzigen Wochenplan. Das Übertragen zwischen
Wochen funktioniert deshalb über den zweiten Teil des Schlüssels, der die Stelle im Raster
bezeichnet.

## Tests

`npm test` führt die Suite über den Angular-Testbuilder mit Vitest aus. Abgedeckt sind die
Datumsrechnung (Sommerzeitwechsel, Jahreswechsel bei ISO-Kalenderwochen, Schalttage), der
Aufbau der Wochenpläne in beiden Modi, angebrochene Wochen am Rand des Zeitraums, das
Übertragen zwischen Wochen, der Moduswechsel und die Migration älterer Stände. Die Komponenten sind bewusst nicht getestet — sie enthalten
nur Darstellung, die Logik liegt vollständig im Store.

## Warnungen

Der Plan wird nie blockiert, nur kommentiert. Angezeigt werden die Hinweise der gerade
sichtbaren Woche; die Zahl der übrigen steht daneben.

- **Fehler** — jemand ist eingeteilt, obwohl „Nein" angegeben wurde oder keine Antwort vorliegt
- **Hinweis** — eine geöffnete Stunde ist unbesetzt
- **Info** — eine Stunde ist nur mit „Wenn es sein muss" abgedeckt

## Daten weitergeben

- **Daten sichern / laden** — vollständiges JSON, wieder einlesbar. Damit lässt sich der Stand
  zwischen Rechnern übertragen oder ein Semester archivieren.
- **Dienstplan als CSV** — Wochenraster plus Stundensumme je Hilfskraft.
- **Verfügbarkeiten als CSV** — die Rohmatrix zur Kontrolle, samt Abwesenheiten.

Für den Aushang genügt `Strg+P`: gedruckt werden alle Wochenpläne, je eine Querseite, ohne
Bedienelemente und Hinweise. Beim Semesterplan ist das genau eine Seite.

Die CSV-Dateien nutzen Semikolon und ein UTF-8-BOM, damit Excel sie ohne Importdialog und mit
korrekten Umlauten öffnet. Wird eine echte `.xlsx` gebraucht, lässt sich `toCsvBlob()` in
`export.service.ts` durch SheetJS ersetzen — der Rest der Methode bleibt gleich.

## Migration aus älteren Ständen

Ältere gespeicherte Stände werden beim Laden angehoben. Ein Stand mit wiederkehrender Woche wird
zum Semesterplan, ein Stand mit konkreten Terminen zum Ferienplan; die Schlüssel werden dabei auf
`wochenschlüssel|wochentag-stunde` umgestellt.

## Nächste sinnvolle Schritte

- Verfügbarkeitsabfrage als eigener Link für die Hilfskräfte, damit sie selbst eintragen — das
  braucht dann allerdings ein Backend
- Signal Forms (seit v22 stabil) für die Eingabefelder, sobald dort Validierung nötig wird —
  aktuell sind es einzelne Inputs, da lohnt der Umbau noch nicht
