import { Service, inject } from '@angular/core';
import {
  AVAILABILITY_LABELS,
  Availability,
  PLAN_MODE_LABELS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  formatDateLong,
  formatHour,
} from '../models/schedule.model';
import { ScheduleStore } from './schedule-store.service';

@Service()
export class ExportService {
  private readonly store = inject(ScheduleStore);

  /** Vollständiger Zustand, wieder einlesbar über importJson(). */
  exportJson(): void {
    const state = this.store.state();
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    this.download(blob, this.fileName('json'));
  }

  async importJson(file: File): Promise<void> {
    const text = await file.text();
    this.store.replaceState(JSON.parse(text));
  }

  /**
   * Dienstplan als flache Liste. Im Ferienplan steht je Zeile ein konkreter
   * Termin, im Semesterplan eine Stelle der Musterwoche — beides lässt sich
   * in Excel filtern und sortieren.
   */
  exportRosterCsv(): void {
    const assistants = this.store.assistants();
    const breakMode = this.store.isBreakMode();
    const header = breakMode
      ? ['Woche', 'Datum', 'Wochentag', 'Von', 'Bis', 'Hilfskräfte', 'Anzahl']
      : ['Wochentag', 'Von', 'Bis', 'Hilfskräfte', 'Anzahl'];
    const rows: string[][] = [header];

    for (const plan of this.store.weekPlans()) {
      for (const slot of this.store.slotsOfWeek(plan.key)) {
        const names = this.store
          .assignedTo(slot.key)
          .map((id) => {
            const name = assistants.find((a) => a.id === id)?.name;
            if (!name) return null;
            return this.store.isOfficeWork(slot.key, id) ? `${name} (Büro)` : name;
          })
          .filter((name): name is string => !!name);
        const tail = [
          WEEKDAY_LABELS[slot.weekday],
          formatHour(slot.hour),
          formatHour(slot.hour + 1),
          names.join(', '),
          String(names.length),
        ];
        rows.push(
          breakMode ? [plan.label, slot.date ? formatDateLong(slot.date) : '', ...tail] : tail,
        );
      }
    }

    rows.push([]);
    rows.push([
      'Hilfskraft',
      breakMode ? 'Eingeteilte Stunden im Zeitraum' : 'Eingeteilte Stunden je Woche',
    ]);
    const hours = this.store.hoursByAssistant();
    for (const assistant of assistants) {
      rows.push([assistant.name, String(hours[assistant.id] ?? 0)]);
    }

    this.download(this.toCsvBlob(rows), this.fileName('csv', 'dienstplan'));
  }

  /**
   * Verfügbarkeiten als Matrix: eine Zeile je Hilfskraft und Wochenplan.
   * Im Semesterplan bleibt es bei einer Zeile pro Person.
   */
  exportAvailabilityCsv(): void {
    const breakMode = this.store.isBreakMode();
    const weekdays = this.store.openWeekdays();
    const hours = this.store.hourRows();

    const columns: { weekday: number; hour: number; label: string }[] = [];
    for (const weekday of weekdays) {
      for (const hour of hours) {
        columns.push({
          weekday,
          hour,
          label: `${WEEKDAY_SHORT[weekday]} ${formatHour(hour)}`,
        });
      }
    }

    const rows: string[][] = [
      breakMode
        ? ['Hilfskraft', 'Woche', ...columns.map((c) => c.label)]
        : ['Hilfskraft', ...columns.map((c) => c.label)],
    ];

    for (const assistant of this.store.assistants()) {
      for (const plan of this.store.weekPlans()) {
        const row = breakMode ? [assistant.name, plan.label] : [assistant.name];
        for (const column of columns) {
          const key = `${plan.key}|${column.weekday}-${column.hour}`;
          const answer = this.store.getAvailability(assistant.id, key);
          row.push(answer ? AVAILABILITY_LABELS[answer as Availability] : '');
        }
        rows.push(row);
      }
    }

    this.download(this.toCsvBlob(rows), this.fileName('csv', 'verfuegbarkeiten'));
  }

  /**
   * Semikolon als Trenner und ein BOM voran: so öffnet Excel die Datei in
   * deutscher Lokalisierung ohne Importdialog und mit korrekten Umlauten.
   */
  private toCsvBlob(rows: string[][]): Blob {
    const csv = rows.map((row) => row.map((cell) => this.escapeCsv(cell)).join(';')).join('\r\n');
    return new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  }

  private escapeCsv(value: string): string {
    if (/[";\r\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
    return value;
  }

  private fileName(extension: string, prefix = 'dienstplan-daten'): string {
    const date = new Date().toISOString().slice(0, 10);
    const mode = PLAN_MODE_LABELS[this.store.mode()] === 'Semester' ? 'semester' : 'ferien';
    return `${prefix}-${mode}-${date}.${extension}`;
  }

  private download(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }
}
