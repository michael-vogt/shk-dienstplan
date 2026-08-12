import { Component, computed, inject, linkedSignal } from '@angular/core';
import {
  AVAILABILITY_LABELS,
  Assistant,
  Availability,
  WEEKDAYS,
  WEEKDAY_SHORT,
  Weekday,
  formatDateLong,
  formatHour,
  weekdaySlotKey,
} from '../models/schedule.model';
import { ScheduleStore } from '../services/schedule-store.service';

@Component({
  selector: 'app-availability',
  templateUrl: './availability.component.html',
  styleUrl: './availability.component.css',
})
export class AvailabilityComponent {
  readonly store = inject(ScheduleStore);
  readonly formatDateLong = formatDateLong;

  /**
   * Schreibbar wie ein signal, folgt aber der Liste: verschwindet die gewählte
   * Hilfskraft, rückt automatisch die erste nach.
   */
  readonly selectedId = linkedSignal<Assistant[], string | null>({
    source: this.store.assistants,
    computation: (assistants, previous) => {
      const previousId = previous?.value;
      if (previousId && assistants.some((a) => a.id === previousId)) return previousId;
      return assistants[0]?.id ?? null;
    },
  });

  /** Nur Wochentage, an denen der Standard eine Öffnung vorsieht. */
  readonly openWeekdays = computed<Weekday[]>(() =>
    this.store
      .openingHours()
      .filter((o) => o.open)
      .map((o) => o.weekday),
  );

  /** Stundenzeilen aus der Spannweite des Wochentagsstandards. */
  readonly hourRows = computed<number[]>(() => {
    const open = this.store.openingHours().filter((o) => o.open);
    if (!open.length) return [];
    const start = Math.min(...open.map((o) => o.start));
    const end = Math.max(...open.map((o) => o.end));
    return Array.from({ length: end - start }, (_, i) => start + i);
  });

  /** Zahl der Zellen im Wochenraster, Bezugsgröße für den Beantwortungsstand. */
  readonly weekdaySlotCount = computed(() =>
    this.store
      .openingHours()
      .filter((o) => o.open)
      .reduce((sum, o) => sum + (o.end - o.start), 0),
  );

  readonly absencesOfSelected = computed(() => {
    const id = this.selectedId();
    // absences() lesen, damit das computed auf Änderungen reagiert.
    this.store.absences();
    return id ? this.store.absencesOf(id) : [];
  });

  short(weekday: Weekday): string {
    return WEEKDAY_SHORT[weekday];
  }

  time(hour: number): string {
    return formatHour(hour) + '–' + formatHour(hour + 1);
  }

  isOpen(weekday: Weekday, hour: number): boolean {
    const day = this.store.openingHours().find((o) => o.weekday === weekday);
    return !!day?.open && hour >= day.start && hour < day.end;
  }

  answer(weekday: Weekday, hour: number): Availability | undefined {
    const id = this.selectedId();
    if (!id) return undefined;
    return this.store.getAvailability(id, weekdaySlotKey(weekday, hour));
  }

  cellLabel(weekday: Weekday, hour: number): string {
    const value = this.answer(weekday, hour);
    if (value === 'yes') return 'Ja';
    if (value === 'ifNeeded') return 'Notfalls';
    if (value === 'no') return 'Nein';
    return '';
  }

  cellTitle(weekday: Weekday, hour: number): string {
    const value = this.answer(weekday, hour);
    const label = value ? AVAILABILITY_LABELS[value] : 'Noch nicht beantwortet';
    return WEEKDAY_SHORT[weekday] + ' ' + this.time(hour) + ': ' + label;
  }

  answeredCount(assistantId: string): number {
    let count = 0;
    for (const day of this.store.openingHours()) {
      if (!day.open) continue;
      for (let hour = day.start; hour < day.end; hour++) {
        if (this.store.getAvailability(assistantId, weekdaySlotKey(day.weekday, hour))) count++;
      }
    }
    return count;
  }

  cycle(weekday: Weekday, hour: number): void {
    const id = this.selectedId();
    if (id) this.store.cycleAvailability(id, weekdaySlotKey(weekday, hour));
  }

  setAll(value: Availability | undefined): void {
    const id = this.selectedId();
    if (!id) return;
    this.store.setAvailabilityForSlots(id, this.allKeys(), value);
  }

  setColumn(weekday: Weekday, value: Availability): void {
    const id = this.selectedId();
    if (!id) return;
    const day = this.store.openingHours().find((o) => o.weekday === weekday);
    if (!day?.open) return;
    const keys: string[] = [];
    for (let hour = day.start; hour < day.end; hour++) {
      keys.push(weekdaySlotKey(weekday, hour));
    }
    this.store.setAvailabilityForSlots(id, keys, value);
  }

  private allKeys(): string[] {
    const keys: string[] = [];
    for (const weekday of WEEKDAYS) {
      const day = this.store.openingHours().find((o) => o.weekday === weekday);
      if (!day?.open) continue;
      for (let hour = day.start; hour < day.end; hour++) {
        keys.push(weekdaySlotKey(weekday, hour));
      }
    }
    return keys;
  }

  add(input: HTMLInputElement): void {
    this.store.addAssistant(input.value);
    input.value = '';
    const created = this.store.assistants().at(-1);
    if (created) this.selectedId.set(created.id);
  }

  remove(id: string, name: string): void {
    if (confirm(name + ' entfernen? Verfügbarkeiten und Einteilungen gehen dabei verloren.')) {
      this.store.removeAssistant(id);
    }
  }

  addAbsence(from: HTMLInputElement, to: HTMLInputElement, reason: HTMLInputElement): void {
    const id = this.selectedId();
    if (!id || !from.value) return;
    // Ein einzelner Tag genügt: fehlt „bis", gilt der Starttag.
    this.store.addAbsence(id, from.value, to.value || from.value, reason.value);
    from.value = '';
    to.value = '';
    reason.value = '';
  }
}
