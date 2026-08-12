import { Component, computed, inject, linkedSignal } from '@angular/core';
import {
  AVAILABILITY_LABELS,
  Assistant,
  Availability,
  IsoDate,
  SEMESTER_WEEK,
  ScheduleWarning,
  WEEKDAY_SHORT,
  WeekKey,
  WeekPlan,
  Weekday,
  formatDate,
  formatDateLong,
  formatHour,
  slotKey,
  startOfWeek,
  toIso,
} from '../models/schedule.model';
import { ScheduleStore } from '../services/schedule-store.service';

interface Candidate {
  assistant: Assistant;
  answer: Availability | undefined;
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

  /** Montag der laufenden Woche — nur im Ferienplan von Belang. */
  readonly currentMonday = startOfWeek(toIso(new Date()));

  /** Angezeigter Wochenplan; fällt zurück, wenn er aus dem Zeitraum fällt. */
  readonly selectedWeek = linkedSignal<WeekPlan[], WeekKey>({
    source: this.store.weekPlans,
    computation: (plans, previous) => {
      const previousKey = previous?.value;
      if (previousKey && plans.some((p) => p.key === previousKey)) return previousKey;
      // Beim ersten Öffnen die laufende Woche zeigen, sonst die erste.
      const running = plans.find((p) => p.key === this.currentMonday);
      return running?.key ?? plans[0]?.key ?? SEMESTER_WEEK;
    },
  });

  readonly currentPlan = computed<WeekPlan | null>(
    () => this.store.weekPlans().find((p) => p.key === this.selectedWeek()) ?? null,
  );

  readonly hasCurrentWeek = computed(() =>
    this.store.weekPlans().some((p) => p.key === this.currentMonday),
  );

  /** Ausgewählte Stunde; wird ungültig, sobald sie aus dem Raster fällt. */
  readonly selectedKey = linkedSignal<string[], string | null>({
    source: computed(() => this.store.slots().map((s) => s.key)),
    computation: (keys, previous) => {
      const previousKey = previous?.value;
      return previousKey && keys.includes(previousKey) ? previousKey : null;
    },
  });

  readonly selectedSlot = computed(
    () => this.store.slots().find((s) => s.key === this.selectedKey()) ?? null,
  );

  readonly selectedSlotLabel = computed(() => {
    const slot = this.selectedSlot();
    if (!slot) return null;
    const day = WEEKDAY_SHORT[slot.weekday];
    return slot.date
      ? `${day} ${formatDateLong(slot.date)}, ${this.time(slot.hour)}`
      : `${day}, ${this.time(slot.hour)}`;
  });

  /** Kandidaten nach Verfügbarkeit sortiert: Ja zuerst, Nein zuletzt. */
  readonly candidates = computed<Candidate[]>(() => {
    const slot = this.selectedSlot();
    if (!slot) return [];
    const rank: Record<string, number> = { yes: 0, ifNeeded: 1, undefined: 2, no: 3 };
    return this.store
      .assistants()
      .map((assistant) => ({
        assistant,
        answer: this.store.getAvailability(assistant.id, slot.key),
        assigned: this.store.isAssigned(slot.key, assistant.id),
      }))
      .sort((a, b) => (rank[String(a.answer)] ?? 2) - (rank[String(b.answer)] ?? 2));
  });

  readonly otherWeeks = computed<WeekPlan[]>(() =>
    this.store.weekPlans().filter((p) => p.key !== this.selectedWeek()),
  );

  /**
   * Hinweise des angezeigten Wochenplans. Über einen Ferienzeitraum wären es
   * sonst hunderte Zeilen, in denen die eine wichtige Meldung untergeht.
   */
  readonly weekWarnings = computed<ScheduleWarning[]>(() =>
    this.store.warnings().filter((w) => !w.week || w.week === this.selectedWeek()),
  );

  readonly otherWarningCount = computed(
    () => this.store.warnings().length - this.weekWarnings().length,
  );

  readonly errorCount = computed(
    () => this.weekWarnings().filter((w) => w.level === 'error').length,
  );

  readonly hoursThisWeek = computed(() => this.store.hoursByAssistantInWeek(this.selectedWeek()));

  short(weekday: Weekday): string {
    return WEEKDAY_SHORT[weekday];
  }

  time(hour: number): string {
    return formatHour(hour) + '–' + formatHour(hour + 1);
  }

  dateOf(week: WeekKey, weekday: Weekday): IsoDate | null {
    return this.store.dateOf(week, weekday);
  }

  isToday(date: IsoDate | null): boolean {
    return !!date && date === toIso(new Date());
  }

  key(weekday: Weekday, hour: number): string {
    return slotKey(this.selectedWeek(), weekday, hour);
  }

  isOpen(week: WeekKey, weekday: Weekday, hour: number): boolean {
    return this.store.isOpenIn(week, weekday, hour);
  }

  assignedFor(week: WeekKey, weekday: Weekday, hour: number): Assistant[] {
    const ids = this.store.assignedTo(slotKey(week, weekday, hour));
    const assistants = this.store.assistants();
    return ids
      .map((id) => assistants.find((a) => a.id === id))
      .filter((a): a is Assistant => !!a);
  }

  levelFor(weekday: Weekday, hour: number): string | null {
    const list = this.store.warningsBySlot().get(this.key(weekday, hour));
    if (!list?.length) return null;
    if (list.some((w) => w.level === 'error')) return 'error';
    return list[0]?.level ?? null;
  }

  answerLabel(candidate: Candidate): string {
    if (!candidate.answer) return 'keine Antwort';
    if (candidate.answer === 'ifNeeded') return 'notfalls';
    return AVAILABILITY_LABELS[candidate.answer].toLowerCase();
  }

  select(weekday: Weekday, hour: number): void {
    this.selectedKey.set(this.key(weekday, hour));
  }

  toggle(assistantId: string): void {
    const key = this.selectedKey();
    if (key) this.store.toggleAssignment(key, assistantId);
  }

  copyFrom(event: Event): void {
    const source = (event.target as HTMLSelectElement).value;
    (event.target as HTMLSelectElement).value = '';
    if (!source) return;
    const copied = this.store.copyWeek(source, this.selectedWeek());
    if (!copied) alert('In dieser Woche ist nichts eingeteilt.');
  }

  clearWeek(): void {
    if (confirm('Einteilung dieser Woche löschen?')) this.store.clearWeek(this.selectedWeek());
  }

  clearAll(): void {
    if (confirm('Alle Einteilungen dieses Dienstplans löschen?')) this.store.clearAssignments();
  }
}
