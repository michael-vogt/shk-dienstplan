import { Service, computed, effect, inject, signal } from '@angular/core';
import {
  AVAILABILITY_ORDER,
  Availability,
  IsoDate,
  OpeningHours,
  PlanMode,
  SEMESTER_WEEK,
  ScheduleState,
  Vacation,
  ScheduleWarning,
  Slot,
  WEEKDAYS,
  WEEKDAY_SHORT,
  WeekKey,
  WeekPlan,
  Weekday,
  addDays,
  formatDate,
  formatHour,
  isValidIso,
  isoWeekNumber,
  isWithin,
  slotKey,
  startOfWeek,
  toIso,
  weekdayOf,
  weekdaySlotKey,
} from '../models/schedule.model';
import { FileLinkService } from './file-link.service';

const STORAGE_KEY = 'shk-dienstplan.v1';

const PALETTE = [
  '#2d5d8f',
  '#1f7a54',
  '#a8523c',
  '#6b4f9e',
  '#0f7b8a',
  '#94651a',
  '#a63d63',
  '#3f6b2b',
];

/**
 * crypto.randomUUID() gibt es nur im sicheren Kontext (HTTPS oder localhost).
 * Wird der Build über reines http:// ausgeliefert, greifen die Fallbacks.
 * Die IDs müssen nur innerhalb eines Plans eindeutig sein, nicht global.
 */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function clampHour(value: number): number {
  if (!Number.isFinite(value)) return 9;
  return Math.min(24, Math.max(0, Math.round(value)));
}

/** Vorbelegung für den Ferienmodus: laufende Woche plus drei weitere. */
function defaultPeriod(): { start: IsoDate; end: IsoDate } {
  const start = startOfWeek(toIso(new Date()));
  return { start, end: addDays(start, 4 * 7 - 3) };
}

function createDefaultState(): ScheduleState {
  return {
    version: 6,
    title: 'Dienstplan Bibliothek',
    mode: 'semester',
    period: defaultPeriod(),
    openingHours: WEEKDAYS.map((weekday) => ({
      weekday,
      open: true,
      start: 9,
      end: 18,
    })),
    assistants: [],
    vacations: [],
    availability: {},
    assignments: {},
    officeWork: {},
  };
}

function loadState(): ScheduleState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return createDefaultState();
  }
}

/**
 * Hebt ältere Stände auf v4. Frühere Fassungen kannten den Modus noch nicht
 * und speicherten Schlüssel ohne Wochenanteil (`1-9`) oder mit Datum
 * (`2026-08-10T09`). Beides wird auf `weekKey|weekday-hour` gebracht.
 */
function migrateKeys(
  raw: Record<string, unknown>,
): { mode: PlanMode; assignments: Record<string, string[]> } {
  const legacy = (raw['assignments'] ?? {}) as Record<string, unknown>;
  const assignments: Record<string, string[]> = {};
  let sawDate = false;

  for (const [key, ids] of Object.entries(legacy)) {
    if (!Array.isArray(ids) || !ids.length) continue;
    const people = ids.filter((id): id is string => typeof id === 'string');
    if (!people.length) continue;

    if (key.includes('|')) {
      // Bereits v4.
      assignments[key] = people;
      continue;
    }

    const dateMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2})$/.exec(key);
    if (dateMatch) {
      // v2/v3: konkreter Termin -> Woche plus Wochentag.
      const [, date, hour] = dateMatch;
      const weekday = weekdayOf(date!);
      if (weekday === null) continue;
      sawDate = true;
      assignments[slotKey(startOfWeek(date!), weekday, Number(hour))] = people;
      continue;
    }

    const weekdayMatch = /^([1-5])-(\d{1,2})$/.exec(key);
    if (weekdayMatch) {
      // v1: wiederkehrende Woche -> Semesterplan.
      const [, weekday, hour] = weekdayMatch;
      assignments[slotKey(SEMESTER_WEEK, Number(weekday) as Weekday, Number(hour))] = people;
    }
  }

  return { mode: sawDate ? 'break' : 'semester', assignments };
}

/**
 * Hebt Verfügungszeiten älterer Stände an. Bis v3 waren sie wochentagsbasiert
 * und galten für den ganzen Plan — das entspricht dem Semesterplan.
 */
function migrateAvailability(
  raw: Record<string, unknown>,
  knownIds: Set<string>,
): ScheduleState['availability'] {
  const result: ScheduleState['availability'] = {};
  const source = (raw['availability'] ?? {}) as Record<string, unknown>;

  for (const [assistantId, bySlot] of Object.entries(source)) {
    if (!knownIds.has(assistantId) || !bySlot || typeof bySlot !== 'object') continue;
    const entries: Record<string, Availability> = {};
    for (const [key, value] of Object.entries(bySlot as Record<string, unknown>)) {
      if (!AVAILABILITY_ORDER.includes(value as Availability)) continue;
      entries[key.includes('|') ? key : `${SEMESTER_WEEK}|${key}`] = value as Availability;
    }
    if (Object.keys(entries).length) result[assistantId] = entries;
  }

  // v3 kannte zusätzlich wochenweise Angaben in der vorlesungsfreien Zeit.
  const weekly = (raw['weeklyAvailability'] ?? {}) as Record<string, unknown>;
  for (const [assistantId, byWeek] of Object.entries(weekly)) {
    if (!knownIds.has(assistantId) || !byWeek || typeof byWeek !== 'object') continue;
    const entries = { ...(result[assistantId] ?? {}) };
    for (const [monday, bySlot] of Object.entries(byWeek as Record<string, unknown>)) {
      if (!isValidIso(monday) || !bySlot || typeof bySlot !== 'object') continue;
      for (const [key, value] of Object.entries(bySlot as Record<string, unknown>)) {
        if (AVAILABILITY_ORDER.includes(value as Availability)) {
          entries[`${startOfWeek(monday)}|${key}`] = value as Availability;
        }
      }
    }
    if (Object.keys(entries).length) result[assistantId] = entries;
  }

  return result;
}

/** Prüft eine geladene oder importierte Struktur und füllt fehlende Felder auf. */
export function normalizeState(input: unknown): ScheduleState {
  const base = createDefaultState();
  if (!input || typeof input !== 'object') return base;
  const raw = input as Record<string, unknown>;

  const rawPeriod = (raw['period'] ?? {}) as Record<string, unknown>;
  const period = {
    start: isValidIso(rawPeriod['start']) ? (rawPeriod['start'] as IsoDate) : base.period.start,
    end: isValidIso(rawPeriod['end']) ? (rawPeriod['end'] as IsoDate) : base.period.end,
  };
  if (period.end < period.start) period.end = period.start;

  const openingHours = WEEKDAYS.map((weekday) => {
    const list = Array.isArray(raw['openingHours']) ? (raw['openingHours'] as OpeningHours[]) : [];
    const found = list.find((o) => o?.weekday === weekday);
    if (!found) return base.openingHours.find((o) => o.weekday === weekday)!;
    const start = clampHour(found.start ?? 9);
    const end = clampHour(found.end ?? 18);
    return {
      weekday,
      open: found.open !== false && end > start,
      start,
      end: Math.max(end, start + 1),
    } satisfies OpeningHours;
  });

  const assistantsRaw = Array.isArray(raw['assistants']) ? raw['assistants'] : [];
  const assistants = assistantsRaw
    .filter(
      (a): a is { id: string; name: string; color?: string; note?: string } =>
        !!a &&
        typeof a === 'object' &&
        typeof (a as { id?: unknown }).id === 'string' &&
        typeof (a as { name?: unknown }).name === 'string',
    )
    .map((a, i) => ({
      id: a.id,
      name: a.name,
      color: a.color || PALETTE[i % PALETTE.length]!,
      note: a.note,
    }));

  const knownIds = new Set(assistants.map((a) => a.id));
  const availability = migrateAvailability(raw, knownIds);
  const migrated = migrateKeys(raw);

  const mode: PlanMode =
    raw['mode'] === 'semester' || raw['mode'] === 'break' ? raw['mode'] : migrated.mode;

  const assignments: ScheduleState['assignments'] = {};
  for (const [key, ids] of Object.entries(migrated.assignments)) {
    const kept = [...new Set(ids.filter((id) => knownIds.has(id)))];
    if (kept.length) assignments[key] = kept;
  }

  const vacationsRaw = Array.isArray(raw['vacations']) ? raw['vacations'] : [];
  const vacations: Vacation[] = [];
  for (const item of vacationsRaw) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    if (typeof v['assistantId'] !== 'string' || !knownIds.has(v['assistantId'])) continue;
    if (!isValidIso(v['from']) || !isValidIso(v['to'])) continue;
    const from = v['from'] as IsoDate;
    const to = v['to'] as IsoDate;
    vacations.push({
      id: typeof v['id'] === 'string' ? v['id'] : createId(),
      assistantId: v['assistantId'],
      from: from <= to ? from : to,
      to: from <= to ? to : from,
      note: typeof v['note'] === 'string' ? v['note'] : undefined,
    });
  }
  vacations.sort((a, b) => a.from.localeCompare(b.from));

  const officeWork: ScheduleState['officeWork'] = {};
  const rawOfficeWork = (raw['officeWork'] ?? {}) as Record<string, unknown>;
  for (const [key, ids] of Object.entries(rawOfficeWork)) {
    if (!Array.isArray(ids)) continue;
    // Bewusst nicht gegen `assignments` geprüft: die Zugehörigkeit wird beim
    // Lesen über isOfficeWork() erzwungen, nicht schon hier beim Speichern.
    const kept = [...new Set(ids.filter((id): id is string => knownIds.has(id as string)))];
    if (kept.length) officeWork[key] = kept;
  }

  return {
    version: 6,
    title: typeof raw['title'] === 'string' && raw['title'].trim() ? raw['title'] : base.title,
    mode,
    period,
    openingHours,
    assistants,
    vacations,
    availability,
    assignments,
    officeWork,
  };
}

@Service()
export class ScheduleStore {
  private readonly _state = signal<ScheduleState>(loadState());

  readonly state = this._state.asReadonly();
  readonly title = computed(() => this._state().title);
  readonly mode = computed(() => this._state().mode);
  readonly isBreakMode = computed(() => this._state().mode === 'break');
  readonly period = computed(() => this._state().period);
  readonly assistants = computed(() => this._state().assistants);
  readonly vacations = computed(() => this._state().vacations);

  vacationsOf(assistantId: string): Vacation[] {
    return this._state()
      .vacations.filter((v) => v.assistantId === assistantId)
      .sort((a, b) => a.from.localeCompare(b.from));
  }

  /**
   * Ist die Hilfskraft an diesem Tag im Urlaub? Nur im Ferienplan aussagekräftig
   * — der Semesterplan hat keine Kalendertage, gegen die sich prüfen ließe.
   */
  isOnVacation(assistantId: string, date: IsoDate): boolean {
    return this._state().vacations.some(
      (v) => v.assistantId === assistantId && isWithin(date, v.from, v.to),
    );
  }

  /**
   * Ist der Slot für diese Hilfskraft gesperrt? Grundlage für die
   * Zuweisungssperre — im Gegensatz zu den übrigen Warnungen wird eine
   * Zuweisung hier tatsächlich verhindert, nicht nur kommentiert.
   */
  isBlockedFor(assistantId: string, slot: Slot): boolean {
    return !!slot.date && this.isOnVacation(assistantId, slot.date);
  }
  readonly openingHours = computed(() => this._state().openingHours);

  /** Geöffnete Wochentage laut Standard — in beiden Modi dieselbe Grundlage. */
  readonly openWeekdays = computed<Weekday[]>(() =>
    this._state()
      .openingHours.filter((o) => o.open)
      .map((o) => o.weekday),
  );

  /** Stundenzeilen aus der Spannweite der Öffnungszeiten. */
  readonly hourRows = computed<number[]>(() => {
    const open = this._state().openingHours.filter((o) => o.open);
    if (!open.length) return [];
    const start = Math.min(...open.map((o) => o.start));
    const end = Math.max(...open.map((o) => o.end));
    return Array.from({ length: end - start }, (_, i) => start + i);
  });

  /** Zellen eines einzelnen Wochenplans. */
  readonly slotsPerWeek = computed(() =>
    this._state()
      .openingHours.filter((o) => o.open)
      .reduce((sum, o) => sum + (o.end - o.start), 0),
  );

  /**
   * Die Wochenpläne dieses Dienstplans: im Semestermodus genau einer ohne
   * Datumsbezug, im Ferienmodus einer je Kalenderwoche im Zeitraum.
   */
  readonly weekPlans = computed<WeekPlan[]>(() => {
    const state = this._state();
    if (state.mode === 'semester') {
      return [{ key: SEMESTER_WEEK, label: 'Musterwoche', monday: null, dates: [] }];
    }

    const openWeekdays = new Set(this.openWeekdays());
    const plans: WeekPlan[] = [];
    const { start, end } = state.period;

    // Schutz vor versehentlich riesigen Zeiträumen (rund fünf Jahre).
    for (
      let monday = startOfWeek(start), guard = 0;
      monday <= end && guard < 300;
      monday = addDays(monday, 7), guard++
    ) {
      const dates: { weekday: Weekday; date: IsoDate }[] = [];
      for (let offset = 0; offset < 5; offset++) {
        const date = addDays(monday, offset);
        if (date < start || date > end) continue;
        const weekday = weekdayOf(date);
        if (weekday === null || !openWeekdays.has(weekday)) continue;
        dates.push({ weekday, date });
      }
      if (!dates.length) continue;
      plans.push({
        key: monday,
        label: `KW ${isoWeekNumber(monday)}`,
        monday,
        dates,
      });
    }
    return plans;
  });

  readonly slots = computed<Slot[]>(() => {
    const result: Slot[] = [];
    const openingHours = this._state().openingHours;

    for (const plan of this.weekPlans()) {
      const weekdays =
        plan.monday === null
          ? this.openWeekdays().map((weekday) => ({ weekday, date: null as IsoDate | null }))
          : plan.dates.map((d) => ({ weekday: d.weekday, date: d.date as IsoDate | null }));

      for (const { weekday, date } of weekdays) {
        const hours = openingHours.find((o) => o.weekday === weekday);
        if (!hours?.open) continue;
        for (let hour = hours.start; hour < hours.end; hour++) {
          result.push({
            week: plan.key,
            weekday,
            hour,
            key: slotKey(plan.key, weekday, hour),
            weekdayKey: weekdaySlotKey(weekday, hour),
            date,
          });
        }
      }
    }
    return result;
  });

  slotsOfWeek(week: WeekKey): Slot[] {
    return this.slots().filter((s) => s.week === week);
  }

  /** Kalendertag einer Spalte im Ferienmodus, sonst null. */
  dateOf(week: WeekKey, weekday: Weekday): IsoDate | null {
    const plan = this.weekPlans().find((p) => p.key === week);
    return plan?.dates.find((d) => d.weekday === weekday)?.date ?? null;
  }

  isOpenIn(week: WeekKey, weekday: Weekday, hour: number): boolean {
    const plan = this.weekPlans().find((p) => p.key === week);
    if (!plan) return false;
    if (plan.monday !== null && !plan.dates.some((d) => d.weekday === weekday)) return false;
    const hours = this._state().openingHours.find((o) => o.weekday === weekday);
    return !!hours?.open && hour >= hours.start && hour < hours.end;
  }

  readonly assignedCount = computed(() => {
    const assignments = this._state().assignments;
    return this.slots().filter((s) => (assignments[s.key]?.length ?? 0) > 0).length;
  });

  /** Eingeteilte Stunden je Hilfskraft über den gesamten Dienstplan. */
  readonly hoursByAssistant = computed<Record<string, number>>(() => {
    const result: Record<string, number> = {};
    for (const a of this._state().assistants) result[a.id] = 0;
    for (const slot of this.slots()) {
      for (const id of this._state().assignments[slot.key] ?? []) {
        if (id in result) result[id] = (result[id] ?? 0) + 1;
      }
    }
    return result;
  });

  hoursByAssistantInWeek(week: WeekKey): Record<string, number> {
    const result: Record<string, number> = {};
    for (const a of this._state().assistants) result[a.id] = 0;
    for (const slot of this.slotsOfWeek(week)) {
      for (const id of this._state().assignments[slot.key] ?? []) {
        if (id in result) result[id] = (result[id] ?? 0) + 1;
      }
    }
    return result;
  }

  // --- Verfügbarkeit --------------------------------------------------------

  getAvailability(assistantId: string, key: SlotKeyLike): Availability | undefined {
    return this._state().availability[assistantId]?.[key];
  }

  answeredCount(assistantId: string, week: WeekKey): number {
    return this.slotsOfWeek(week).filter((s) => this.getAvailability(assistantId, s.key)).length;
  }

  /**
   * Zahl der Hilfskräfte, die für einen Slot „Ja" oder „Wenn es sein muss"
   * angegeben haben. Urlaub schlägt eine Antwort — wer an diesem Tag Urlaub
   * hat, zählt nicht mit, unabhängig davon, was in der Matrix steht.
   */
  availableCount(key: SlotKeyLike, date: IsoDate | null): number {
    let count = 0;
    for (const assistant of this._state().assistants) {
      if (date && this.isOnVacation(assistant.id, date)) continue;
      const answer = this.getAvailability(assistant.id, key);
      if (answer === 'yes' || answer === 'ifNeeded') count++;
    }
    return count;
  }

  setAvailability(assistantId: string, key: SlotKeyLike, value: Availability | undefined): void {
    this._state.update((s) => {
      const forAssistant = { ...(s.availability[assistantId] ?? {}) };
      if (value === undefined) delete forAssistant[key];
      else forAssistant[key] = value;
      return { ...s, availability: { ...s.availability, [assistantId]: forAssistant } };
    });
  }

  /** Klick auf eine Zelle: unbeantwortet → Ja → Wenn es sein muss → Nein → unbeantwortet. */
  cycleAvailability(assistantId: string, key: SlotKeyLike): void {
    const current = this.getAvailability(assistantId, key);
    const next: Record<string, Availability | undefined> = {
      undefined: 'yes',
      yes: 'ifNeeded',
      ifNeeded: 'no',
      no: undefined,
    };
    this.setAvailability(assistantId, key, next[String(current)]);
  }

  setAvailabilityForSlots(
    assistantId: string,
    keys: SlotKeyLike[],
    value: Availability | undefined,
  ): void {
    this._state.update((s) => {
      const forAssistant = { ...(s.availability[assistantId] ?? {}) };
      for (const key of keys) {
        if (value === undefined) delete forAssistant[key];
        else forAssistant[key] = value;
      }
      return { ...s, availability: { ...s.availability, [assistantId]: forAssistant } };
    });
  }

  /** Überträgt die Verfügungszeiten einer Woche auf eine andere. */
  copyAvailability(assistantId: string, source: WeekKey, target: WeekKey): number {
    if (source === target) return 0;
    let copied = 0;
    this._state.update((s) => {
      const forAssistant = { ...(s.availability[assistantId] ?? {}) };
      for (const slot of this.slotsOfWeek(target)) {
        const value = forAssistant[`${source}|${slot.weekdayKey}`];
        if (!value) continue;
        forAssistant[slot.key] = value;
        copied++;
      }
      return { ...s, availability: { ...s.availability, [assistantId]: forAssistant } };
    });
    return copied;
  }

  /**
   * Überträgt die Angaben einer Woche in einem Rutsch auf alle anderen
   * Wochenpläne. Überschreibt dort bestehende Antworten vollständig, genau
   * wie `copyAvailability()` für eine einzelne Zielwoche — der Aufrufer
   * (die Oberfläche) muss vorher nachfragen, das übernimmt der Store nicht.
   */
  copyAvailabilityToAllWeeks(assistantId: string, source: WeekKey): { weeks: number; slots: number } {
    let weeks = 0;
    let slots = 0;
    for (const plan of this.weekPlans()) {
      if (plan.key === source) continue;
      const copied = this.copyAvailability(assistantId, source, plan.key);
      if (copied > 0) weeks++;
      slots += copied;
    }
    return { weeks, slots };
  }

  // --- Warnungen ------------------------------------------------------------

  readonly warnings = computed<ScheduleWarning[]>(() => {
    const state = this._state();
    const result: ScheduleWarning[] = [];
    const nameOf = (id: string) =>
      state.assistants.find((a) => a.id === id)?.name ?? 'Unbekannt';

    for (const slot of this.slots()) {
      const label = slot.date
        ? `${WEEKDAY_SHORT[slot.weekday]} ${formatDate(slot.date)} ${formatHour(slot.hour)}`
        : `${WEEKDAY_SHORT[slot.weekday]} ${formatHour(slot.hour)}`;
      const assigned = state.assignments[slot.key] ?? [];

      if (!assigned.length) {
        result.push({
          level: 'warn',
          slotKey: slot.key,
          week: slot.week,
          message: `${label}: niemand eingeteilt.`,
        });
        continue;
      }

      let onlyIfNeeded = true;
      for (const id of assigned) {
        if (this.isBlockedFor(id, slot)) {
          // Kann nur durch nachträglich eingetragenen Urlaub entstehen, da
          // die Zuweisungswege eine Sperre selbst schon verhindern.
          result.push({
            level: 'error',
            slotKey: slot.key,
            week: slot.week,
            assistantId: id,
            message: `${label}: ${nameOf(id)} hat hier Urlaub eingetragen.`,
          });
          onlyIfNeeded = false;
          continue;
        }
        const answer = this.getAvailability(id, slot.key);
        if (answer === 'no') {
          result.push({
            level: 'error',
            slotKey: slot.key,
            week: slot.week,
            assistantId: id,
            message: `${label}: ${nameOf(id)} hat hier „Nein" angegeben.`,
          });
        } else if (answer === undefined) {
          result.push({
            level: 'error',
            slotKey: slot.key,
            week: slot.week,
            assistantId: id,
            message: `${label}: von ${nameOf(id)} liegt für diese Stunde keine Antwort vor.`,
          });
        }
        if (answer === 'yes') onlyIfNeeded = false;
      }

      if (onlyIfNeeded && assigned.length) {
        result.push({
          level: 'info',
          slotKey: slot.key,
          week: slot.week,
          message: `${label}: nur mit „Wenn es sein muss" besetzt.`,
        });
      }
    }

    const valid = new Set(this.slots().map((s) => s.key));
    const orphans = Object.entries(state.assignments).filter(
      ([key, ids]) => ids.length && !valid.has(key),
    );
    if (orphans.length) {
      result.push({
        level: 'warn',
        message: `${orphans.length} Zuweisung(en) liegen außerhalb der aktuellen Wochenpläne.`,
      });
    }

    return result;
  });

  readonly warningsBySlot = computed<Map<string, ScheduleWarning[]>>(() => {
    const map = new Map<string, ScheduleWarning[]>();
    for (const warning of this.warnings()) {
      if (!warning.slotKey) continue;
      const list = map.get(warning.slotKey) ?? [];
      list.push(warning);
      map.set(warning.slotKey, list);
    }
    return map;
  });

  warningsOfWeek(week: WeekKey): ScheduleWarning[] {
    return this.warnings().filter((w) => w.week === week);
  }

  readonly hasOrphanAssignments = computed(() => {
    const valid = new Set(this.slots().map((s) => s.key));
    return Object.entries(this._state().assignments).some(
      ([key, ids]) => ids.length && !valid.has(key),
    );
  });

  /**
   * Öffentlich, damit die Oberfläche den Verknüpfungsstatus anzeigen kann
   * (`fileLink.supported`, `fileLink.linkedFileName()`, `fileLink.writeError()`).
   * Der Store selbst bleibt dadurch aber die einzige Stelle, die tatsächlich
   * entscheidet, wann geschrieben wird.
   */
  readonly fileLink = inject(FileLinkService);

  constructor() {
    effect(() => {
      const snapshot = this._state();
      const json = JSON.stringify(snapshot);
      // localStorage bleibt immer die Absicherung — auch mit Dateiverknüpfung,
      // falls deren Berechtigung zwischendurch entzogen wird oder der Browser
      // die Programmierschnittstelle gar nicht unterstützt (Firefox, Safari).
      try {
        localStorage.setItem(STORAGE_KEY, json);
      } catch {
        // Speicher voll oder blockiert: Daten bleiben in der Sitzung erhalten.
      }
      if (this.fileLink.isLinked) void this.fileLink.write(json);
    });

    void this.restoreFileLink();
  }

  /**
   * Stellt beim Start eine frühere Dateiverknüpfung wieder her und lädt,
   * falls erfolgreich, deren Inhalt als maßgeblichen Zustand — die Datei ist
   * dann die Quelle der Wahrheit, nicht mehr der localStorage-Zwischenstand,
   * mit dem die App zuvor angezeigt wurde.
   */
  private async restoreFileLink(): Promise<void> {
    await this.fileLink.restoreLink();
    if (!this.fileLink.isLinked) return;
    const content = await this.fileLink.read();
    if (!content) return;
    try {
      this._state.set(normalizeState(JSON.parse(content)));
    } catch {
      // Datei beschädigt oder kein gültiges JSON: beim localStorage-Stand
      // bleiben, statt eine kaputte Datei zu übernehmen.
    }
  }

  /** Öffnet den Auswahldialog und schreibt den aktuellen Stand als erste Fassung. */
  async linkFile(): Promise<boolean> {
    const name = this._state().title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'dienstplan';
    return this.fileLink.chooseFile(`${name}.json`, JSON.stringify(this._state(), null, 2));
  }

  unlinkFile(): void {
    this.fileLink.unlink();
  }

  // --- Stammdaten -----------------------------------------------------------

  setTitle(title: string): void {
    this._state.update((s) => ({ ...s, title }));
  }

  /**
   * Wechselt den Plantyp. Verfügungszeiten und Einteilung bleiben gespeichert,
   * sind aber nur im jeweils passenden Modus sichtbar — der Wechsel ist damit
   * verlustfrei umkehrbar.
   */
  setMode(mode: PlanMode): void {
    this._state.update((s) => ({ ...s, mode }));
  }

  setPeriod(patch: Partial<{ start: IsoDate; end: IsoDate }>): void {
    this._state.update((s) => {
      const period = { ...s.period, ...patch };
      if (!isValidIso(period.start) || !isValidIso(period.end)) return s;
      if (period.end < period.start) period.end = period.start;
      return { ...s, period };
    });
  }

  setOpeningHours(weekday: Weekday, patch: Partial<OpeningHours>): void {
    this._state.update((s) => ({
      ...s,
      openingHours: s.openingHours.map((o) => {
        if (o.weekday !== weekday) return o;
        const next = { ...o, ...patch };
        next.start = clampHour(next.start);
        next.end = clampHour(next.end);
        if (next.end <= next.start) next.end = next.start + 1;
        return next;
      }),
    }));
  }

  applyToAllWeekdays(source: Weekday): void {
    const template = this._state().openingHours.find((o) => o.weekday === source);
    if (!template) return;
    this._state.update((s) => ({
      ...s,
      openingHours: s.openingHours.map((o) => ({
        ...o,
        open: template.open,
        start: template.start,
        end: template.end,
      })),
    }));
  }

  addAssistant(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this._state.update((s) => ({
      ...s,
      assistants: [
        ...s.assistants,
        {
          id: createId(),
          name: trimmed,
          color: PALETTE[s.assistants.length % PALETTE.length]!,
        },
      ],
    }));
  }

  renameAssistant(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this._state.update((s) => ({
      ...s,
      assistants: s.assistants.map((a) => (a.id === id ? { ...a, name: trimmed } : a)),
    }));
  }

  removeAssistant(id: string): void {
    this._state.update((s) => {
      const availability = { ...s.availability };
      delete availability[id];
      const assignments: Record<string, string[]> = {};
      for (const [key, ids] of Object.entries(s.assignments)) {
        const kept = ids.filter((x) => x !== id);
        if (kept.length) assignments[key] = kept;
      }
      const officeWork: Record<string, string[]> = {};
      for (const [key, ids] of Object.entries(s.officeWork)) {
        const kept = ids.filter((x) => x !== id);
        if (kept.length) officeWork[key] = kept;
      }
      return {
        ...s,
        assistants: s.assistants.filter((a) => a.id !== id),
        vacations: s.vacations.filter((v) => v.assistantId !== id),
        availability,
        assignments,
        officeWork,
      };
    });
  }

  // --- Urlaub -----------------------------------------------------------

  /**
   * Trägt Urlaub ein und entfernt dafür rückwirkend jede Zuweisung in diesem
   * Zeitraum — sonst bliebe eine bereits geplante Schicht bestehen und würde
   * nur noch als Warnung auffallen, statt gelöst zu sein.
   */
  addVacation(assistantId: string, from: IsoDate, to: IsoDate, note = ''): void {
    if (!isValidIso(from) || !isValidIso(to)) return;
    const range = { from: from <= to ? from : to, to: from <= to ? to : from };
    this._state.update((s) => {
      const vacations = [
        ...s.vacations,
        { id: createId(), assistantId, ...range, note: note.trim() || undefined },
      ];
      vacations.sort((a, b) => a.from.localeCompare(b.from));

      const assignments = { ...s.assignments };
      const officeWork = { ...s.officeWork };
      for (const slot of this.slots()) {
        if (!slot.date || !isWithin(slot.date, range.from, range.to)) continue;
        const current = assignments[slot.key];
        if (!current?.includes(assistantId)) continue;
        const rest = current.filter((id) => id !== assistantId);
        if (rest.length) assignments[slot.key] = rest;
        else delete assignments[slot.key];
        this.clearOfficeWork(officeWork, slot.key, assistantId);
      }

      return { ...s, vacations, assignments, officeWork };
    });
  }

  removeVacation(id: string): void {
    this._state.update((s) => ({ ...s, vacations: s.vacations.filter((v) => v.id !== id) }));
  }

  // --- Einteilung -----------------------------------------------------------

  assignedTo(key: SlotKeyLike): string[] {
    return this._state().assignments[key] ?? [];
  }

  isAssigned(key: SlotKeyLike, assistantId: string): boolean {
    return this.assignedTo(key).includes(assistantId);
  }

  // --- Einsatzort (Theke / Büro) --------------------------------------------
  // Theke ist der Normalfall; nur die Abweichung „Büro" wird gespeichert.

  /**
   * Ist die Person an diesem Slot im Büro statt an der Theke? Geprüft wird
   * bewusst gegen die aktuelle Zuweisung, nicht nur gegen den rohen
   * Zustand — wird eine Zuweisung entfernt (Klick, Verschieben, Urlaub),
   * verschwindet die Ortsmarkierung damit automatisch mit, ohne dass jede
   * der verschiedenen Entfernungsstellen sie einzeln aufräumen müsste.
   */
  isOfficeWork(key: SlotKeyLike, assistantId: string): boolean {
    if (!this.isAssigned(key, assistantId)) return false;
    return this._state().officeWork[key]?.includes(assistantId) ?? false;
  }

  /** Wechselt zwischen Theke und Büro. Ohne bestehende Zuweisung ein No-op. */
  toggleTask(key: SlotKeyLike, assistantId: string): void {
    if (!this.isAssigned(key, assistantId)) return;
    this._state.update((s) => {
      const current = s.officeWork[key] ?? [];
      const officeWork = { ...s.officeWork };
      if (current.includes(assistantId)) {
        const rest = current.filter((id) => id !== assistantId);
        if (rest.length) officeWork[key] = rest;
        else delete officeWork[key];
      } else {
        officeWork[key] = [...current, assistantId];
      }
      return { ...s, officeWork };
    });
  }

  /** Slot zu einem Schlüssel, falls er im aktuellen Plan existiert. */
  private slotByKey(key: SlotKeyLike): Slot | undefined {
    return this.slots().find((s) => s.key === key);
  }

  /**
   * Filtert Urlaubstage aus einer Liste von Zielslots heraus. Der Semesterplan
   * hat keine Kalendertage, dort greift die Sperre folglich nie.
   */
  private withoutVacation(keys: SlotKeyLike[], assistantId: string): SlotKeyLike[] {
    return keys.filter((key) => {
      const slot = this.slotByKey(key);
      return !slot || !this.isBlockedFor(assistantId, slot);
    });
  }

  /**
   * Entfernt die Büro-Markierung eines Slots für eine Person, falls
   * vorhanden. Wird an jeder Stelle aufgerufen, an der eine Zuweisung
   * verschwindet — sonst würde eine spätere erneute Zuweisung fälschlich
   * die alte Markierung wiederbeleben, statt wieder mit Theke zu beginnen.
   */
  private clearOfficeWork(officeWork: Record<string, string[]>, key: string, assistantId: string): void {
    const current = officeWork[key];
    if (!current?.includes(assistantId)) return;
    const rest = current.filter((id) => id !== assistantId);
    if (rest.length) officeWork[key] = rest;
    else delete officeWork[key];
  }

  toggleAssignment(key: SlotKeyLike, assistantId: string): void {
    const slot = this.slotByKey(key);
    // Entfernen ist immer erlaubt — nur das Hinzufügen wird durch Urlaub gesperrt.
    if (slot && !this.isAssigned(key, assistantId) && this.isBlockedFor(assistantId, slot)) return;
    this._state.update((s) => {
      const current = s.assignments[key] ?? [];
      const removing = current.includes(assistantId);
      const next = removing
        ? current.filter((id) => id !== assistantId)
        : [...current, assistantId];
      const assignments = { ...s.assignments };
      if (next.length) assignments[key] = next;
      else delete assignments[key];

      const officeWork = { ...s.officeWork };
      if (removing) this.clearOfficeWork(officeWork, key, assistantId);
      return { ...s, assignments, officeWork };
    });
  }

  /**
   * Deckungsgrad einer Hilfskraft über mehrere Slots. Grundlage für die
   * Darstellung eines Blocks: ganz, teilweise oder gar nicht eingeteilt.
   */
  assignmentCoverage(keys: SlotKeyLike[], assistantId: string): 'none' | 'some' | 'all' {
    if (!keys.length) return 'none';
    let assigned = 0;
    for (const key of keys) {
      if (this.isAssigned(key, assistantId)) assigned++;
    }
    if (!assigned) return 'none';
    return assigned === keys.length ? 'all' : 'some';
  }

  /**
   * Setzt oder entfernt eine Hilfskraft über einen ganzen Block. Teilweise
   * belegte Blöcke werden aufgefüllt, nicht geleert — das ist beim
   * Nachbessern einer Schicht die erwartete Richtung. Urlaubstage innerhalb
   * des Blocks werden beim Auffüllen ausgelassen, beim Leeren wie gewohnt
   * mit entfernt.
   */
  toggleAssignmentForSlots(keys: SlotKeyLike[], assistantId: string): void {
    if (!keys.length) return;
    const assign = this.assignmentCoverage(keys, assistantId) !== 'all';
    const targets = assign ? this.withoutVacation(keys, assistantId) : keys;
    if (!targets.length) return;
    this._state.update((s) => {
      const assignments = { ...s.assignments };
      const officeWork = { ...s.officeWork };
      for (const key of targets) {
        const current = assignments[key] ?? [];
        if (assign) {
          if (!current.includes(assistantId)) assignments[key] = [...current, assistantId];
        } else {
          const next = current.filter((id) => id !== assistantId);
          if (next.length) assignments[key] = next;
          else delete assignments[key];
          this.clearOfficeWork(officeWork, key, assistantId);
        }
      }
      return { ...s, assignments, officeWork };
    });
  }

  /** Setzt eine Hilfskraft auf die angegebenen Slots, ohne andere zu verdrängen. */
  assignToSlots(keys: SlotKeyLike[], assistantId: string): void {
    const targets = this.withoutVacation(keys, assistantId);
    if (!targets.length) return;
    this._state.update((s) => {
      const assignments = { ...s.assignments };
      for (const key of targets) {
        const current = assignments[key] ?? [];
        if (!current.includes(assistantId)) assignments[key] = [...current, assistantId];
      }
      return { ...s, assignments };
    });
  }

  /**
   * Verschiebt eine Hilfskraft von einem oder mehreren Slots auf andere.
   * Quelle und Ziel werden in einem Schritt geändert, damit beim Ziehen kein
   * Zwischenzustand entsteht, in dem die Person nirgends eingeteilt ist —
   * insbesondere dann nicht, wenn sich Quelle und Ziel überschneiden.
   *
   * Fällt auch nur ein Zielslot auf einen Urlaubstag, wird die gesamte
   * Verschiebung verweigert (alles oder nichts): ein teilweise verschobener
   * Block würde sonst unbemerkt Stunden verlieren.
   */
  moveAssignment(from: SlotKeyLike | SlotKeyLike[], to: SlotKeyLike[], assistantId: string): void {
    if (!to.length) return;
    if (this.withoutVacation(to, assistantId).length !== to.length) return;
    const sources = Array.isArray(from) ? from : [from];
    this._state.update((s) => {
      const assignments = { ...s.assignments };
      const officeWork = { ...s.officeWork };

      for (const key of sources) {
        const rest = (assignments[key] ?? []).filter((id) => id !== assistantId);
        if (rest.length) assignments[key] = rest;
        else delete assignments[key];
        this.clearOfficeWork(officeWork, key, assistantId);
      }

      for (const key of to) {
        const current = assignments[key] ?? [];
        if (!current.includes(assistantId)) assignments[key] = [...current, assistantId];
      }
      return { ...s, assignments, officeWork };
    });
  }

  /** Überträgt die Einteilung einer Woche auf eine andere, Stelle für Stelle. */
  copyWeek(source: WeekKey, target: WeekKey): number {
    if (source === target) return 0;
    let copied = 0;
    this._state.update((s) => {
      const assignments = { ...s.assignments };
      for (const slot of this.slotsOfWeek(target)) {
        const ids = s.assignments[`${source}|${slot.weekdayKey}`];
        if (!ids?.length) continue;
        assignments[slot.key] = [...ids];
        copied++;
      }
      return { ...s, assignments };
    });
    return copied;
  }

  clearWeek(week: WeekKey): void {
    this._state.update((s) => {
      const assignments = { ...s.assignments };
      const officeWork = { ...s.officeWork };
      for (const slot of this.slotsOfWeek(week)) {
        delete assignments[slot.key];
        delete officeWork[slot.key];
      }
      return { ...s, assignments, officeWork };
    });
  }

  clearAssignments(): void {
    this._state.update((s) => ({ ...s, assignments: {}, officeWork: {} }));
  }

  /** Entfernt Zuweisungen, die zu keinem aktuellen Wochenplan gehören. */
  pruneOrphanAssignments(): void {
    const valid = new Set(this.slots().map((s) => s.key));
    this._state.update((s) => {
      const assignments: Record<string, string[]> = {};
      for (const [key, ids] of Object.entries(s.assignments)) {
        if (valid.has(key) && ids.length) assignments[key] = ids;
      }
      const officeWork: Record<string, string[]> = {};
      for (const [key, ids] of Object.entries(s.officeWork)) {
        if (assignments[key]?.length) officeWork[key] = ids.filter((id) => assignments[key]!.includes(id));
      }
      return { ...s, assignments, officeWork };
    });
  }

  // --- Import / Reset -------------------------------------------------------

  replaceState(next: unknown): void {
    this._state.set(normalizeState(next));
  }

  reset(): void {
    this._state.set(createDefaultState());
  }
}

/** Slotschlüssel; als eigener Alias, damit Aufrufe lesbar bleiben. */
type SlotKeyLike = string;
