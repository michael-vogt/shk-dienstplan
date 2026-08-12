import { Service, inject } from '@angular/core';
import {
  AVAILABILITY_LABELS,
  Availability,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  WEEKDAYS,
  formatDateLong,
  formatHour,
  weekdaySlotKey,
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
   * Dienstplan als Terminliste. Über einen mehrwöchigen Zeitraum ist eine
   * flache Liste in Excel besser filter- und sortierbar als ein Wochenraster.
   */
  exportRosterCsv(): void {
    const assistants = this.store.assistants();
    const rows: string[][] = [['Datum', 'Wochentag', 'Von', 'Bis', 'Hilfskräfte', 'Anzahl']];

    for (const slot of this.store.slots()) {
      const names = this.store
        .assignedTo(slot.key)
        .map((id) => assistants.find((a) => a.id === id)?.name)
        .filter((name): name is string => !!name);
      rows.push([
        formatDateLong(slot.date),
        WEEKDAY_LABELS[slot.weekday],
        formatHour(slot.hour),
        formatHour(slot.hour + 1),
        names.join(', '),
        String(names.length),
      ]);
    }

    rows.push([]);
    rows.push(['Hilfskraft', 'Eingeteilte Stunden']);
    const hours = this.store.hoursByAssistant();
    for (const assistant of assistants) {
      rows.push([assistant.name, String(hours[assistant.id] ?? 0)]);
    }

    this.download(this.toCsvBlob(rows), this.fileName('csv', 'shk-dienstplan'));
  }

  /** Verfügbarkeitsmatrix (wochentagsbasiert) samt Abwesenheiten. */
  exportAvailabilityCsv(): void {
    const hours = this.hourRange();
    const columns: { key: string; label: string }[] = [];
    for (const weekday of WEEKDAYS) {
      for (const hour of hours) {
        columns.push({
          key: weekdaySlotKey(weekday, hour),
          label: `${WEEKDAY_SHORT[weekday]} ${formatHour(hour)}`,
        });
      }
    }

    const rows: string[][] = [['Hilfskraft', ...columns.map((c) => c.label)]];
    for (const assistant of this.store.assistants()) {
      const row = [assistant.name];
      for (const column of columns) {
        const answer = this.store.getAvailability(assistant.id, column.key);
        row.push(answer ? AVAILABILITY_LABELS[answer as Availability] : '');
      }
      rows.push(row);
    }

    const absences = this.store.absences();
    if (absences.length) {
      rows.push([]);
      rows.push(['Abwesenheiten', 'Von', 'Bis', 'Grund']);
      for (const absence of absences) {
        const name = this.store.assistants().find((a) => a.id === absence.assistantId)?.name ?? '';
        rows.push([
          name,
          formatDateLong(absence.from),
          formatDateLong(absence.to),
          absence.reason ?? '',
        ]);
      }
    }

    this.download(this.toCsvBlob(rows), this.fileName('csv', 'verfuegbarkeiten'));
  }

  /** Spannweite aller Öffnungszeiten, damit die Matrix alle Stunden abdeckt. */
  private hourRange(): number[] {
    const open = this.store.openingHours().filter((o) => o.open);
    if (!open.length) return [];
    const start = Math.min(...open.map((o) => o.start));
    const end = Math.max(...open.map((o) => o.end));
    return Array.from({ length: end - start }, (_, i) => start + i);
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

  private fileName(extension: string, prefix = 'shk-dienstplan-daten'): string {
    const date = new Date().toISOString().slice(0, 10);
    return prefix + '-' + date + '.' + extension;
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
