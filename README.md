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
| Verfügungszeiten | einmal, wiederkehrend gültig | je Woche einzeln |
| Einteilung | einmal für die Musterwoche | je Woche einzeln |

Öffnungszeiten gelten in beiden Fällen je Wochentag und für alle Wochen gleich.

### Schlüssel

Ein Slot heißt `wochenschlüssel|wochentag-stunde`:

- `semester|1-9` — Montag 9–10 Uhr in der Musterwoche
- `2026-08-10|1-9` — Montag 9–10 Uhr in der Woche ab dem 10. August

Beide Modi teilen sich damit dieselbe Struktur für Verfügungszeiten und Einteilung; der
Semesterplan ist schlicht der Sonderfall mit einem einzigen Wochenplan. Das Übertragen zwischen
Wochen funktioniert deshalb über den zweiten Teil des Schlüssels, der die Stelle im Raster
bezeichnet.

## Tests

`npm test` führt die Suite über den Angular-Testbuilder mit Vitest aus. Abgedeckt sind die
Datumsrechnung (Sommerzeitwechsel, Jahreswechsel bei ISO-Kalenderwochen, Schalttage), der
Aufbau der Wochenpläne in beiden Modi, angebrochene Wochen am Rand des Zeitraums, das
Übertragen zwischen Wochen, der Moduswechsel und die Migration älterer Stände. Die Komponenten sind bewusst nicht getestet — sie enthalten
nur Darstellung, die Logik liegt vollständig im Store.

Im Ferienplan lässt sich außerdem die gerade angezeigte Woche mit einem Klick auf alle anderen
Wochenpläne übertragen (statt sie einzeln der Reihe nach auszuwählen). Das überschreibt dort
bestehende Antworten der gewählten Hilfskraft vollständig, deshalb erst nach einer ausdrücklichen
Bestätigung.

## Wochenübersicht in den Verfügungszeiten

Unterhalb der Bearbeitungsmatrix zeigt eine zweite, kompakte Tabelle je Slot die Zahl der
Hilfskräfte mit „Ja" oder „Wenn es sein muss" — unabhängig davon, welche Person links gerade
bearbeitet wird. Urlaub schlägt eine vorher eingetragene Antwort: wer an diesem Tag Urlaub hat,
zählt nicht mit. Die Färbung ist eine grobe Einstufung (0 rot, 1 gelb, ab 2 grün), gedacht als
schneller Blick darauf, welche Stunden dünn besetzt sind, bevor die Einteilung beginnt.

## Datenschutz

Die App sendet zu keinem Zeitpunkt Daten über das Netzwerk — im gesamten Quellcode gibt es keinen
`fetch`-, `XMLHttpRequest`- oder sonstigen HTTP-Aufruf zur Laufzeit. Alle Daten (Namen der
Hilfskräfte, Verfügungszeiten, Urlaub, Einteilung) bleiben ausschließlich lokal auf dem Gerät, auf
dem die App läuft. Das gilt unabhängig davon, ob `localStorage` oder eine verknüpfte Datei genutzt
wird: auch `localStorage` verlässt den Rechner nie, sondern liegt browserintern als Datei auf der
Festplatte.

Der Unterschied zwischen beiden ist keiner der Sicherheit, sondern der Nachvollziehbarkeit:
`localStorage` liegt an einem für den Nutzer nicht einsehbaren Ort im Browserprofil, eine
verknüpfte Datei liegt dort, wo man sie selbst ablegt — mit sichtbarem Pfad, gezielt lösch- und
sicherbar. Wer dokumentieren muss, wo personenbezogene Daten liegen, kann bei einer verknüpften
Datei auf einen konkreten Pfad verweisen statt auf eine Blackbox im Browser.

## Datenhaltung: Browser oder verknüpfte Datei

Im Normalfall liegt der Dienstplan in `localStorage` — an den Browser und das Gerät gebunden,
unsichtbar für den Nutzer. Wer mehr Kontrolle über den Ablageort will, kann die App stattdessen
mit einer echten lokalen Datei verknüpfen (Knopf „Mit Datei verknüpfen" oben in der Kopfzeile):
danach schreibt jede Änderung automatisch in diese Datei, zusätzlich weiterhin auch in
`localStorage` als Absicherung, falls die Dateiberechtigung einmal fehlt.

**Das funktioniert nur in Chrome, Edge und Opera.** Die dafür nötige File System Access API wird
von Firefox nicht unterstützt — Mozilla lehnt sie aus grundsätzlichen Erwägungen ab, das ist keine
Frage der Version — und Safari bietet nur ein für den Nutzer unsichtbares Sandbox-Dateisystem an,
keinen Zugriff auf echte Dateien. In diesen Browsern erscheint der Knopf gar nicht erst; es bleibt
bei `localStorage` und dem manuellen JSON-Export.

Die Verknüpfung selbst (welche Datei es ist) merkt sich die App in IndexedDB, nicht in
`localStorage` — ein Dateizugriffsobjekt lässt sich dort nicht ablegen. Nach einem Neustart der
App wird die Verknüpfung automatisch wiederhergestellt, sofern der Browser die Berechtigung dafür
noch gewährt; andernfalls erscheint wieder der Knopf zum erneuten Verbinden. Eine Datei, die auf
einem synchronisierten Laufwerk liegt (Netzlaufwerk, OneDrive, Cloud-Ordner), lässt sich auf diese
Weise wie eine gemeinsame Ablage nutzen — die App selbst synchronisiert dabei nichts, das
übernimmt vollständig der jeweilige Dienst im Hintergrund.

## Theke und Büro

Grundsätzlich arbeiten Hilfskräfte an der Ausleihtheke — das ist der Normalfall und wird nicht
extra gespeichert. Auf jeder eingeteilten Plakette im Dienstplan lässt sich der kleine Schalter
„Theke" / „Büro" anklicken, um genau diese eine Person für genau diese eine Stunde als
Hintergrundarbeit im Büro zu kennzeichnen. Die Markierung gilt ausschließlich für die einzelne
Zuweisung — bei mehreren Personen im selben Slot lässt sich frei mischen, wer an der Theke steht
und wer im Büro ist.

Die Markierung hängt an der konkreten Zuweisung, nicht an der Person: wird jemand aus einem Slot
entfernt (per Klick, Verschieben, Wochen leeren oder rückwirkend durch eingetragenen Urlaub), geht
die Büro-Markierung mit verloren. Eine erneute Zuweisung an derselben Stelle beginnt wieder als
Theke. CSV-Export und Ausdruck kennzeichnen Büro-Einteilungen mit dem Zusatz „(Büro)" hinter dem
Namen.

## Urlaub

Nur im Ferienplan verfügbar, weil nur dort Slots einem Kalendertag entsprechen — der Semesterplan
kennt keine Daten, gegen die sich ein Urlaubszeitraum prüfen ließe. In Schritt 2 lässt sich für
die gewählte Hilfskraft ein Datumsbereich als Urlaub eintragen (auch tagesweise, indem „bis"
leer bleibt).

Urlaub ist ein **echter Blocker**, keine bloße Warnung: eine Zuweisung an einem Urlaubstag lässt
sich über keinen der drei Wege — Klick, Blockmarkierung, Drag & Drop — herstellen. Betroffene
Zellen im Verfügungszeitenraster sind gesperrt und lassen sich nicht anklicken; im Dienstplan wird
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
- **Verfügungszeiten als CSV** — die Rohmatrix zur Kontrolle, samt Abwesenheiten.

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

- Verfügungszeitenabfrage als eigener Link für die Hilfskräfte, damit sie selbst eintragen — das
  braucht dann allerdings ein Backend
- Signal Forms (seit v22 stabil) für die Eingabefelder, sobald dort Validierung nötig wird —
  aktuell sind es einzelne Inputs, da lohnt der Umbau noch nicht
