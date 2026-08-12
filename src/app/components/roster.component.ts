import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
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

/** Zusammengefasste Antwort über einen Block. */
type BlockAnswer = Availability | 'mixed' | 'unset';

interface Candidate {
  assistant: Assistant;
  answer: BlockAnswer;
  coverage: 'none' | 'some' | 'all';
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

  /**
   * Markierter Block: Anker und Ende liegen immer in derselben Tagesspalte.
   * Ein einzelner Klick setzt beide gleich, Umschalt-Klick verschiebt nur das
   * Ende. Tagesübergreifende Blöcke sind bewusst nicht möglich.
   */
  private readonly anchor = signal<{ weekday: Weekday; hour: number } | null>(null);
  private readonly focus = signal<{ weekday: Weekday; hour: number } | null>(null);

  /** Slots des markierten Blocks, aufsteigend nach Stunde. */
  readonly selectedSlots = computed(() => {
    const anchor = this.anchor();
    const focus = this.focus();
    if (!anchor || !focus || anchor.weekday !== focus.weekday) return [];
    const week = this.selectedWeek();
    const from = Math.min(anchor.hour, focus.hour);
    const to = Math.max(anchor.hour, focus.hour);
    return this.store
      .slotsOfWeek(week)
      .filter((s) => s.weekday === anchor.weekday && s.hour >= from && s.hour <= to)
      .sort((a, b) => a.hour - b.hour);
  });

  readonly selectedKeys = computed(() => this.selectedSlots().map((s) => s.key));

  private readonly selectedKeySet = computed(() => new Set(this.selectedKeys()));

  readonly blockLength = computed(() => this.selectedSlots().length);

  readonly selectedSlot = computed(() => this.selectedSlots()[0] ?? null);

  readonly selectedSlotLabel = computed(() => {
    const slots = this.selectedSlots();
    const first = slots[0];
    const last = slots[slots.length - 1];
    if (!first || !last) return null;
    const day = WEEKDAY_SHORT[first.weekday];
    const range = formatHour(first.hour) + '–' + formatHour(last.hour + 1);
    const date = first.date ? ' ' + formatDateLong(first.date) : '';
    return `${day}${date}, ${range}`;
  });

  /**
   * Kandidaten für den markierten Block. Antwort und Belegung werden über
   * alle Stunden zusammengefasst, weil eine Person im Block unterschiedlich
   * geantwortet haben kann.
   */
  readonly candidates = computed<Candidate[]>(() => {
    const keys = this.selectedKeys();
    if (!keys.length) return [];
    const rank: Record<string, number> = { yes: 0, mixed: 1, ifNeeded: 1, unset: 2, no: 3 };
    return this.store
      .assistants()
      .map((assistant) => {
        const answers = keys.map((key) => this.store.getAvailability(assistant.id, key));
        return {
          assistant,
          answer: this.summarize(answers),
          coverage: this.store.assignmentCoverage(keys, assistant.id),
        } satisfies Candidate;
      })
      .sort((a, b) => (rank[a.answer] ?? 2) - (rank[b.answer] ?? 2));
  });

  /**
   * Fasst die Antworten eines Blocks zusammen. Ein einzelnes „Nein" schlägt
   * durch, weil der Block dann nicht durchgehend besetzbar ist.
   */
  private summarize(answers: (Availability | undefined)[]): BlockAnswer {
    if (answers.some((a) => a === 'no')) return 'no';
    if (answers.some((a) => a === undefined)) return 'unset';
    if (answers.every((a) => a === 'yes')) return 'yes';
    if (answers.every((a) => a === 'ifNeeded')) return 'ifNeeded';
    return 'mixed';
  }

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
    switch (candidate.answer) {
      case 'unset':
        return 'keine Antwort';
      case 'mixed':
        return 'teils';
      case 'ifNeeded':
        return 'notfalls';
      default:
        return AVAILABILITY_LABELS[candidate.answer].toLowerCase();
    }
  }

  coverageLabel(candidate: Candidate): string {
    if (candidate.coverage === 'all') return 'eingeteilt';
    if (candidate.coverage === 'some') return 'teilweise';
    return '';
  }

  /**
   * Klick wählt eine Stunde, Umschalt-Klick erweitert den Block. Liegt der
   * Umschalt-Klick in einer anderen Spalte, beginnt dort eine neue Auswahl —
   * ein Block über mehrere Tage wäre keine zusammenhängende Schicht.
   */
  select(weekday: Weekday, hour: number, event: MouseEvent): void {
    const anchor = this.anchor();
    if (event.shiftKey && anchor && anchor.weekday === weekday) {
      this.focus.set({ weekday, hour });
      return;
    }
    this.anchor.set({ weekday, hour });
    this.focus.set({ weekday, hour });
  }

  /** Tastaturbedienung: Umschalt plus Pfeiltaste verlängert den Block. */
  extend(direction: -1 | 1, event: Event): void {
    const focus = this.focus();
    if (!focus) return;
    event.preventDefault();
    const hours = this.store
      .slotsOfWeek(this.selectedWeek())
      .filter((s) => s.weekday === focus.weekday)
      .map((s) => s.hour);
    const next = focus.hour + direction;
    if (!hours.includes(next)) return;
    this.focus.set({ weekday: focus.weekday, hour: next });
  }

  isSelected(weekday: Weekday, hour: number): boolean {
    return this.selectedKeySet().has(this.key(weekday, hour));
  }

  /** Erste Stunde des Blocks — für die Rahmendarstellung. */
  isBlockStart(weekday: Weekday, hour: number): boolean {
    const first = this.selectedSlots()[0];
    return !!first && first.weekday === weekday && first.hour === hour;
  }

  isBlockEnd(weekday: Weekday, hour: number): boolean {
    const slots = this.selectedSlots();
    const last = slots[slots.length - 1];
    return !!last && last.weekday === weekday && last.hour === hour;
  }

  toggle(assistantId: string): void {
    this.store.toggleAssignmentForSlots(this.selectedKeys(), assistantId);
  }

  clearSelection(): void {
    this.anchor.set(null);
    this.focus.set(null);
  }

  answerClass(candidate: Candidate): string {
    return 'a-' + candidate.answer;
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
