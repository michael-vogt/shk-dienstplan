export const WEEKDAYS = [1, 2, 3, 4, 5] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: 'Montag',
  2: 'Dienstag',
  3: 'Mittwoch',
  4: 'Donnerstag',
  5: 'Freitag',
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  1: 'Mo',
  2: 'Di',
  3: 'Mi',
  4: 'Do',
  5: 'Fr',
};

/** Antwortmöglichkeiten der Hilfskräfte auf die Verfügbarkeitsabfrage. */
export type Availability = 'yes' | 'ifNeeded' | 'no';

export const AVAILABILITY_ORDER: Availability[] = ['yes', 'ifNeeded', 'no'];

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  yes: 'Ja',
  ifNeeded: 'Wenn es sein muss',
  no: 'Nein',
};

/**
 * Ein Dienstplan ist entweder ein Semesterplan oder ein Ferienplan.
 * Semester: genau ein Wochenplan, wiederkehrend, ohne Datumsbezug.
 * Ferien:   ein Wochenplan je Kalenderwoche im gewählten Zeitraum.
 */
export type PlanMode = 'semester' | 'break';

export const PLAN_MODE_LABELS: Record<PlanMode, string> = {
  semester: 'Semester',
  break: 'Vorlesungsfreie Zeit',
};

/** Datum im Format `YYYY-MM-DD`, immer als lokaler Kalendertag interpretiert. */
export type IsoDate = string;

export interface Period {
  start: IsoDate;
  end: IsoDate;
}

/**
 * Schlüssel eines Wochenplans: im Semestermodus die Konstante `semester`,
 * im Ferienmodus der Montag der Kalenderwoche.
 */
export type WeekKey = string;

export const SEMESTER_WEEK: WeekKey = 'semester';

export interface OpeningHours {
  weekday: Weekday;
  open: boolean;
  /** Erste Stunde, inklusive. 9 bedeutet: der Slot 9–10 Uhr gehört dazu. */
  start: number;
  /** Letzte Stunde, exklusive. 18 bedeutet: der Slot 17–18 Uhr ist der letzte. */
  end: number;
}

/** Stelle im Wochenraster, unabhängig von der Woche: `weekday-hour`. */
export type WeekdaySlotKey = string;

/** Zeitslot innerhalb eines bestimmten Wochenplans: `weekKey|weekday-hour`. */
export type SlotKey = string;

export function weekdaySlotKey(weekday: Weekday, hour: number): WeekdaySlotKey {
  return `${weekday}-${hour}`;
}

export function slotKey(week: WeekKey, weekday: Weekday, hour: number): SlotKey {
  return `${week}|${weekdaySlotKey(weekday, hour)}`;
}

export interface Slot {
  week: WeekKey;
  weekday: Weekday;
  hour: number;
  key: SlotKey;
  weekdayKey: WeekdaySlotKey;
  /** Konkreter Kalendertag im Ferienmodus, im Semestermodus null. */
  date: IsoDate | null;
}

/** Ein Wochenplan: im Semestermodus der einzige, im Ferienmodus einer von vielen. */
export interface WeekPlan {
  key: WeekKey;
  label: string;
  monday: IsoDate | null;
  /** Kalendertage der geöffneten Wochentage, im Semestermodus leer. */
  dates: { weekday: Weekday; date: IsoDate }[];
}

/**
 * Urlaub einer Hilfskraft, beide Grenzen inklusive. Nur im Ferienplan
 * wirksam, weil nur dort Slots einem konkreten Kalendertag entsprechen —
 * der Semesterplan ist eine datumslose Musterwoche.
 */
export interface Vacation {
  id: string;
  assistantId: string;
  from: IsoDate;
  to: IsoDate;
  note?: string;
}

export interface Assistant {
  id: string;
  name: string;
  color: string;
  note?: string;
}

export interface ScheduleState {
  version: 5;
  title: string;
  mode: PlanMode;
  /** Nur im Ferienmodus ausgewertet. */
  period: Period;
  openingHours: OpeningHours[];
  assistants: Assistant[];
  vacations: Vacation[];
  /** assistantId -> SlotKey -> Antwort. */
  availability: Record<string, Record<SlotKey, Availability>>;
  /** SlotKey -> eingeteilte assistantIds. */
  assignments: Record<SlotKey, string[]>;
}

export type WarningLevel = 'error' | 'warn' | 'info';

export interface ScheduleWarning {
  level: WarningLevel;
  message: string;
  slotKey?: SlotKey;
  week?: WeekKey;
  assistantId?: string;
}

/**
 * Zielstunden einer verschobenen Schicht innerhalb eines Tages.
 *
 * `available` sind die geöffneten Stunden des Zieltags (aufsteigend), `length`
 * die Länge der Schicht und `grabOffset` die angefasste Stelle darin. Passt
 * die Schicht nicht mehr ans Tagesende, wird sie nach vorn geschoben statt
 * abgeschnitten — eine Vierstundenschicht soll eine Vierstundenschicht
 * bleiben. Nur wenn der Tag insgesamt kürzer ist, bleibt eine Kürzung übrig.
 */
export function shiftBlockHours(
  available: number[],
  length: number,
  grabOffset: number,
  dropHour: number,
): number[] {
  if (!available.length || length < 1) return [];
  const sorted = [...available].sort((a, b) => a - b);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  let start = dropHour - Math.max(0, grabOffset);
  start = Math.max(first, Math.min(start, last - length + 1));

  const result: number[] = [];
  for (let hour = start; hour < start + length; hour++) {
    if (sorted.includes(hour)) result.push(hour);
  }
  return result;
}

// --- Datumsrechnung ---------------------------------------------------------
// Bewusst ohne Bibliothek und ohne UTC: alle Termine sind lokale Kalendertage.
// Eine Zeitzonenumrechnung würde hier nur Verschiebungen um einen Tag einführen.

export function toIso(date: Date): IsoDate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromIso(iso: IsoDate): Date {
  const parts = iso.split('-').map(Number);
  return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
}

export function isValidIso(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = fromIso(value);
  return !Number.isNaN(date.getTime()) && toIso(date) === value;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = fromIso(iso);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

/** Wochentag als 1–5 für Mo–Fr, `null` am Wochenende. */
export function weekdayOf(iso: IsoDate): Weekday | null {
  const day = fromIso(iso).getDay();
  return day >= 1 && day <= 5 ? (day as Weekday) : null;
}

/** Montag der Woche, in der das Datum liegt. */
export function startOfWeek(iso: IsoDate): IsoDate {
  const date = fromIso(iso);
  const shift = (date.getDay() + 6) % 7;
  return addDays(iso, -shift);
}

/** Kalenderwoche nach ISO 8601. */
export function isoWeekNumber(iso: IsoDate): number {
  const date = fromIso(iso);
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  thursday.setDate(thursday.getDate() + 3 - ((thursday.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  const diff = thursday.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
}

export function formatDate(iso: IsoDate): string {
  const date = fromIso(iso);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`;
}

export function formatDateLong(iso: IsoDate): string {
  const date = fromIso(iso);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function isWithin(iso: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return iso >= from && iso <= to;
}
