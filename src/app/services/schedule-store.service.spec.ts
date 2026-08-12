import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ScheduleStore, normalizeState } from './schedule-store.service';
import { ScheduleState, slotKey } from '../models/schedule.model';

/** Zwei volle Wochen ab Montag, 10.08.2026. */
const PERIOD = { start: '2026-08-10', end: '2026-08-23' };

function makeStore(state?: Partial<ScheduleState>): ScheduleStore {
  localStorage.clear();
  if (state) {
    localStorage.setItem('shk-dienstplan.v1', JSON.stringify({ version: 2, ...state }));
  }
  TestBed.resetTestingModule();
  return TestBed.inject(ScheduleStore);
}

function withTwoAssistants(extra: Partial<ScheduleState> = {}): Partial<ScheduleState> {
  return {
    period: PERIOD,
    openingHours: [
      { weekday: 1, open: true, start: 9, end: 12 },
      { weekday: 2, open: true, start: 9, end: 12 },
      { weekday: 3, open: true, start: 9, end: 12 },
      { weekday: 4, open: true, start: 9, end: 12 },
      { weekday: 5, open: false, start: 9, end: 12 },
    ],
    assistants: [
      { id: 'a1', name: 'Lena', color: '#2d5d8f' },
      { id: 'a2', name: 'Jonas', color: '#1f7a54' },
    ],
    ...extra,
  };
}

describe('Migration eines v1-Stands', () => {
  const v1 = {
    version: 1,
    title: 'Alter Plan',
    period: PERIOD,
    openingHours: [
      { weekday: 1, open: true, start: 9, end: 12 },
      { weekday: 2, open: true, start: 9, end: 12 },
      { weekday: 3, open: true, start: 9, end: 12 },
      { weekday: 4, open: true, start: 9, end: 12 },
      { weekday: 5, open: false, start: 9, end: 12 },
    ],
    assistants: [
      { id: 'a1', name: 'Lena', color: '#2d5d8f' },
      { id: 'a2', name: 'Jonas', color: '#1f7a54' },
    ],
    availability: { a1: { '1-9': 'yes', '3-10': 'ifNeeded' } },
    // v1 kannte nur Wochentagsschlüssel.
    assignments: { '1-9': ['a1'], '3-10': ['a1', 'a2'] },
  };

  it('hebt die Version an und behält Stammdaten', () => {
    const state = normalizeState(v1);
    expect(state.version).toBe(2);
    expect(state.title).toBe('Alter Plan');
    expect(state.assistants).toHaveLength(2);
  });

  it('lässt die Verfügbarkeiten unangetastet, weil sie wochentagsbasiert bleiben', () => {
    expect(normalizeState(v1).availability).toEqual(v1.availability);
  });

  it('überträgt die Einteilung auf jeden passenden Termin im Zeitraum', () => {
    // Ein v1-Plan war als Wiederholung gemeint: Montag 9 Uhr gilt für jeden Montag.
    const state = normalizeState(v1);
    expect(
      Object.keys(state.assignments)
        .filter((k) => k.endsWith('T09'))
        .sort(),
    ).toEqual(['2026-08-10T09', '2026-08-17T09']);
    expect(
      Object.keys(state.assignments)
        .filter((k) => k.endsWith('T10'))
        .sort(),
    ).toEqual(['2026-08-12T10', '2026-08-19T10']);
  });

  it('behält die Mehrfachbesetzung eines Slots', () => {
    expect(normalizeState(v1).assignments['2026-08-12T10']).toEqual(['a1', 'a2']);
  });

  it('legt keine Termine am Wochenende an', () => {
    const keys = Object.keys(normalizeState(v1).assignments);
    expect(keys.filter((k) => k.startsWith('2026-08-15') || k.startsWith('2026-08-16'))).toEqual(
      [],
    );
  });

  it('migriert einen v2-Stand nicht erneut', () => {
    const state = normalizeState({
      version: 2,
      assistants: [{ id: 'a1', name: 'Lena' }],
      assignments: { '2026-08-10T09': ['a1'] },
    });
    expect(state.assignments).toEqual({ '2026-08-10T09': ['a1'] });
  });
});

describe('normalizeState gegen kaputte Eingaben', () => {
  it('verkraftet null, Zeichenketten und leere Objekte', () => {
    expect(normalizeState(null).version).toBe(2);
    expect(normalizeState('kaputt').version).toBe(2);
    expect(normalizeState({}).assistants).toEqual([]);
  });

  it('dreht einen verkehrt herum eingegebenen Zeitraum nicht um, sondern begradigt ihn', () => {
    const state = normalizeState({ period: { start: '2026-09-01', end: '2026-08-01' } });
    expect(state.period.end).toBe('2026-09-01');
  });

  it('fällt bei ungültigem Datum auf den Standardzeitraum zurück', () => {
    const state = normalizeState({ period: { start: '2026-02-31', end: 'quatsch' } });
    expect(state.period.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('verwirft Zuweisungen auf gelöschte Hilfskräfte', () => {
    const state = normalizeState({
      version: 2,
      assistants: [],
      assignments: { '2026-08-10T09': ['weg'] },
    });
    expect(state.assignments).toEqual({});
  });

  it('verwirft Abwesenheiten unbekannter Hilfskräfte', () => {
    const state = normalizeState({
      version: 2,
      assistants: [],
      absences: [{ assistantId: 'x', from: '2026-08-10', to: '2026-08-11' }],
    });
    expect(state.absences).toEqual([]);
  });

  it('dreht vertauschte Grenzen einer Abwesenheit', () => {
    const state = normalizeState({
      version: 2,
      assistants: [{ id: 'a1', name: 'Lena' }],
      absences: [{ id: 'x', assistantId: 'a1', from: '2026-08-20', to: '2026-08-10' }],
    });
    expect(state.absences[0]?.from).toBe('2026-08-10');
    expect(state.absences[0]?.to).toBe('2026-08-20');
  });

  it('lässt nur eine Ausnahme pro Datum zu', () => {
    const state = normalizeState({
      version: 2,
      exceptions: [
        { date: '2026-08-10', closed: true },
        { date: '2026-08-10', closed: false },
      ],
    });
    expect(state.exceptions).toHaveLength(1);
  });
});

describe('Öffnungszeiten konkreter Termine', () => {
  it('nutzt den Wochentagsstandard', () => {
    const store = makeStore(withTwoAssistants());
    expect(store.hoursFor('2026-08-10')).toEqual({ start: 9, end: 12 });
  });

  it('liefert null am Wochenende', () => {
    const store = makeStore(withTwoAssistants());
    expect(store.hoursFor('2026-08-15')).toBeNull();
  });

  it('liefert null an einem geschlossenen Wochentag', () => {
    const store = makeStore(withTwoAssistants());
    expect(store.hoursFor('2026-08-14')).toBeNull();
  });

  it('lässt eine Ausnahme den Standard schlagen', () => {
    const store = makeStore(
      withTwoAssistants({ exceptions: [{ date: '2026-08-10', closed: true, note: 'Feiertag' }] }),
    );
    expect(store.hoursFor('2026-08-10')).toBeNull();
    // Der Folgemontag bleibt unberührt.
    expect(store.hoursFor('2026-08-17')).toEqual({ start: 9, end: 12 });
  });

  it('erlaubt abweichende Zeiten an einem einzelnen Termin', () => {
    const store = makeStore(
      withTwoAssistants({
        exceptions: [{ date: '2026-08-11', closed: false, start: 10, end: 14 }],
      }),
    );
    expect(store.hoursFor('2026-08-11')).toEqual({ start: 10, end: 14 });
  });

  it('lässt eine Ausnahme auch an einem sonst geschlossenen Wochentag öffnen', () => {
    const store = makeStore(
      withTwoAssistants({ exceptions: [{ date: '2026-08-14', closed: false, start: 9, end: 11 }] }),
    );
    expect(store.hoursFor('2026-08-14')).toEqual({ start: 9, end: 11 });
  });
});

describe('Termine und Wochen', () => {
  it('zählt nur Öffnungstage', () => {
    const store = makeStore(withTwoAssistants());
    // Mo–Do in zwei Wochen, Freitag geschlossen.
    expect(store.openDates()).toHaveLength(8);
    expect(store.slots()).toHaveLength(8 * 3);
  });

  it('lässt einen Feiertag aus dem Raster fallen', () => {
    const store = makeStore(
      withTwoAssistants({ exceptions: [{ date: '2026-08-10', closed: true }] }),
    );
    expect(store.openDates()).toHaveLength(7);
    expect(store.openDates()).not.toContain('2026-08-10');
  });

  it('gruppiert die Termine nach Kalenderwochen', () => {
    const store = makeStore(withTwoAssistants());
    const weeks = store.weeks();
    expect(weeks).toHaveLength(2);
    expect(weeks[0]?.monday).toBe('2026-08-10');
    expect(weeks[1]?.monday).toBe('2026-08-17');
    expect(weeks[0]?.dates).toHaveLength(4);
  });
});

describe('Abwesenheiten', () => {
  it('überschreiben die Wochentagsantwort', () => {
    const store = makeStore(
      withTwoAssistants({
        availability: { a1: { '1-9': 'yes' } },
        absences: [{ id: 'x', assistantId: 'a1', from: '2026-08-10', to: '2026-08-10' }],
      }),
    );
    const slot = store.slots().find((s) => s.key === '2026-08-10T09')!;
    // Die Wochentagsantwort bleibt bestehen ...
    expect(store.getAvailability('a1', '1-9')).toBe('yes');
    // ... aber für diesen Termin gilt sie nicht.
    expect(store.availabilityAt('a1', slot)).toBe('no');
    expect(store.isAbsent('a1', '2026-08-10')).toBe(true);
    expect(store.isAbsent('a1', '2026-08-17')).toBe(false);
  });
});

describe('Warnungen', () => {
  it('meldet unbesetzte Stunden', () => {
    const store = makeStore(withTwoAssistants());
    expect(store.warnings().every((w) => w.level === 'warn')).toBe(true);
    expect(store.warnings()).toHaveLength(24);
  });

  it('meldet eine Einteilung gegen ein Nein als Fehler', () => {
    const store = makeStore(
      withTwoAssistants({
        availability: { a1: { '1-9': 'no' } },
        assignments: { '2026-08-10T09': ['a1'] },
      }),
    );
    const forSlot = store.warningsBySlot().get('2026-08-10T09') ?? [];
    expect(forSlot.some((w) => w.level === 'error')).toBe(true);
  });

  it('meldet eine Einteilung trotz Abwesenheit als Fehler', () => {
    const store = makeStore(
      withTwoAssistants({
        availability: { a1: { '1-9': 'yes' } },
        absences: [{ id: 'x', assistantId: 'a1', from: '2026-08-10', to: '2026-08-12' }],
        assignments: { '2026-08-10T09': ['a1'] },
      }),
    );
    const forSlot = store.warningsBySlot().get('2026-08-10T09') ?? [];
    expect(forSlot.some((w) => w.level === 'error' && w.message.includes('abwesend'))).toBe(true);
  });

  it('meldet eine nur notfalls besetzte Stunde als Hinweis', () => {
    const store = makeStore(
      withTwoAssistants({
        availability: { a1: { '1-9': 'ifNeeded' } },
        assignments: { '2026-08-10T09': ['a1'] },
      }),
    );
    const forSlot = store.warningsBySlot().get('2026-08-10T09') ?? [];
    expect(forSlot.some((w) => w.level === 'info')).toBe(true);
  });

  it('schweigt, wenn ein Ja-Kandidat mit dabei ist', () => {
    const store = makeStore(
      withTwoAssistants({
        availability: { a1: { '1-9': 'ifNeeded' }, a2: { '1-9': 'yes' } },
        assignments: { '2026-08-10T09': ['a1', 'a2'] },
      }),
    );
    expect(store.warningsBySlot().get('2026-08-10T09')).toBeUndefined();
  });
});

describe('Wochen kopieren', () => {
  let store: ScheduleStore;

  beforeEach(() => {
    store = makeStore(
      withTwoAssistants({
        availability: { a1: { '1-9': 'yes' }, a2: { '2-9': 'yes' } },
        assignments: { '2026-08-10T09': ['a1'], '2026-08-11T09': ['a2'] },
      }),
    );
  });

  it('überträgt die Einteilung auf die Zielwoche', () => {
    expect(store.copyWeek('2026-08-10', '2026-08-17')).toBe(2);
    expect(store.assignedTo('2026-08-17T09')).toEqual(['a1']);
    expect(store.assignedTo('2026-08-18T09')).toEqual(['a2']);
  });

  it('lässt die Quellwoche unverändert', () => {
    store.copyWeek('2026-08-10', '2026-08-17');
    expect(store.assignedTo('2026-08-10T09')).toEqual(['a1']);
  });

  it('überträgt nichts auf sich selbst', () => {
    expect(store.copyWeek('2026-08-10', '2026-08-10')).toBe(0);
  });

  it('überspringt Termine, die in der Zielwoche geschlossen sind', () => {
    // Der Zielmontag ist Feiertag: seine Stunde darf nicht angelegt werden.
    const withHoliday = makeStore(
      withTwoAssistants({
        exceptions: [{ date: '2026-08-17', closed: true }],
        availability: { a1: { '1-9': 'yes' }, a2: { '2-9': 'yes' } },
        assignments: { '2026-08-10T09': ['a1'], '2026-08-11T09': ['a2'] },
      }),
    );
    expect(withHoliday.copyWeek('2026-08-10', '2026-08-17')).toBe(1);
    expect(withHoliday.assignedTo('2026-08-17T09')).toEqual([]);
    expect(withHoliday.assignedTo('2026-08-18T09')).toEqual(['a2']);
  });
});

describe('Aufräumen', () => {
  it('entfernt Zuweisungen außerhalb des Zeitraums', () => {
    const store = makeStore(
      withTwoAssistants({
        assignments: { '2026-08-10T09': ['a1'], '2026-12-24T09': ['a1'] },
      }),
    );
    expect(store.hasOrphanAssignments()).toBe(true);
    store.pruneOrphanAssignments();
    expect(store.hasOrphanAssignments()).toBe(false);
    expect(store.assignedTo('2026-08-10T09')).toEqual(['a1']);
  });

  it('räumt beim Entfernen einer Hilfskraft alles mit weg', () => {
    const store = makeStore(
      withTwoAssistants({
        availability: { a1: { '1-9': 'yes' } },
        absences: [{ id: 'x', assistantId: 'a1', from: '2026-08-10', to: '2026-08-11' }],
        assignments: { '2026-08-10T09': ['a1', 'a2'] },
      }),
    );
    store.removeAssistant('a1');
    expect(store.assistants()).toHaveLength(1);
    expect(store.absences()).toEqual([]);
    // Der Slot bleibt bestehen, aber ohne die entfernte Person.
    expect(store.assignedTo('2026-08-10T09')).toEqual(['a2']);
  });

  it('leert nur die angegebene Woche', () => {
    const store = makeStore(
      withTwoAssistants({
        assignments: { '2026-08-10T09': ['a1'], '2026-08-17T09': ['a2'] },
      }),
    );
    store.clearWeek('2026-08-10');
    expect(store.assignedTo('2026-08-10T09')).toEqual([]);
    expect(store.assignedTo('2026-08-17T09')).toEqual(['a2']);
  });
});

describe('Einteilung', () => {
  it('schaltet eine Hilfskraft an und wieder aus', () => {
    const store = makeStore(withTwoAssistants());
    const key = slotKey('2026-08-10', 9);
    store.toggleAssignment(key, 'a1');
    expect(store.isAssigned(key, 'a1')).toBe(true);
    store.toggleAssignment(key, 'a1');
    expect(store.isAssigned(key, 'a1')).toBe(false);
  });

  it('erlaubt mehrere Hilfskräfte im selben Slot', () => {
    const store = makeStore(withTwoAssistants());
    const key = slotKey('2026-08-10', 9);
    store.toggleAssignment(key, 'a1');
    store.toggleAssignment(key, 'a2');
    expect(store.assignedTo(key)).toEqual(['a1', 'a2']);
  });

  it('zählt die Stunden je Hilfskraft', () => {
    const store = makeStore(
      withTwoAssistants({
        assignments: { '2026-08-10T09': ['a1', 'a2'], '2026-08-10T10': ['a1'] },
      }),
    );
    expect(store.hoursByAssistant()).toEqual({ a1: 2, a2: 1 });
  });
});

describe('Verfügbarkeiten', () => {
  it('durchläuft die Zustände im Kreis', () => {
    const store = makeStore(withTwoAssistants());
    expect(store.getAvailability('a1', '1-9')).toBeUndefined();
    store.cycleAvailability('a1', '1-9');
    expect(store.getAvailability('a1', '1-9')).toBe('yes');
    store.cycleAvailability('a1', '1-9');
    expect(store.getAvailability('a1', '1-9')).toBe('ifNeeded');
    store.cycleAvailability('a1', '1-9');
    expect(store.getAvailability('a1', '1-9')).toBe('no');
    store.cycleAvailability('a1', '1-9');
    expect(store.getAvailability('a1', '1-9')).toBeUndefined();
  });
});
