import { Component, computed, inject, linkedSignal } from '@angular/core';
import {
  AVAILABILITY_LABELS,
  Assistant,
  Availability,
  IsoDate,
  Slot,
  WEEKDAY_SHORT,
  formatDate,
  formatDateLong,
  formatHour,
  slotKey,
  startOfWeek,
  weekdayOf,
} from '../models/schedule.model';
import { ScheduleStore, WeekGroup } from '../services/schedule-store.service';

interface Candidate {
  assistant: Assistant;
  answer: Availability | undefined;
  absent: boolean;
  assigned: boolean;
}

@Component({
  selector: 'app-roster',
  templateUrl: './roster.component.html',
  styleUrl: './roster.component.css',
})
export class RosterComponent {
  readonly store = inject(ScheduleStore);
  readonly formatDate = formatDate;
  readonly formatDateLong = formatDateLong;

  /** Angezeigte Woche; fällt auf die erste zurück, wenn der Zeitraum wechselt. */
  readonly selectedMonday = linkedSignal<WeekGroup[], IsoDate | null>({
    source: this.store.weeks,
    computation: (weeks, previous) => {
      const previousMonday = previous?.value;
      if (previousMonday && weeks.some((w) => w.monday === previousMonday)) return previousMonday;
      return weeks[0]?.monday ?? null;
    },
  });

  readonly currentWeek = computed<WeekGroup | null>(
    () => this.store.weeks().find((w) => w.monday === this.selectedMonday()) ?? null,
  );

  readonly weekDates = computed<IsoDate[]>(() => this.currentWeek()?.dates ?? []);

  readonly hourRows = computed<number[]>(() => this.store.hourRowsFor(this.weekDates()));

  /** Ausgewählte Stunde; wird ungültig, sobald sie aus dem Raster fällt. */
  readonly selectedKey = linkedSignal<Slot[], string | null>({
    source: this.store.slots,
    computation: (slots, previous) => {
      const previousKey = previous?.value;
      return previousKey && slots.some((s) => s.key === previousKey) ? previousKey : null;
    },
  });

  readonly selectedSlot = computed<Slot | null>(
    () => this.store.slots().find((s) => s.key === this.selectedKey()) ?? null,
  );

  readonly selectedSlotLabel = computed(() => {
    const slot = this.selectedSlot();
    if (!slot) return null;
    return (
      WEEKDAY_SHORT[slot.weekday] + ' ' + formatDateLong(slot.date) + ', ' + this.time(slot.hour)
    );
  });

  /** Kandidaten nach Verfügbarkeit sortiert: Ja zuerst, abwesend zuletzt. */
  readonly candidates = computed<Candidate[]>(() => {
    const slot = this.selectedSlot();
    if (!slot) return [];
    const rank: Record<string, number> = { yes: 0, ifNeeded: 1, undefined: 2, no: 3 };
    return this.store
      .assistants()
      .map((assistant) => ({
        assistant,
        answer: this.store.getAvailability(assistant.id, slot.weekdayKey),
        absent: this.store.isAbsent(assistant.id, slot.date),
        assigned: this.store.isAssigned(slot.key, assistant.id),
      }))
      .sort((a, b) => {
        if (a.absent !== b.absent) return a.absent ? 1 : -1;
        return (rank[String(a.answer)] ?? 2) - (rank[String(b.answer)] ?? 2);
      });
  });

  /** Andere Wochen als Quelle zum Kopieren. */
  readonly otherWeeks = computed<WeekGroup[]>(() =>
    this.store.weeks().filter((w) => w.monday !== this.selectedMonday()),
  );

  short(date: IsoDate): string {
    const weekday = weekdayOf(date);
    return weekday === null ? '' : WEEKDAY_SHORT[weekday];
  }

  time(hour: number): string {
    return formatHour(hour) + '–' + formatHour(hour + 1);
  }

  key(date: IsoDate, hour: number): string {
    return slotKey(date, hour);
  }

  isOpen(date: IsoDate, hour: number): boolean {
    return this.store.isOpenAt(date, hour);
  }

  assignedFor(date: IsoDate, hour: number): Assistant[] {
    const ids = this.store.assignedTo(slotKey(date, hour));
    const assistants = this.store.assistants();
    return ids.map((id) => assistants.find((a) => a.id === id)).filter((a): a is Assistant => !!a);
  }

  levelFor(date: IsoDate, hour: number): string | null {
    const list = this.store.warningsBySlot().get(slotKey(date, hour));
    if (!list?.length) return null;
    if (list.some((w) => w.level === 'error')) return 'error';
    return list[0]?.level ?? null;
  }

  answerLabel(candidate: Candidate): string {
    if (candidate.absent) return 'abwesend';
    if (!candidate.answer) return 'keine Antwort';
    if (candidate.answer === 'ifNeeded') return 'notfalls';
    return AVAILABILITY_LABELS[candidate.answer].toLowerCase();
  }

  answerClass(candidate: Candidate): string {
    if (candidate.absent) return 'a-absent';
    return 'a-' + (candidate.answer ?? 'unset');
  }

  select(date: IsoDate, hour: number): void {
    this.selectedKey.set(slotKey(date, hour));
  }

  toggle(assistantId: string): void {
    const key = this.selectedKey();
    if (key) this.store.toggleAssignment(key, assistantId);
  }

  copyFrom(event: Event): void {
    const source = (event.target as HTMLSelectElement).value;
    const target = this.selectedMonday();
    (event.target as HTMLSelectElement).value = '';
    if (!source || !target) return;
    const copied = this.store.copyWeek(source, target);
    if (!copied) {
      alert('Aus dieser Woche ließ sich nichts übertragen — dort ist nichts eingeteilt.');
    }
  }

  clearWeek(): void {
    const monday = this.selectedMonday();
    if (!monday) return;
    if (confirm('Einteilung dieser Woche löschen?')) this.store.clearWeek(monday);
  }

  clearAll(): void {
    if (confirm('Alle Einteilungen im gesamten Zeitraum löschen?')) this.store.clearAssignments();
  }

  weekOf(date: IsoDate): IsoDate {
    return startOfWeek(date);
  }
}
