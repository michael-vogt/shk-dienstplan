import { describe, expect, it } from 'vitest';
import {
  SEMESTER_WEEK,
  addDays,
  fromIso,
  isValidIso,
  isoWeekNumber,
  slotKey,
  startOfWeek,
  toIso,
  weekdayOf,
  weekdaySlotKey,
} from './schedule.model';

describe('addDays', () => {
  it('rechnet über den Beginn der Sommerzeit hinweg', () => {
    // 29.03.2026 ist die kurze Nacht. Eine Rechnung über UTC-Millisekunden
    // würde hier auf den 30.03. statt den 31.03. kommen.
    expect(addDays('2026-03-28', 3)).toBe('2026-03-31');
  });

  it('rechnet über das Ende der Sommerzeit hinweg', () => {
    expect(addDays('2026-10-24', 3)).toBe('2026-10-27');
  });

  it('rechnet über den Jahreswechsel', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('kennt den Schalttag', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('rechnet auch rückwärts', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('weekdayOf', () => {
  it('liefert 1 bis 5 für Montag bis Freitag', () => {
    expect(weekdayOf('2026-08-10')).toBe(1);
    expect(weekdayOf('2026-08-14')).toBe(5);
  });

  it('liefert null am Wochenende', () => {
    expect(weekdayOf('2026-08-15')).toBeNull();
    expect(weekdayOf('2026-08-16')).toBeNull();
  });
});

describe('startOfWeek', () => {
  it('liefert den Montag der Woche', () => {
    expect(startOfWeek('2026-08-12')).toBe('2026-08-10');
    expect(startOfWeek('2026-08-10')).toBe('2026-08-10');
  });

  it('ordnet den Sonntag der ablaufenden Woche zu, nicht der folgenden', () => {
    expect(startOfWeek('2026-08-16')).toBe('2026-08-10');
  });
});

describe('isoWeekNumber', () => {
  it('zählt eine normale Woche', () => {
    expect(isoWeekNumber('2026-08-12')).toBe(33);
  });

  it('ordnet den 1. Januar korrekt ein', () => {
    // 2026 beginnt an einem Donnerstag, gehört also in KW 1.
    expect(isoWeekNumber('2026-01-01')).toBe(1);
    // 2027 beginnt an einem Freitag, gehört noch in die letzte Woche von 2026.
    expect(isoWeekNumber('2027-01-01')).toBe(53);
  });

  it('ordnet den Jahresausklang korrekt ein', () => {
    expect(isoWeekNumber('2026-12-31')).toBe(53);
  });
});

describe('isValidIso', () => {
  it('nimmt gültige Kalendertage an', () => {
    expect(isValidIso('2026-02-28')).toBe(true);
    expect(isValidIso('2028-02-29')).toBe(true);
  });

  it('weist nicht existierende Tage ab', () => {
    // Ohne Gegenprobe würde der 31. Februar still zum 3. März werden.
    expect(isValidIso('2026-02-31')).toBe(false);
    expect(isValidIso('2027-02-29')).toBe(false);
  });

  it('weist Unsinn ab', () => {
    expect(isValidIso('irgendwas')).toBe(false);
    expect(isValidIso('')).toBe(false);
    expect(isValidIso(null)).toBe(false);
    expect(isValidIso(20260812)).toBe(false);
  });
});

describe('Slotschlüssel', () => {
  it('setzt sich aus Wochenplan und Stelle im Raster zusammen', () => {
    expect(slotKey(SEMESTER_WEEK, 1, 9)).toBe('semester|1-9');
    expect(slotKey('2026-08-10', 1, 9)).toBe('2026-08-10|1-9');
  });

  it('hält die Stelle im Raster für sich abrufbar', () => {
    // Darauf beruht das Übertragen zwischen Wochen: gleiche Stelle, andere Woche.
    expect(weekdaySlotKey(1, 14)).toBe('1-14');
  });

  it('trennt Wochen sauber voneinander', () => {
    expect(slotKey('2026-08-10', 1, 9)).not.toBe(slotKey('2026-08-17', 1, 9));
  });
});


describe('toIso und fromIso', () => {
  it('sind zueinander invers', () => {
    expect(toIso(fromIso('2026-08-12'))).toBe('2026-08-12');
  });

  it('interpretiert lokal, nicht in UTC', () => {
    // fromIso darf keinen Zeitzonenversatz einbauen, sonst verschiebt sich
    // das Datum in Zeitzonen östlich von Greenwich um einen Tag.
    const date = fromIso('2026-08-12');
    expect(date.getDate()).toBe(12);
    expect(date.getMonth()).toBe(7);
    expect(date.getHours()).toBe(0);
  });
});
