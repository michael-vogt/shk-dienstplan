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
  startOfWeek,
  addDays,
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

  /** Urlaub sperrt nur im Ferienplan — dort hat die Spalte einen Kalendertag. */
  isVacation(weekday: Weekday): boolean {
    const id = this.selectedId();
    const date = this.dateOf(weekday);
    return !!id && !!date && this.store.isOnVacation(id, date);
  }

  cellLabel(weekday: Weekday, hour: number): string {
    if (this.isVacation(weekday)) return 'Urlaub';
    const value = this.answer(weekday, hour);
    if (value === 'yes') return 'Ja';
    if (value === 'ifNeeded') return 'Notfalls';
    if (value === 'no') return 'Nein';
    return '';
  }

  cellTitle(weekday: Weekday, hour: number): string {
    if (this.isVacation(weekday)) return WEEKDAY_SHORT[weekday] + ': Urlaub eingetragen';
    const value = this.answer(weekday, hour);
    const label = value ? AVAILABILITY_LABELS[value] : 'Noch nicht beantwortet';
    return WEEKDAY_SHORT[weekday] + ' ' + this.time(hour) + ': ' + label;
  }

  answeredCount(assistantId: string): number {
    return this.store.answeredCount(assistantId, this.selectedWeek());
  }

  // --- Wochenübersicht --------------------------------------------------
  // Aggregat über alle Hilfskräfte, unabhängig von der links ausgewählten
  // Person — zeigt auf einen Blick, wo die Deckung dünn ist.

  readonly totalAssistants = computed(() => this.store.assistants().length);

  overviewCount(weekday: Weekday, hour: number): number {
    return this.store.availableCount(this.key(weekday, hour), this.dateOf(weekday));
  }

  /**
   * Grobe Einstufung für die Färbung: 0 ist ein echtes Problem, 1 knapp
   * (keine Rückfalloption), ab 2 komfortabel. Bewusst ein fester Schwellwert
   * statt relativ zur Gesamtzahl der Hilfskräfte — für die Besetzung einer
   * einzelnen Stunde zählt die absolute Zahl, nicht der Anteil am Team.
   */
  overviewLevel(weekday: Weekday, hour: number): 'none' | 'low' | 'ok' {
    const count = this.overviewCount(weekday, hour);
    if (count === 0) return 'none';
    if (count === 1) return 'low';
    return 'ok';
  }

  cycle(weekday: Weekday, hour: number): void {
    const id = this.selectedId();
    // Während des Urlaubs lässt sich nichts eintragen — dort ist die Frage
    // nach der Verfügbarkeit gegenstandslos.
    if (id && !this.isVacation(weekday)) this.store.cycleAvailability(id, this.key(weekday, hour));
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

  /**
   * Überträgt die gerade angezeigte Woche auf alle anderen Wochenpläne.
   * Überschreibt dort bestehende Antworten, deshalb erst eine ausdrückliche
   * Bestätigung — anders als bei der Einzelwoche ist das nicht mit einem
   * Klick rückgängig zu machen.
   */
  copyToAllWeeks(): void {
    const id = this.selectedId();
    if (!id) return;
    const assistant = this.store.assistants().find((a) => a.id === id);
    const weekCount = this.otherWeeks().length;
    if (!weekCount) return;

    const ok = confirm(
      `Verfügungszeiten von ${assistant?.name ?? 'dieser Person'} aus der aktuell angezeigten ` +
      `Woche auf alle ${weekCount} anderen Wochen übertragen? Bestehende Antworten dort ` +
      `werden dabei überschrieben.`,
    );
    if (!ok) return;

    const result = this.store.copyAvailabilityToAllWeeks(id, this.selectedWeek());
    if (!result.slots) {
      alert('In der aktuell angezeigten Woche ist für diese Person nichts eingetragen.');
    }
  }

  add(input: HTMLInputElement): void {
    this.store.addAssistant(input.value);
    input.value = '';
    const created = this.store.assistants().at(-1);
    if (created) this.selectedId.set(created.id);
  }

  remove(id: string, name: string): void {
    if (confirm(name + ' entfernen? Verfügungszeiten und Einteilungen gehen dabei verloren.')) {
      this.store.removeAssistant(id);
    }
  }

  // --- Urlaub -----------------------------------------------------------
  // Nur im Ferienplan sinnvoll: der Semesterplan hat keine Kalendertage,
  // gegen die sich ein Datumsbereich prüfen ließe.

  /**
   * „Von"-Datum als Signal statt als reine Elementreferenz, damit ein Klick
   * auf eine Spaltenüberschrift es von außen setzen kann — die Urlaubsfelder
   * liegen in einem eigenen `@if`-Block und wären per Vorlagenreferenz vom
   * Tabellenkopf aus nicht erreichbar.
   */
  readonly vacationFrom = signal('');

  /** Klick auf eine Spaltenüberschrift übernimmt deren Datum als Urlaubsbeginn. */
  fillVacationFrom(weekday: Weekday): void {
    const date = this.dateOf(weekday);
    if (date) this.vacationFrom.set(date);
  }

  setVacationFrom(event: Event): void {
    this.vacationFrom.set((event.target as HTMLInputElement).value);
  }

  readonly vacationsOfSelected = computed(() => {
    const id = this.selectedId();
    this.store.vacations(); // Abhängigkeit, damit das computed reagiert.
    return id ? this.store.vacationsOf(id) : [];
  });

  /**
   * Bleibt „Bis" leer, gilt der Urlaub für die ganze angezeigte Woche —
   * also bis zu deren letztem Öffnungstag, nicht nur bis Kalenderfreitag.
   */
  addVacation(to: HTMLInputElement, note: HTMLInputElement): void {
    const id = this.selectedId();
    const from = this.vacationFrom();
    if (!id || !from) return;
    const toDate = to.value || this.weekEnd(from);
    this.store.addVacation(id, from, toDate, note.value);
    this.vacationFrom.set('');
    to.value = '';
    note.value = '';
  }

  /** Letzter Öffnungstag der Woche, in der das Datum liegt. */
  private weekEnd(date: IsoDate): IsoDate {
    const monday = startOfWeek(date);
    const plan = this.store.weekPlans().find((p) => p.key === monday);
    const last = plan?.dates.at(-1)?.date;
    return last ?? addDays(monday, 4);
  }
}
