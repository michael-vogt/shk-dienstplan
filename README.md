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

## Urlaub

Nur im Ferienplan verfügbar, weil nur dort Slots einem Kalendertag entsprechen — der Semesterplan
kennt keine Daten, gegen die sich ein Urlaubszeitraum prüfen ließe. In Schritt 2 lässt sich für
die gewählte Hilfskraft ein Datumsbereich als Urlaub eintragen (auch tagesweise, indem „bis"
leer bleibt).

Urlaub ist ein **echter Blocker**, keine bloße Warnung: eine Zuweisung an einem Urlaubstag lässt
sich über keinen der drei Wege — Klick, Blockmarkierung, Drag & Drop — herstellen. Betroffene
Zellen im Verfügbarkeitsraster sind gesperrt und lassen sich nicht anklicken; im Dienstplan wird
die Person in der Kandidatenliste ausgegraut angezeigt und ist nicht mehr ziehbar. Wird Urlaub
eingetragen, während die Person bereits für einen Termin im betroffenen Zeitraum eingeteilt ist,
wird diese Zuweisung automatisch entfernt.

Entsteht eine solche Kollision dennoch — etwa durch das Einlesen einer älteren, von Hand
bearbeiteten JSON-Datei —, meldet sie sich als Fehler in den Hinweisen, genau wie ein
„Nein“ oder eine fehlende Antwort.

## Bedienung des Dienstplans

- **Klick** wählt eine Stunde, **Umschalt-Klick** erweitert die Auswahl zu einem Block. Ein Block
  bleibt immer innerhalb einer Tagesspalte; ein Umschalt-Klick in einer anderen Spalte beginnt
  dort eine neue Auswahl. Ohne Maus geht dasselbe mit **Umschalt + Pfeil hoch/runter**.
- **Klick auf einen Namen** in der Seitenleiste besetzt den ganzen markierten Block. Ist er
  teilweise besetzt, wird aufgefüllt; ist er vollständig besetzt, wird die Person entfernt.
- **Ziehen** funktioniert aus der Seitenleiste ins Raster und von Stunde zu Stunde. Ziehen einer
  bereits eingeteilten Person **verschiebt** sie; mit gedrückter **Strg-Taste** wird kopiert.
- **Eine ganze Schicht verschieben**: Block markieren, dann einen Namen daraus an eine andere
  Stelle ziehen — die Schicht wird dort in gleicher Länge abgelegt. Der Griffpunkt bleibt
  erhalten: fasst man eine Schicht von 9 bis 13 Uhr bei 11 an und lässt bei 14 los, beginnt sie
  bei 12. Passt sie nicht mehr ans Tagesende, rutscht sie so weit nach vorn, dass sie
  hineinpasst, statt gekürzt zu werden. Andere Personen im Block bleiben, wo sie sind.
- Wird ein Name **von außerhalb** in den markierten Block gezogen, wird dieser ganz besetzt.
- Nach jedem Verschieben (nicht nach dem Zuweisen) erscheint eine Zeile mit **Rückgängig**. Sie
  betrifft nur diesen einen Schritt — es gibt keinen mehrstufigen Verlauf — und verschwindet,
  sobald eine andere Änderung vorgenommen oder die Woche gewechselt wird.

Mehrere Hilfskräfte pro Stunde sind ausdrücklich vorgesehen, auch mit versetzten Zeiten: eine
Person von 8 bis 11 Uhr und eine zweite von 9 bis 13 Uhr ergeben in den Überschneidungsstunden
schlicht zwei Einträge.

Drag & Drop nutzt die native Browser-Schnittstelle und steht auf Geräten mit Touch-Bedienung
nicht zur Verfügung; dort führen Klick und Umschalt-Klick zum selben Ergebnis.

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
