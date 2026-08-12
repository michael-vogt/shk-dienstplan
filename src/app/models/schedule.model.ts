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

/** Datum im Format `YYYY-MM-DD`, immer als lokaler Kalendertag interpretiert. */
export type IsoDate = string;

export interface Period {
  start: IsoDate;
  end: IsoDate;
}

export interface OpeningHours {
  weekday: Weekday;
  open: boolean;
  /** Erste Stunde, inklusive. 9 bedeutet: der Slot 9–10 Uhr gehört dazu. */
  start: number;
  /** Letzte Stunde, exklusive. 18 bedeutet: der Slot 17–18 Uhr ist der letzte. */
  end: number;
}

/**
 * Abweichung an einem einzelnen Termin: Feiertag, Brückentag, verkürzte
 * Öffnung in der vorlesungsfreien Zeit. Ohne `start`/`end` gilt der
 * Wochentagsstandard, `closed` schlägt beides.
 */
export interface DateException {
  date: IsoDate;
  closed: boolean;
  start?: number;
  end?: number;
  note?: string;
}

/** Abwesenheit einer Hilfskraft, beide Grenzen inklusive. */
export interface Absence {
  id: string;
  assistantId: string;
  from: IsoDate;
  to: IsoDate;
  reason?: string;
}

/** Schlüssel eines konkreten Zeitslots, Format `YYYY-MM-DDTHH`. */
export type SlotKey = string;

/** Schlüssel im Wochenraster der Verfügbarkeiten, Format `weekday-hour`. */
export type WeekdaySlotKey = string;

export function slotKey(date: IsoDate, hour: number): SlotKey {
  return `${date}T${String(hour).padStart(2, '0')}`;
}

export function weekdaySlotKey(weekday: Weekday, hour: number): WeekdaySlotKey {
  return `${weekday}-${hour}`;
}

export interface Slot {
  date: IsoDate;
  weekday: Weekday;
  hour: number;
  key: SlotKey;
  weekdayKey: WeekdaySlotKey;
}

export interface Assistant {
  id: string;
  name: string;
  color: string;
  note?: string;
}

export interface ScheduleState {
  version: 2;
  title: string;
  period: Period;
  openingHours: OpeningHours[];
  exceptions: DateException[];
  assistants: Assistant[];
  absences: Absence[];
  /**
   * assistantId -> weekdaySlotKey -> Antwort. Bewusst wochentagsbasiert: die
   * Hilfskräfte geben ihre Zeiten wiederkehrend an, nicht je Kalendertag.
   */
  availability: Record<string, Record<WeekdaySlotKey, Availability>>;
  /** slotKey (konkreter Termin) -> eingeteilte assistantIds. */
  assignments: Record<SlotKey, string[]>;
}

export type WarningLevel = 'error' | 'warn' | 'info';

export interface ScheduleWarning {
  level: WarningLevel;
  message: string;
  slotKey?: SlotKey;
  assistantId?: string;
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

export function formatSlot(slot: Slot): string {
  return `${WEEKDAY_SHORT[slot.weekday]} ${formatDate(slot.date)} ${formatHour(slot.hour)}`;
}

export function isWithin(iso: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return iso >= from && iso <= to;
}
