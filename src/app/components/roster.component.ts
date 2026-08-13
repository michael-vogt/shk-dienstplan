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
  shiftBlockHours,
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
    this.lastMove.set(null);
    this.store.toggleAssignmentForSlots(this.selectedKeys(), assistantId);
  }

  /**
   * Letzte Blockverschiebung, um sie rückgängig machen zu können. Bewusst
   * nur ein einzelner gemerkter Schritt, kein allgemeiner Verlauf — jede
   * andere Änderung am Dienstplan verwirft ihn.
   */
  readonly lastMove = signal<{
    assistantId: string;
    from: string[];
    to: string[];
  } | null>(null);

  undoLastMove(): void {
    const move = this.lastMove();
    if (!move) return;
    this.store.moveAssignment(move.to, move.from, move.assistantId);
    this.lastMove.set(null);
  }

  /**
   * Zeigt den Rückgängig-Hinweis nur, solange die betroffene Woche noch
   * angezeigt wird — sonst würde die Person unsichtbar irgendwo verschoben.
   */
  readonly canUndoMove = computed(() => {
    const move = this.lastMove();
    if (!move) return false;
    const week = this.selectedWeek();
    return [...move.from, ...move.to].every((key) => key.startsWith(week + '|'));
  });

  // --- Ziehen und Ablegen ---------------------------------------------------

  /**
   * Läuft gerade ein Ziehvorgang? `fromKey` ist gesetzt, wenn die Hilfskraft
   * aus einer bereits belegten Stunde stammt — dann wird verschoben statt
   * hinzugefügt.
   */
  readonly dragged = signal<{
    assistantId: string;
    fromKey: string | null;
    /** Stunden der zu verschiebenden Schicht, aufsteigend. */
    sourceHours: number[];
    /** Wievielte Stunde der Schicht wurde angefasst? Hält den Griffpunkt. */
    grabOffset: number;
  } | null>(null);

  /** Stunde, über der der Zeiger gerade schwebt — nur für die Hervorhebung. */
  readonly dropTarget = signal<string | null>(null);

  /**
   * Beginnt einen Ziehvorgang. Gehört die angefasste Stunde zum markierten
   * Block und ist die Person dort eingeteilt, wandert die ganze Schicht mit;
   * der Griffpunkt sorgt dafür, dass sie beim Ablegen nicht verspringt.
   */
  startDrag(assistantId: string, fromKey: string | null, event: DragEvent): void {
    let sourceHours: number[] = [];
    let grabOffset = 0;

    if (fromKey) {
      const slot = this.store.slots().find((s) => s.key === fromKey);
      const block = this.selectedSlots();
      const inBlock =
        !!slot &&
        block.some((b) => b.key === fromKey) &&
        block.every((b) => this.store.isAssigned(b.key, assistantId));

      if (slot && inBlock) {
        sourceHours = block.map((b) => b.hour);
        grabOffset = Math.max(0, sourceHours.indexOf(slot.hour));
      } else if (slot) {
        sourceHours = [slot.hour];
      }
    }

    this.dragged.set({ assistantId, fromKey, sourceHours, grabOffset });
    if (event.dataTransfer) {
      // Immer 'copyMove': ist hier nur 'copy' erlaubt, verwirft der Browser
      // jeden Abwurf, bei dem dropEffect auf 'move' steht — der Name wandert
      // dann sichtbar mit, ohne dass 'drop' je ausgelöst wird.
      event.dataTransfer.effectAllowed = 'copyMove';
      // Manche Browser starten den Vorgang nur, wenn Daten gesetzt sind.
      event.dataTransfer.setData('text/plain', assistantId);
    }
  }

  endDrag(): void {
    this.dragged.set(null);
    this.dropTarget.set(null);
  }

  /**
   * `dragenter` und `dragover` müssen beide preventDefault() aufrufen: ohne
   * das erste erklärt sich das Element in Firefox nicht als Ziel, ohne das
   * zweite verwirft der Browser den Abwurf wieder. Fehlt eines davon, wandert
   * der Name sichtbar mit, `drop` feuert aber nie.
   */
  enterDrop(weekday: Weekday, hour: number, event: DragEvent): void {
    if (!this.dragged()) return;
    event.preventDefault();
    this.dropTarget.set(this.key(weekday, hour));
  }

  allowDrop(weekday: Weekday, hour: number, event: DragEvent): void {
    if (!this.dragged()) return;
    event.preventDefault();
    if (event.dataTransfer) {
      // Aus der Seitenleiste wird immer hinzugefügt, aus einer Stunde heraus
      // verschoben — sofern nicht die Kopiertaste gedrückt ist.
      const moving = !!this.dragged()?.fromKey && !this.isCopy(event);
      event.dataTransfer.dropEffect = moving ? 'move' : 'copy';
    }
    this.dropTarget.set(this.key(weekday, hour));
  }

  /**
   * Beim Wechsel auf ein Kindelement meldet der Browser ein `dragleave` der
   * Zelle. Deshalb wird nur zurückgesetzt, wenn der Zeiger die Zelle wirklich
   * verlässt — sonst flackert die Hervorhebung.
   */
  leaveDrop(weekday: Weekday, hour: number, event: DragEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as Node | null;
    if (target && next && target.contains(next)) return;
    if (this.dropTarget() === this.key(weekday, hour)) this.dropTarget.set(null);
  }

  /**
   * Ablegen auf einer Stunde. Drei Fälle, in dieser Reihenfolge:
   * eine gezogene Schicht behält ihre Länge, ein Abwurf im markierten Block
   * besetzt diesen ganz, sonst gilt die einzelne Stunde.
   */
  drop(weekday: Weekday, hour: number, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const drag = this.dragged();
    this.endDrag();
    if (!drag) return;

    const targets = this.dropTargets(drag, weekday, hour);
    if (!targets.length) return;

    if (drag.fromKey && !this.isCopy(event)) {
      const from = drag.sourceHours.length > 1 ? this.sourceKeys(drag) : [drag.fromKey];
      if (this.sameSlots(from, targets)) return;
      this.store.moveAssignment(from, targets, drag.assistantId);
      this.lastMove.set({ assistantId: drag.assistantId, from, to: targets });
      return;
    }
    this.lastMove.set(null);
    this.store.assignToSlots(targets, drag.assistantId);
  }

  private sameSlots(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const setB = new Set(b);
    return a.every((key) => setB.has(key));
  }

  /** Ursprüngliche Slots einer gezogenen Schicht. */
  private sourceKeys(drag: { fromKey: string | null; sourceHours: number[] }): string[] {
    const slot = this.store.slots().find((s) => s.key === drag.fromKey);
    if (!slot) return drag.fromKey ? [drag.fromKey] : [];
    return drag.sourceHours.map((h) => slotKey(slot.week, slot.weekday, h));
  }

  /**
   * Zielslots eines Abwurfs. Eine mehrstündige Schicht wird so weit nach vorn
   * geschoben, dass sie in den Tag passt, statt abgeschnitten zu werden —
   * eine Vierstundenschicht soll eine Vierstundenschicht bleiben.
   */
  private dropTargets(
    drag: { assistantId: string; sourceHours: number[]; grabOffset: number },
    weekday: Weekday,
    hour: number,
  ): string[] {
    const available = this.store
      .slotsOfWeek(this.selectedWeek())
      .filter((s) => s.weekday === weekday)
      .map((s) => s.hour)
      .sort((a, b) => a - b);
    if (!available.length) return [];

    const length = Math.max(1, drag.sourceHours.length);
    if (length === 1) {
      const targetKey = this.key(weekday, hour);
      // Einzelne Stunde: der markierte Block bleibt das bevorzugte Ziel.
      return this.selectedKeySet().has(targetKey) ? this.selectedKeys() : [targetKey];
    }

    return shiftBlockHours(available, length, drag.grabOffset, hour).map((h) =>
      this.key(weekday, h),
    );
  }

  /** Mit gedrückter Strg- oder Wahltaste wird kopiert statt verschoben. */
  private isCopy(event: DragEvent): boolean {
    return event.ctrlKey || event.metaKey || event.altKey;
  }

  /**
   * Hervorhebung beim Schweben. Sie zeigt genau die Slots, die der Abwurf
   * treffen würde — inklusive einer verschobenen Schicht am Tagesrand.
   */
  isDropTarget(weekday: Weekday, hour: number): boolean {
    const target = this.dropTarget();
    const drag = this.dragged();
    if (!target || !drag) return false;
    const slot = this.store.slots().find((s) => s.key === target);
    if (!slot) return false;
    return this.dropTargets(drag, slot.weekday, slot.hour).includes(this.key(weekday, hour));
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
    this.lastMove.set(null);
    const copied = this.store.copyWeek(source, this.selectedWeek());
    if (!copied) alert('In dieser Woche ist nichts eingeteilt.');
  }

  clearWeek(): void {
    if (confirm('Einteilung dieser Woche löschen?')) {
      this.lastMove.set(null);
      this.store.clearWeek(this.selectedWeek());
    }
  }

  clearAll(): void {
    if (confirm('Alle Einteilungen dieses Dienstplans löschen?')) {
      this.lastMove.set(null);
      this.store.clearAssignments();
    }
  }
}
