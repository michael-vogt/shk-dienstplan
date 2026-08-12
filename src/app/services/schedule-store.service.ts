import { Service, computed, effect, signal } from '@angular/core';
import {
  AVAILABILITY_ORDER,
  Absence,
  Availability,
  DateException,
  IsoDate,
  OpeningHours,
  ScheduleState,
  ScheduleWarning,
  Slot,
  WEEKDAYS,
  WEEKDAY_SHORT,
  Weekday,
  addDays,
  formatDate,
  formatHour,
  isValidIso,
  isWithin,
  isoWeekNumber,
  slotKey,
  startOfWeek,
  toIso,
  weekdayOf,
  weekdaySlotKey,
} from '../models/schedule.model';

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

/** Vorbelegung: laufende Woche bis vier Wochen später. */
function defaultPeriod(): { start: IsoDate; end: IsoDate } {
  const start = startOfWeek(toIso(new Date()));
  return { start, end: addDays(start, 4 * 7 - 3) };
}

function createDefaultState(): ScheduleState {
  return {
    version: 2,
    title: 'Dienstplan Bibliothek',
    period: defaultPeriod(),
    openingHours: WEEKDAYS.map((weekday) => ({
      weekday,
      open: true,
      start: 9,
      end: 18,
    })),
    exceptions: [],
    assistants: [],
    absences: [],
    availability: {},
    assignments: {},
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
 * Hebt einen v1-Stand auf v2: dort war die Einteilung wochentagsbasiert
 * (`weekday-hour`). Sie wird auf jeden passenden Termin im Zeitraum
 * übertragen, weil ein v1-Plan genau als solche Wiederholung gemeint war.
 */
function migrateV1(raw: Record<string, unknown>, period: { start: IsoDate; end: IsoDate }) {
  const legacy = (raw['assignments'] ?? {}) as Record<string, unknown>;
  const assignments: Record<string, string[]> = {};

  for (let date = period.start; date <= period.end; date = addDays(date, 1)) {
    const weekday = weekdayOf(date);
    if (weekday === null) continue;
    for (const [key, ids] of Object.entries(legacy)) {
      if (!Array.isArray(ids) || !ids.length) continue;
      const [dayPart, hourPart] = key.split('-');
      if (Number(dayPart) !== weekday) continue;
      const hour = Number(hourPart);
      if (!Number.isFinite(hour)) continue;
      assignments[slotKey(date, hour)] = ids.filter((id): id is string => typeof id === 'string');
    }
  }
  return assignments;
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

  const availability: ScheduleState['availability'] = {};
  const rawAvailability = (raw['availability'] ?? {}) as Record<string, unknown>;
  for (const [assistantId, bySlot] of Object.entries(rawAvailability)) {
    if (!knownIds.has(assistantId) || !bySlot || typeof bySlot !== 'object') continue;
    availability[assistantId] = {};
    for (const [key, value] of Object.entries(bySlot as Record<string, unknown>)) {
      if (AVAILABILITY_ORDER.includes(value as Availability)) {
        availability[assistantId]![key] = value as Availability;
      }
    }
  }

  const exceptionsRaw = Array.isArray(raw['exceptions']) ? raw['exceptions'] : [];
  const exceptions: DateException[] = [];
  for (const item of exceptionsRaw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (!isValidIso(e['date'])) continue;
    if (exceptions.some((x) => x.date === e['date'])) continue;
    const start = typeof e['start'] === 'number' ? clampHour(e['start']) : undefined;
    const end = typeof e['end'] === 'number' ? clampHour(e['end']) : undefined;
    exceptions.push({
      date: e['date'] as IsoDate,
      closed: e['closed'] === true,
      start,
      end: start !== undefined && end !== undefined ? Math.max(end, start + 1) : end,
      note: typeof e['note'] === 'string' ? e['note'] : undefined,
    });
  }
  exceptions.sort((a, b) => a.date.localeCompare(b.date));

  const absencesRaw = Array.isArray(raw['absences']) ? raw['absences'] : [];
  const absences: Absence[] = [];
  for (const item of absencesRaw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (typeof a['assistantId'] !== 'string' || !knownIds.has(a['assistantId'])) continue;
    if (!isValidIso(a['from']) || !isValidIso(a['to'])) continue;
    const from = a['from'] as IsoDate;
    const to = a['to'] as IsoDate;
    absences.push({
      id: typeof a['id'] === 'string' ? a['id'] : createId(),
      assistantId: a['assistantId'],
      from: from <= to ? from : to,
      to: from <= to ? to : from,
      reason: typeof a['reason'] === 'string' ? a['reason'] : undefined,
    });
  }

  // Einteilung: v2 verwendet Datumsschlüssel, v1 Wochentagsschlüssel.
  const isLegacy = raw['version'] !== 2;
  const rawAssignments = isLegacy
    ? migrateV1(raw, period)
    : ((raw['assignments'] ?? {}) as Record<string, unknown>);

  const assignments: ScheduleState['assignments'] = {};
  for (const [key, ids] of Object.entries(rawAssignments)) {
    if (!Array.isArray(ids)) continue;
    const kept = [...new Set(ids.filter((id): id is string => knownIds.has(id as string)))];
    if (kept.length) assignments[key] = kept;
  }

  return {
    version: 2,
    title: typeof raw['title'] === 'string' && raw['title'].trim() ? raw['title'] : base.title,
    period,
    openingHours,
    exceptions,
    assistants,
    absences,
    availability,
    assignments,
  };
}

export interface WeekGroup {
  /** Montag dieser Woche, auch wenn der Zeitraum später beginnt. */
  monday: IsoDate;
  week: number;
  label: string;
  dates: IsoDate[];
}

@Service()
export class ScheduleStore {
  private readonly _state = signal<ScheduleState>(loadState());

  readonly state = this._state.asReadonly();
  readonly title = computed(() => this._state().title);
  readonly period = computed(() => this._state().period);
  readonly assistants = computed(() => this._state().assistants);
  readonly openingHours = computed(() => this._state().openingHours);
  readonly exceptions = computed(() => this._state().exceptions);
  readonly absences = computed(() => this._state().absences);

  private readonly exceptionByDate = computed(() => {
    const map = new Map<IsoDate, DateException>();
    for (const e of this._state().exceptions) map.set(e.date, e);
    return map;
  });

  /** Alle Werktage im Zeitraum, an denen tatsächlich geöffnet ist. */
  readonly openDates = computed<IsoDate[]>(() => {
    const { start, end } = this._state().period;
    const result: IsoDate[] = [];
    // Schutz vor versehentlich riesigen Zeiträumen (rund fünf Jahre).
    for (
      let date = start, guard = 0;
      date <= end && guard < 2000;
      date = addDays(date, 1), guard++
    ) {
      if (this.hoursFor(date)) result.push(date);
    }
    return result;
  });

  /**
   * Öffnungszeit eines konkreten Termins, oder `null` wenn geschlossen.
   * Reihenfolge: Wochenende → Wochentagsstandard → Ausnahme für diesen Tag.
   */
  hoursFor(date: IsoDate): { start: number; end: number } | null {
    const weekday = weekdayOf(date);
    if (weekday === null) return null;

    const base = this._state().openingHours.find((o) => o.weekday === weekday);
    const exception = this.exceptionByDate().get(date);

    if (exception?.closed) return null;
    const start = exception?.start ?? base?.start;
    const end = exception?.end ?? base?.end;
    if (start === undefined || end === undefined) return null;
    if (!exception && !base?.open) return null;
    if (end <= start) return null;
    return { start, end };
  }

  isOpenAt(date: IsoDate, hour: number): boolean {
    const hours = this.hoursFor(date);
    return !!hours && hour >= hours.start && hour < hours.end;
  }

  readonly slots = computed<Slot[]>(() => {
    const result: Slot[] = [];
    for (const date of this.openDates()) {
      const hours = this.hoursFor(date)!;
      const weekday = weekdayOf(date)!;
      for (let hour = hours.start; hour < hours.end; hour++) {
        result.push({
          date,
          weekday,
          hour,
          key: slotKey(date, hour),
          weekdayKey: weekdaySlotKey(weekday, hour),
        });
      }
    }
    return result;
  });

  /** Termine nach Kalenderwochen gruppiert, für die Wochennavigation. */
  readonly weeks = computed<WeekGroup[]>(() => {
    const groups = new Map<IsoDate, WeekGroup>();
    for (const date of this.openDates()) {
      const monday = startOfWeek(date);
      let group = groups.get(monday);
      if (!group) {
        group = {
          monday,
          week: isoWeekNumber(date),
          label: `KW ${isoWeekNumber(date)}`,
          dates: [],
        };
        groups.set(monday, group);
      }
      group.dates.push(date);
    }
    return [...groups.values()].sort((a, b) => a.monday.localeCompare(b.monday));
  });

  /** Stundenzeilen einer Woche: von der frühesten bis zur spätesten Öffnung. */
  hourRowsFor(dates: IsoDate[]): number[] {
    const ranges = dates
      .map((d) => this.hoursFor(d))
      .filter((h): h is { start: number; end: number } => !!h);
    if (!ranges.length) return [];
    const start = Math.min(...ranges.map((r) => r.start));
    const end = Math.max(...ranges.map((r) => r.end));
    return Array.from({ length: end - start }, (_, i) => start + i);
  }

  readonly assignedCount = computed(() => {
    const assignments = this._state().assignments;
    return this.slots().filter((s) => (assignments[s.key]?.length ?? 0) > 0).length;
  });

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

  // --- Verfügbarkeit --------------------------------------------------------

  /** Wochentagsantwort, unabhängig vom konkreten Termin. */
  getAvailability(assistantId: string, weekdayKey: string): Availability | undefined {
    return this._state().availability[assistantId]?.[weekdayKey];
  }

  isAbsent(assistantId: string, date: IsoDate): boolean {
    return this._state().absences.some(
      (a) => a.assistantId === assistantId && isWithin(date, a.from, a.to),
    );
  }

  /**
   * Antwort für einen konkreten Termin: die Wochentagsantwort, aber durch eine
   * eingetragene Abwesenheit überschrieben.
   */
  availabilityAt(assistantId: string, slot: Slot): Availability | undefined {
    if (this.isAbsent(assistantId, slot.date)) return 'no';
    return this.getAvailability(assistantId, slot.weekdayKey);
  }

  readonly warnings = computed<ScheduleWarning[]>(() => {
    const state = this._state();
    const result: ScheduleWarning[] = [];
    const nameOf = (id: string) => state.assistants.find((a) => a.id === id)?.name ?? 'Unbekannt';

    for (const slot of this.slots()) {
      const label = `${WEEKDAY_SHORT[slot.weekday]} ${formatDate(slot.date)} ${formatHour(slot.hour)}`;
      const assigned = state.assignments[slot.key] ?? [];

      if (!assigned.length) {
        result.push({ level: 'warn', slotKey: slot.key, message: `${label}: niemand eingeteilt.` });
        continue;
      }

      let onlyIfNeeded = true;
      for (const id of assigned) {
        if (this.isAbsent(id, slot.date)) {
          result.push({
            level: 'error',
            slotKey: slot.key,
            assistantId: id,
            message: `${label}: ${nameOf(id)} ist an diesem Tag abwesend.`,
          });
          onlyIfNeeded = false;
          continue;
        }
        const answer = this.getAvailability(id, slot.weekdayKey);
        if (answer === 'no') {
          result.push({
            level: 'error',
            slotKey: slot.key,
            assistantId: id,
            message: `${label}: ${nameOf(id)} hat hier „Nein" angegeben.`,
          });
        } else if (answer === undefined) {
          result.push({
            level: 'error',
            slotKey: slot.key,
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
        message: `${orphans.length} Zuweisung(en) liegen außerhalb der Öffnungszeiten oder des Zeitraums.`,
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

  readonly hasOrphanAssignments = computed(() => {
    const valid = new Set(this.slots().map((s) => s.key));
    return Object.entries(this._state().assignments).some(
      ([key, ids]) => ids.length && !valid.has(key),
    );
  });

  constructor() {
    effect(() => {
      const snapshot = this._state();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // Speicher voll oder blockiert: Daten bleiben in der Sitzung erhalten.
      }
    });
  }

  // --- Stammdaten -----------------------------------------------------------

  setTitle(title: string): void {
    this._state.update((s) => ({ ...s, title }));
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

  addException(date: IsoDate, note = ''): void {
    if (!isValidIso(date)) return;
    this._state.update((s) => {
      if (s.exceptions.some((e) => e.date === date)) return s;
      const exceptions = [...s.exceptions, { date, closed: true, note: note.trim() || undefined }];
      exceptions.sort((a, b) => a.date.localeCompare(b.date));
      return { ...s, exceptions };
    });
  }

  updateException(date: IsoDate, patch: Partial<DateException>): void {
    this._state.update((s) => ({
      ...s,
      exceptions: s.exceptions.map((e) => {
        if (e.date !== date) return e;
        const next = { ...e, ...patch };
        if (next.start !== undefined) next.start = clampHour(next.start);
        if (next.end !== undefined) next.end = clampHour(next.end);
        if (next.start !== undefined && next.end !== undefined && next.end <= next.start) {
          next.end = next.start + 1;
        }
        return next;
      }),
    }));
  }

  removeException(date: IsoDate): void {
    this._state.update((s) => ({
      ...s,
      exceptions: s.exceptions.filter((e) => e.date !== date),
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
      return {
        ...s,
        assistants: s.assistants.filter((a) => a.id !== id),
        absences: s.absences.filter((a) => a.assistantId !== id),
        availability,
        assignments,
      };
    });
  }

  // --- Abwesenheiten --------------------------------------------------------

  addAbsence(assistantId: string, from: IsoDate, to: IsoDate, reason = ''): void {
    if (!isValidIso(from) || !isValidIso(to)) return;
    this._state.update((s) => ({
      ...s,
      absences: [
        ...s.absences,
        {
          id: createId(),
          assistantId,
          from: from <= to ? from : to,
          to: from <= to ? to : from,
          reason: reason.trim() || undefined,
        },
      ],
    }));
  }

  removeAbsence(id: string): void {
    this._state.update((s) => ({ ...s, absences: s.absences.filter((a) => a.id !== id) }));
  }

  absencesOf(assistantId: string): Absence[] {
    return this._state()
      .absences.filter((a) => a.assistantId === assistantId)
      .sort((a, b) => a.from.localeCompare(b.from));
  }

  // --- Verfügbarkeiten ------------------------------------------------------

  setAvailability(assistantId: string, weekdayKey: string, value: Availability | undefined): void {
    this._state.update((s) => {
      const forAssistant = { ...(s.availability[assistantId] ?? {}) };
      if (value === undefined) delete forAssistant[weekdayKey];
      else forAssistant[weekdayKey] = value;
      return { ...s, availability: { ...s.availability, [assistantId]: forAssistant } };
    });
  }

  /** Klick auf eine Zelle: unbeantwortet → Ja → Wenn es sein muss → Nein → unbeantwortet. */
  cycleAvailability(assistantId: string, weekdayKey: string): void {
    const current = this.getAvailability(assistantId, weekdayKey);
    const next: Record<string, Availability | undefined> = {
      undefined: 'yes',
      yes: 'ifNeeded',
      ifNeeded: 'no',
      no: undefined,
    };
    this.setAvailability(assistantId, weekdayKey, next[String(current)]);
  }

  setAvailabilityForSlots(
    assistantId: string,
    weekdayKeys: string[],
    value: Availability | undefined,
  ): void {
    this._state.update((s) => {
      const forAssistant = { ...(s.availability[assistantId] ?? {}) };
      for (const key of weekdayKeys) {
        if (value === undefined) delete forAssistant[key];
        else forAssistant[key] = value;
      }
      return { ...s, availability: { ...s.availability, [assistantId]: forAssistant } };
    });
  }

  // --- Einteilung -----------------------------------------------------------

  assignedTo(key: string): string[] {
    return this._state().assignments[key] ?? [];
  }

  isAssigned(key: string, assistantId: string): boolean {
    return this.assignedTo(key).includes(assistantId);
  }

  toggleAssignment(key: string, assistantId: string): void {
    this._state.update((s) => {
      const current = s.assignments[key] ?? [];
      const next = current.includes(assistantId)
        ? current.filter((id) => id !== assistantId)
        : [...current, assistantId];
      const assignments = { ...s.assignments };
      if (next.length) assignments[key] = next;
      else delete assignments[key];
      return { ...s, assignments };
    });
  }

  /** Überträgt die Einteilung einer Woche auf eine andere, Stunde für Stunde. */
  copyWeek(sourceMonday: IsoDate, targetMonday: IsoDate): number {
    const offset = Math.round(
      (new Date(targetMonday).getTime() - new Date(sourceMonday).getTime()) / 86400000,
    );
    if (!offset) return 0;
    let copied = 0;
    this._state.update((s) => {
      const assignments = { ...s.assignments };
      for (const slot of this.slots()) {
        if (startOfWeek(slot.date) !== sourceMonday) continue;
        const ids = s.assignments[slot.key];
        if (!ids?.length) continue;
        const targetDate = addDays(slot.date, offset);
        if (!this.isOpenAt(targetDate, slot.hour)) continue;
        assignments[slotKey(targetDate, slot.hour)] = [...ids];
        copied++;
      }
      return { ...s, assignments };
    });
    return copied;
  }

  clearAssignments(): void {
    this._state.update((s) => ({ ...s, assignments: {} }));
  }

  clearWeek(monday: IsoDate): void {
    this._state.update((s) => {
      const assignments = { ...s.assignments };
      for (const slot of this.slots()) {
        if (startOfWeek(slot.date) === monday) delete assignments[slot.key];
      }
      return { ...s, assignments };
    });
  }

  /** Entfernt Zuweisungen, die nicht mehr im Zeitraum oder in den Öffnungszeiten liegen. */
  pruneOrphanAssignments(): void {
    const valid = new Set(this.slots().map((s) => s.key));
    this._state.update((s) => {
      const assignments: Record<string, string[]> = {};
      for (const [key, ids] of Object.entries(s.assignments)) {
        if (valid.has(key) && ids.length) assignments[key] = ids;
      }
      return { ...s, assignments };
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
