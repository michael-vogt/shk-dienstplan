import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import {
  AVAILABILITY_LABELS,
  Assistant,
  Availability,
  IsoDate,
  SEMESTER_WEEK,
  WEEKDAY_SHORT,
  WeekKey,
  WeekPlan,
  Weekday,
  formatDate,
  formatDateLong,
  formatHour,
  slotKey,
} from '../models/schedule.model';
import { ScheduleStore } from '../services/schedule-store.service';

@Component({
  selector: 'app-availability',
  templateUrl: './availability.component.html',
  styleUrl: './availability.component.css',
})
export class AvailabilityComponent {
  readonly store = inject(ScheduleStore);
  readonly formatDate = formatDate;
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

  /**
   * Angezeigter Wochenplan. Im Semestermodus gibt es nur einen, im Ferienmodus
   * beantwortet jede Hilfskraft jede Woche einzeln.
   */
  readonly selectedWeek = linkedSignal<WeekPlan[], WeekKey>({
    source: this.store.weekPlans,
    computation: (plans, previous) => {
      const previousKey = previous?.value;
      if (previousKey && plans.some((p) => p.key === previousKey)) return previousKey;
      return plans[0]?.key ?? SEMESTER_WEEK;
    },
  });

  readonly currentPlan = computed<WeekPlan | null>(
    () => this.store.weekPlans().find((p) => p.key === this.selectedWeek()) ?? null,
  );

  /** Wochenpläne, aus denen sich Angaben übernehmen lassen. */
  readonly otherWeeks = computed<WeekPlan[]>(() =>
    this.store.weekPlans().filter((p) => p.key !== this.selectedWeek()),
  );

  short(weekday: Weekday): string {
    return WEEKDAY_SHORT[weekday];
  }

  time(hour: number): string {
    return formatHour(hour) + '–' + formatHour(hour + 1);
  }

  /** Kalendertag der Spalte — nur im Ferienmodus vorhanden. */
  dateOf(weekday: Weekday): IsoDate | null {
    return this.store.dateOf(this.selectedWeek(), weekday);
  }

  isOpen(weekday: Weekday, hour: number): boolean {
    return this.store.isOpenIn(this.selectedWeek(), weekday, hour);
  }

  key(weekday: Weekday, hour: number): string {
    return slotKey(this.selectedWeek(), weekday, hour);
  }

  answer(weekday: Weekday, hour: number): Availability | undefined {
    const id = this.selectedId();
    if (!id) return undefined;
    return this.store.getAvailability(id, this.key(weekday, hour));
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
    return this.store.answeredCount(assistantId, this.selectedWeek());
  }

  cycle(weekday: Weekday, hour: number): void {
    const id = this.selectedId();
    if (id) this.store.cycleAvailability(id, this.key(weekday, hour));
  }

  setAll(value: Availability | undefined): void {
    const id = this.selectedId();
    if (!id) return;
    this.store.setAvailabilityForSlots(
      id,
      this.store.slotsOfWeek(this.selectedWeek()).map((s) => s.key),
      value,
    );
  }

  setColumn(weekday: Weekday, value: Availability): void {
    const id = this.selectedId();
    if (!id) return;
    this.store.setAvailabilityForSlots(
      id,
      this.store
        .slotsOfWeek(this.selectedWeek())
        .filter((s) => s.weekday === weekday)
        .map((s) => s.key),
      value,
    );
  }

  /** Übernimmt die Angaben einer anderen Woche für die gewählte Hilfskraft. */
  copyFrom(event: Event): void {
    const source = (event.target as HTMLSelectElement).value;
    (event.target as HTMLSelectElement).value = '';
    const id = this.selectedId();
    if (!source || !id) return;
    const copied = this.store.copyAvailability(id, source, this.selectedWeek());
    if (!copied) alert('In dieser Woche ist für die gewählte Hilfskraft nichts eingetragen.');
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
}
