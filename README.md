# SHK-Dienstplan

Angular-App (v22) zum Erstellen von Dienstplänen für studentische Hilfskräfte in der Bibliothek.
Reines Frontend, kein Backend: der Zustand liegt im `localStorage` des Browsers.

Voraussetzungen: Node 22 oder neuer, TypeScript 6 (kommt über die devDependencies mit).
Die App läuft zoneless — Zone.js ist nicht installiert, das Rendering hängt vollständig
an den Signals im Store.

## Starten

```bash
npm install
npm start
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

Ein Zeitslot ist über `weekday-hour` identifiziert, etwa `1-14` für Montag 14–15 Uhr.
Die Öffnungszeiten sind die einzige Quelle für das Raster: ändern sie sich, ändern sich
Verfügbarkeitsmatrix und Dienstplan automatisch mit.

## Warnungen

Der Plan wird nie blockiert, nur kommentiert:

- **Fehler** — jemand ist eingeteilt, obwohl „Nein" angegeben wurde oder keine Antwort vorliegt
- **Hinweis** — eine geöffnete Stunde ist unbesetzt
- **Info** — eine Stunde ist nur mit „Wenn es sein muss" abgedeckt

## Daten weitergeben

- **Daten sichern / laden** — vollständiges JSON, wieder einlesbar. Damit lässt sich der Stand
  zwischen Rechnern übertragen oder ein Semester archivieren.
- **Dienstplan als CSV** — Wochenraster plus Stundensumme je Hilfskraft.
- **Verfügbarkeiten als CSV** — die Rohmatrix zur Kontrolle.

Die CSV-Dateien nutzen Semikolon und ein UTF-8-BOM, damit Excel sie ohne Importdialog und mit
korrekten Umlauten öffnet. Wird eine echte `.xlsx` gebraucht, lässt sich `toCsvBlob()` in
`export.service.ts` durch SheetJS ersetzen — der Rest der Methode bleibt gleich.

## Nächste sinnvolle Schritte

- Konkreter Datumsbezug statt reinem Wochenraster, sobald Ferien oder Feiertage abgebildet werden
  sollen
- Verfügbarkeitsabfrage als eigener Link für die Hilfskräfte, damit sie selbst eintragen — das
  braucht dann allerdings ein Backend
- Signal Forms (seit v22 stabil) für die Eingabefelder, sobald dort Validierung nötig wird —
  aktuell sind es einzelne Inputs, da lohnt der Umbau noch nicht
