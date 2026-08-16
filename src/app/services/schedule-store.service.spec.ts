import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ScheduleStore, normalizeState } from './schedule-store.service';
import { ScheduleState, slotKey } from '../models/schedule.model';

/** Zwei volle Wochen ab Montag, 10.08.2026. */
const PERIOD = { start: '2026-08-10', end: '2026-08-23' };

const OPENING = [
  { weekday: 1 as const, open: true, start: 9, end: 12 },
  { weekday: 2 as const, open: true, start: 9, end: 12 },
  { weekday: 3 as const, open: true, start: 9, end: 12 },
  { weekday: 4 as const, open: true, start: 9, end: 12 },
  { weekday: 5 as const, open: false, start: 9, end: 12 },
];

const STAFF = [
  { id: 'a1', name: 'Lena', color: '#2d5d8f' },
  { id: 'a2', name: 'Jonas', color: '#1f7a54' },
];

function makeStore(state?: Partial<ScheduleState>): ScheduleStore {
  localStorage.clear();
  if (state) {
    localStorage.setItem('shk-dienstplan.v1', JSON.stringify({ version: 4, ...state }));
  }
  TestBed.resetTestingModule();
  return TestBed.inject(ScheduleStore);
}

function semester(extra: Partial<ScheduleState> = {}): Partial<ScheduleState> {
  return { mode: 'semester', openingHours: OPENING, assistants: STAFF, ...extra };
}

function breakPlan(extra: Partial<ScheduleState> = {}): Partial<ScheduleState> {
  return {
    mode: 'break',
    period: PERIOD,
    openingHours: OPENING,
    assistants: STAFF,
    ...extra,
  };
}

describe('Wochenpläne im Semestermodus', () => {
  it('besteht aus genau einem Plan ohne Datumsbezug', () => {
    const store = makeStore(semester());
    const plans = store.weekPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0]?.key).toBe('semester');
    expect(plans[0]?.monday).toBeNull();
    expect(plans[0]?.dates).toEqual([]);
  });

  it('erzeugt die Slots der Musterwoche', () => {
    const store = makeStore(semester());
    // Mo–Do je drei Stunden, Freitag geschlossen.
    expect(store.slots()).toHaveLength(12);
    expect(store.slotsPerWeek()).toBe(12);
    expect(store.slots().every((s) => s.date === null)).toBe(true);
    expect(store.slots()[0]?.key).toBe('semester|1-9');
  });
});

describe('Wochenpläne im Ferienmodus', () => {
  it('erzeugt einen Plan je Kalenderwoche', () => {
    const store = makeStore(breakPlan());
    const plans = store.weekPlans();
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.key)).toEqual(['2026-08-10', '2026-08-17']);
    expect(plans[0]?.label).toBe('KW 33');
  });

  it('hängt an jeden Wochentag den Kalendertag', () => {
    const store = makeStore(breakPlan());
    expect(store.dateOf('2026-08-10', 1)).toBe('2026-08-10');
    expect(store.dateOf('2026-08-10', 4)).toBe('2026-08-13');
    // Freitag ist geschlossen, also kein Datum.
    expect(store.dateOf('2026-08-10', 5)).toBeNull();
  });

  it('schneidet angebrochene Wochen am Zeitraum ab', () => {
    // Zeitraum beginnt am Mittwoch: Mo und Di gehören nicht dazu.
    const store = makeStore(breakPlan({ period: { start: '2026-08-12', end: '2026-08-13' } }));
    const plans = store.weekPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0]?.dates.map((d) => d.date)).toEqual(['2026-08-12', '2026-08-13']);
    expect(store.slots()).toHaveLength(6);
  });

  it('lässt Wochen ohne Öffnungstag ganz weg', () => {
    // Zeitraum umfasst nur ein Wochenende.
    const store = makeStore(breakPlan({ period: { start: '2026-08-15', end: '2026-08-16' } }));
    expect(store.weekPlans()).toEqual([]);
  });
});

describe('Verfügbarkeit je Wochenplan', () => {
  it('trennt die Angaben verschiedener Wochen', () => {
    const store = makeStore(breakPlan());
    store.setAvailability('a1', '2026-08-10|1-9', 'yes');
    expect(store.getAvailability('a1', '2026-08-10|1-9')).toBe('yes');
    // Dieselbe Stelle in der Folgewoche bleibt unbeantwortet.
    expect(store.getAvailability('a1', '2026-08-17|1-9')).toBeUndefined();
  });

  it('zählt den Beantwortungsstand je Woche', () => {
    const store = makeStore(breakPlan());
    store.setAvailability('a1', '2026-08-10|1-9', 'yes');
    expect(store.answeredCount('a1', '2026-08-10')).toBe(1);
    expect(store.answeredCount('a1', '2026-08-17')).toBe(0);
  });

  it('durchläuft die Zustände im Kreis', () => {
    const store = makeStore(semester());
    const key = 'semester|1-9';
    expect(store.getAvailability('a1', key)).toBeUndefined();
    store.cycleAvailability('a1', key);
    expect(store.getAvailability('a1', key)).toBe('yes');
    store.cycleAvailability('a1', key);
    expect(store.getAvailability('a1', key)).toBe('ifNeeded');
    store.cycleAvailability('a1', key);
    expect(store.getAvailability('a1', key)).toBe('no');
    store.cycleAvailability('a1', key);
    expect(store.getAvailability('a1', key)).toBeUndefined();
  });

  it('überträgt Angaben von einer Woche in eine andere', () => {
    const store = makeStore(breakPlan());
    store.setAvailability('a1', '2026-08-10|1-9', 'yes');
    store.setAvailability('a1', '2026-08-10|2-10', 'ifNeeded');
    expect(store.copyAvailability('a1', '2026-08-10', '2026-08-17')).toBe(2);
    expect(store.getAvailability('a1', '2026-08-17|1-9')).toBe('yes');
    expect(store.getAvailability('a1', '2026-08-17|2-10')).toBe('ifNeeded');
    // Die Quellwoche bleibt unverändert.
    expect(store.getAvailability('a1', '2026-08-10|1-9')).toBe('yes');
  });

  it('überträgt nichts auf sich selbst', () => {
    const store = makeStore(breakPlan());
    store.setAvailability('a1', '2026-08-10|1-9', 'yes');
    expect(store.copyAvailability('a1', '2026-08-10', '2026-08-10')).toBe(0);
  });

  it('betrifft beim Übertragen nur die angegebene Hilfskraft', () => {
    const store = makeStore(breakPlan());
    store.setAvailability('a1', '2026-08-10|1-9', 'yes');
    store.copyAvailability('a1', '2026-08-10', '2026-08-17');
    expect(store.getAvailability('a2', '2026-08-17|1-9')).toBeUndefined();
  });

  it('überträgt eine Woche in einem Rutsch auf alle anderen', () => {
    // Drei Wochen: 10.08., 17.08., 24.08.
    const store = makeStore(
      breakPlan({ period: { start: '2026-08-10', end: '2026-08-28' } }),
    );
    store.setAvailability('a1', '2026-08-10|1-9', 'yes');
    store.setAvailability('a1', '2026-08-10|2-9', 'ifNeeded');

    const result = store.copyAvailabilityToAllWeeks('a1', '2026-08-10');

    expect(result).toEqual({ weeks: 2, slots: 4 });
    expect(store.getAvailability('a1', '2026-08-17|1-9')).toBe('yes');
    expect(store.getAvailability('a1', '2026-08-17|2-9')).toBe('ifNeeded');
    expect(store.getAvailability('a1', '2026-08-24|1-9')).toBe('yes');
    expect(store.getAvailability('a1', '2026-08-24|2-9')).toBe('ifNeeded');
  });

  it('überschreibt beim Übertragen auf alle Wochen bestehende Antworten dort', () => {
    const store = makeStore(
      breakPlan({ period: { start: '2026-08-10', end: '2026-08-28' } }),
    );
    store.setAvailability('a1', '2026-08-10|1-9', 'yes');
    store.setAvailability('a1', '2026-08-17|1-9', 'no'); // soll überschrieben werden

    store.copyAvailabilityToAllWeeks('a1', '2026-08-10');

    expect(store.getAvailability('a1', '2026-08-17|1-9')).toBe('yes');
  });

  it('lässt andere Hilfskräfte bei der Übertragung auf alle Wochen unberührt', () => {
    const store = makeStore(
      breakPlan({ period: { start: '2026-08-10', end: '2026-08-28' } }),
    );
    store.setAvailability('a1', '2026-08-10|1-9', 'yes');
    store.setAvailability('a2', '2026-08-10|1-9', 'yes');

    store.copyAvailabilityToAllWeeks('a1', '2026-08-10');

    expect(store.getAvailability('a2', '2026-08-17|1-9')).toBeUndefined();
  });

  it('meldet keine übertragenen Wochen, wenn die Quellwoche leer ist', () => {
    const store = makeStore(
      breakPlan({ period: { start: '2026-08-10', end: '2026-08-28' } }),
    );
    const result = store.copyAvailabilityToAllWeeks('a1', '2026-08-10');
    expect(result).toEqual({ weeks: 0, slots: 0 });
  });

  it('zählt eine Woche nur, wenn dort auch tatsächlich etwas übertragen wurde', () => {
    // Bei zwei Wochen mit nur einer Antwort in der Quelle darf sich die
    // Wochenzahl nicht an der Zahl der Zielwochen orientieren, sondern nur
    // an denen, die wirklich eine Antwort erhalten haben.
    const store = makeStore(
      breakPlan({ period: { start: '2026-08-10', end: '2026-08-28' } }),
    );
    store.setAvailability('a1', '2026-08-10|1-9', 'yes');
    const result = store.copyAvailabilityToAllWeeks('a1', '2026-08-10');
    expect(result.weeks).toBe(2);
    expect(result.slots).toBe(2);
  });
});

describe('Grundverfügbarkeit je Slot (Wochenübersicht)', () => {
  it('zählt Ja und Wenn-es-sein-muss, aber nicht Nein oder unbeantwortet', () => {
    const store = makeStore(
      semester({
        availability: {
          a1: { 'semester|1-9': 'yes' },
          a2: { 'semester|1-9': 'ifNeeded' },
        },
      }),
    );
    expect(store.availableCount('semester|1-9', null)).toBe(2);
    expect(store.availableCount('semester|1-10', null)).toBe(0);
  });

  it('zählt Nein nicht mit', () => {
    const store = makeStore(semester({ availability: { a1: { 'semester|1-9': 'no' } } }));
    expect(store.availableCount('semester|1-9', null)).toBe(0);
  });

  it('lässt eine Hilfskraft mit Urlaub an diesem Tag nicht mitzählen', () => {
    // Der Urlaub schlägt eine vorher eingetragene Ja-Antwort.
    const store = makeStore(
      breakPlan({ availability: { a1: { '2026-08-10|1-9': 'yes' } } }),
    );
    store.addVacation('a1', '2026-08-10', '2026-08-10');
    expect(store.availableCount('2026-08-10|1-9', '2026-08-10')).toBe(0);
  });

  it('lässt Urlaub an anderen Tagen unberührt', () => {
    const store = makeStore(
      breakPlan({ availability: { a1: { '2026-08-10|1-9': 'yes', '2026-08-10|2-9': 'yes' } } }),
    );
    store.addVacation('a1', '2026-08-10', '2026-08-10');
    // Dienstag derselben Woche ist von einem Montagsurlaub nicht betroffen.
    expect(store.availableCount('2026-08-10|2-9', '2026-08-11')).toBe(1);
  });

  it('ignoriert Urlaub im Semesterplan, da dort kein Datum vorliegt', () => {
    const store = makeStore(semester({ availability: { a1: { 'semester|1-9': 'yes' } } }));
    store.addVacation('a1', '2026-08-10', '2026-08-10');
    // Ohne Kalendertag (date === null) kann Urlaub nicht greifen.
    expect(store.availableCount('semester|1-9', null)).toBe(1);
  });
});

describe('Einteilung', () => {
  it('trennt die Wochen im Ferienmodus', () => {
    const store = makeStore(breakPlan());
    store.toggleAssignment('2026-08-10|1-9', 'a1');
    expect(store.assignedTo('2026-08-10|1-9')).toEqual(['a1']);
    expect(store.assignedTo('2026-08-17|1-9')).toEqual([]);
  });

  it('erlaubt mehrere Hilfskräfte im selben Slot', () => {
    const store = makeStore(semester());
    const key = slotKey('semester', 1, 9);
    store.toggleAssignment(key, 'a1');
    store.toggleAssignment(key, 'a2');
    expect(store.assignedTo(key)).toEqual(['a1', 'a2']);
    store.toggleAssignment(key, 'a1');
    expect(store.assignedTo(key)).toEqual(['a2']);
  });

  it('zählt Stunden je Woche getrennt vom Gesamtwert', () => {
    const store = makeStore(
      breakPlan({
        assignments: {
          '2026-08-10|1-9': ['a1'],
          '2026-08-10|1-10': ['a1'],
          '2026-08-17|1-9': ['a1'],
        },
      }),
    );
    expect(store.hoursByAssistant()['a1']).toBe(3);
    expect(store.hoursByAssistantInWeek('2026-08-10')['a1']).toBe(2);
    expect(store.hoursByAssistantInWeek('2026-08-17')['a1']).toBe(1);
  });

  it('überträgt die Einteilung einer Woche auf eine andere', () => {
    const store = makeStore(
      breakPlan({ assignments: { '2026-08-10|1-9': ['a1'], '2026-08-10|2-9': ['a2'] } }),
    );
    expect(store.copyWeek('2026-08-10', '2026-08-17')).toBe(2);
    expect(store.assignedTo('2026-08-17|1-9')).toEqual(['a1']);
    expect(store.assignedTo('2026-08-10|1-9')).toEqual(['a1']);
  });

  it('überträgt nur auf Stellen, die es in der Zielwoche gibt', () => {
    // Die zweite Woche ist auf Montag und Dienstag beschnitten.
    const store = makeStore(
      breakPlan({
        period: { start: '2026-08-10', end: '2026-08-18' },
        assignments: { '2026-08-10|1-9': ['a1'], '2026-08-10|4-9': ['a2'] },
      }),
    );
    expect(store.copyWeek('2026-08-10', '2026-08-17')).toBe(1);
    expect(store.assignedTo('2026-08-17|1-9')).toEqual(['a1']);
    expect(store.assignedTo('2026-08-17|4-9')).toEqual([]);
  });

  it('leert nur die angegebene Woche', () => {
    const store = makeStore(
      breakPlan({ assignments: { '2026-08-10|1-9': ['a1'], '2026-08-17|1-9': ['a2'] } }),
    );
    store.clearWeek('2026-08-10');
    expect(store.assignedTo('2026-08-10|1-9')).toEqual([]);
    expect(store.assignedTo('2026-08-17|1-9')).toEqual(['a2']);
  });
});

describe('Urlaub', () => {
  it('blockiert nur im Ferienplan, nicht im Semesterplan', () => {
    const withDates = makeStore(breakPlan());
    withDates.addVacation('a1', '2026-08-10', '2026-08-10');
    expect(withDates.isOnVacation('a1', '2026-08-10')).toBe(true);

    // Der Semesterplan hat keine Kalendertage — die Sperre kann dort nicht
    // greifen, deshalb wird toggleAssignment nie verweigert.
    const withoutDates = makeStore(semester());
    withoutDates.addVacation('a1', '2026-08-10', '2026-08-10');
    withoutDates.toggleAssignment('semester|1-9', 'a1');
    expect(withoutDates.assignedTo('semester|1-9')).toEqual(['a1']);
  });

  it('verhindert eine einzelne Zuweisung am Urlaubstag', () => {
    const store = makeStore(breakPlan());
    store.addVacation('a1', '2026-08-10', '2026-08-10');
    store.toggleAssignment('2026-08-10|1-9', 'a1');
    expect(store.assignedTo('2026-08-10|1-9')).toEqual([]);
  });

  it('erlaubt Zuweisungen an anderen Tagen unverändert', () => {
    // Wochenschlüssel ist immer der Montag; Dienstag der ersten Woche liegt
    // also unter '2026-08-10', nicht unter seinem eigenen Datum.
    const store = makeStore(breakPlan());
    store.addVacation('a1', '2026-08-10', '2026-08-10');
    store.toggleAssignment('2026-08-10|2-9', 'a1');
    expect(store.assignedTo('2026-08-10|2-9')).toEqual(['a1']);
  });

  it('lässt das Entfernen einer Zuweisung trotz Urlaub zu', () => {
    // Urlaub kann rückwirkend eingetragen worden sein; entfernen muss
    // trotzdem möglich bleiben, nur das Hinzufügen wird gesperrt.
    const store = makeStore(breakPlan({ assignments: { '2026-08-10|1-9': ['a1'] } }));
    store.addVacation('a1', '2026-08-10', '2026-08-10');
    // addVacation räumt selbst schon auf — hier zusätzlich prüfen, dass ein
    // erneuter Toggle-Aufruf auf eine (hypothetisch) verbliebene Zuweisung
    // nicht blockiert würde.
    expect(store.assignedTo('2026-08-10|1-9')).toEqual([]);
  });

  it('lässt einen Block nur an den nicht gesperrten Stunden auffüllen', () => {
    // Ein Block liegt innerhalb eines Tages, Urlaub gilt tagesweise — die
    // Sperre betrifft hier den ganzen Block gleichermaßen.
    const store = makeStore(breakPlan());
    store.addVacation('a1', '2026-08-10', '2026-08-10');
    store.toggleAssignmentForSlots(['2026-08-10|1-9', '2026-08-10|1-10'], 'a1');
    expect(store.assignedTo('2026-08-10|1-9')).toEqual([]);
    expect(store.assignedTo('2026-08-10|1-10')).toEqual([]);
  });

  it('blockiert das Zuweisen per Ziehen aus der Liste', () => {
    const store = makeStore(breakPlan());
    store.addVacation('a1', '2026-08-10', '2026-08-10');
    store.assignToSlots(['2026-08-10|1-9'], 'a1');
    expect(store.assignedTo('2026-08-10|1-9')).toEqual([]);
  });

  it('verweigert eine Verschiebung ganz, wenn nur ein Zielslot gesperrt ist', () => {
    // Alles-oder-nichts: ein teilweise verschobener Block würde sonst
    // unbemerkt Stunden verlieren.
    const store = makeStore(
      breakPlan({ assignments: { '2026-08-10|1-9': ['a1'], '2026-08-10|1-10': ['a1'] } }),
    );
    store.addVacation('a1', '2026-08-11', '2026-08-11');
    store.moveAssignment(
      ['2026-08-10|1-9', '2026-08-10|1-10'],
      ['2026-08-10|2-9', '2026-08-10|2-10'],
      'a1',
    );
    // Die Verschiebung wurde verweigert — Quelle bleibt unverändert.
    expect(store.assignedTo('2026-08-10|1-9')).toEqual(['a1']);
    expect(store.assignedTo('2026-08-10|2-9')).toEqual([]);
  });

  it('entfernt beim Eintragen rückwirkend bereits geplante Stunden im Zeitraum', () => {
    const store = makeStore(
      breakPlan({
        assignments: {
          '2026-08-10|1-9': ['a1', 'a2'],
          '2026-08-10|2-9': ['a1'],
          '2026-08-17|1-9': ['a1'],
        },
      }),
    );
    store.addVacation('a1', '2026-08-10', '2026-08-12');
    // Beide betroffenen Termine sind bereinigt, andere Hilfskräfte bleiben.
    expect(store.assignedTo('2026-08-10|1-9')).toEqual(['a2']);
    expect(store.assignedTo('2026-08-10|2-9')).toEqual([]);
    // Außerhalb des Urlaubszeitraums bleibt die Zuweisung bestehen.
    expect(store.assignedTo('2026-08-17|1-9')).toEqual(['a1']);
  });

  it('meldet eine trotzdem bestehende Zuweisung als Fehler', () => {
    // Kann nur durch einen importierten Stand entstehen, da die Store-Wege
    // selbst keine solche Zuweisung zulassen.
    const store = makeStore(
      breakPlan({
        assignments: { '2026-08-10|1-9': ['a1'] },
        vacations: [{ id: 'v1', assistantId: 'a1', from: '2026-08-10', to: '2026-08-10' }],
      }),
    );
    const forSlot = store.warningsBySlot().get('2026-08-10|1-9') ?? [];
    expect(forSlot.some((w) => w.level === 'error' && w.message.includes('Urlaub'))).toBe(true);
  });

  it('räumt Urlaub beim Entfernen der Hilfskraft mit auf', () => {
    const store = makeStore(breakPlan());
    store.addVacation('a1', '2026-08-10', '2026-08-10');
    store.removeAssistant('a1');
    expect(store.vacationsOf('a1')).toEqual([]);
  });

  it('lässt sich wieder entfernen', () => {
    const store = makeStore(breakPlan());
    store.addVacation('a1', '2026-08-10', '2026-08-10');
    const id = store.vacationsOf('a1')[0]!.id;
    store.removeVacation(id);
    expect(store.isOnVacation('a1', '2026-08-10')).toBe(false);
  });

  it('erlaubt einen tagesweisen Urlaub (from === to)', () => {
    const store = makeStore(breakPlan());
    store.addVacation('a1', '2026-08-12', '2026-08-12');
    expect(store.isOnVacation('a1', '2026-08-12')).toBe(true);
    expect(store.isOnVacation('a1', '2026-08-11')).toBe(false);
    expect(store.isOnVacation('a1', '2026-08-13')).toBe(false);
  });

  it('dreht vertauschte Datumsgrenzen', () => {
    const store = makeStore(breakPlan());
    store.addVacation('a1', '2026-08-12', '2026-08-10');
    expect(store.vacationsOf('a1')[0]).toMatchObject({ from: '2026-08-10', to: '2026-08-12' });
  });
});

describe('Einsatzort (Theke / Büro)', () => {
  it('ist standardmäßig Theke, also nicht als Büro markiert', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    expect(store.isOfficeWork('semester|1-9', 'a1')).toBe(false);
  });

  it('schaltet zwischen Theke und Büro um', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.toggleTask('semester|1-9', 'a1');
    expect(store.isOfficeWork('semester|1-9', 'a1')).toBe(true);
    store.toggleTask('semester|1-9', 'a1');
    expect(store.isOfficeWork('semester|1-9', 'a1')).toBe(false);
  });

  it('lässt sich ohne bestehende Zuweisung nicht umschalten', () => {
    const store = makeStore(semester());
    store.toggleTask('semester|1-9', 'a1');
    expect(store.isOfficeWork('semester|1-9', 'a1')).toBe(false);
  });

  it('darf keine Vorbelegung hinterlassen, die bei späterer Zuweisung auftaucht', () => {
    // Der No-op bei fehlender Zuweisung muss wirklich nichts schreiben —
    // sonst könnte ein Toggle-Versuch ins Leere unbemerkt eine Markierung
    // hinterlegen, die erst bei der nächsten Zuweisung sichtbar würde.
    const store = makeStore(semester());
    store.toggleTask('semester|1-9', 'a1');
    store.toggleAssignment('semester|1-9', 'a1');
    expect(store.isOfficeWork('semester|1-9', 'a1')).toBe(false);
  });

  it('betrifft nur die eine Person im Slot, nicht andere', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1', 'a2'] } }));
    store.toggleTask('semester|1-9', 'a1');
    expect(store.isOfficeWork('semester|1-9', 'a1')).toBe(true);
    expect(store.isOfficeWork('semester|1-9', 'a2')).toBe(false);
  });

  it('verschwindet automatisch, sobald die Zuweisung entfernt wird', () => {
    // Zentrale Garantie: isOfficeWork prüft gegen die aktuelle Zuweisung,
    // nicht nur gegen den rohen Zustand — ohne dass jede der verschiedenen
    // Entfernungsstellen die Markierung einzeln aufräumen müsste.
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.toggleTask('semester|1-9', 'a1');
    expect(store.isOfficeWork('semester|1-9', 'a1')).toBe(true);
    store.toggleAssignment('semester|1-9', 'a1');
    expect(store.isOfficeWork('semester|1-9', 'a1')).toBe(false);
  });

  it('verschwindet auch beim Verschieben aus der Quelle', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.toggleTask('semester|1-9', 'a1');
    store.moveAssignment('semester|1-9', ['semester|2-9'], 'a1');
    expect(store.isOfficeWork('semester|1-9', 'a1')).toBe(false);
    // Am neuen Ort gilt wieder der Normalfall Theke, nicht automatisch Büro.
    expect(store.isOfficeWork('semester|2-9', 'a1')).toBe(false);
  });

  it('kehrt beim Rückgängigmachen einer Entfernung nicht von selbst zurück', () => {
    // Wird dieselbe Person später erneut demselben Slot zugewiesen, startet
    // sie wieder als Theke — die Markierung lebt nur, solange die konkrete
    // Zuweisung ununterbrochen besteht.
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.toggleTask('semester|1-9', 'a1');
    store.toggleAssignment('semester|1-9', 'a1'); // entfernen
    store.toggleAssignment('semester|1-9', 'a1'); // erneut zuweisen
    expect(store.isOfficeWork('semester|1-9', 'a1')).toBe(false);
  });

  it('räumt beim Entfernen der Hilfskraft mit auf', () => {
    // STAFF enthält zwei Personen (a1, a2) — nach dem Entfernen bleibt a2.
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.toggleTask('semester|1-9', 'a1');
    store.removeAssistant('a1');
    expect(store.assistants().map((a) => a.id)).toEqual(['a2']);
  });

  it('verschwindet beim Leeren einer Woche und lebt bei Neuzuweisung nicht wieder auf', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.toggleTask('semester|1-9', 'a1');
    store.clearAssignments();
    store.toggleAssignment('semester|1-9', 'a1');
    expect(store.isOfficeWork('semester|1-9', 'a1')).toBe(false);
  });
});

describe('Blockzuweisung', () => {
  const BLOCK = ['semester|1-9', 'semester|1-10', 'semester|1-11'];

  it('meldet den Deckungsgrad über mehrere Slots', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    expect(store.assignmentCoverage(BLOCK, 'a1')).toBe('some');
    expect(store.assignmentCoverage(BLOCK, 'a2')).toBe('none');
    expect(store.assignmentCoverage(['semester|1-9'], 'a1')).toBe('all');
  });

  it('teilt eine Hilfskraft dem ganzen Block zu', () => {
    const store = makeStore(semester());
    store.toggleAssignmentForSlots(BLOCK, 'a1');
    expect(store.assignmentCoverage(BLOCK, 'a1')).toBe('all');
  });

  it('füllt einen teilweise belegten Block auf, statt ihn zu leeren', () => {
    // Beim Nachbessern einer Schicht ist das die erwartete Richtung.
    const store = makeStore(semester({ assignments: { 'semester|1-10': ['a1'] } }));
    store.toggleAssignmentForSlots(BLOCK, 'a1');
    expect(store.assignmentCoverage(BLOCK, 'a1')).toBe('all');
  });

  it('entfernt die Hilfskraft, wenn sie den Block vollständig belegt', () => {
    const store = makeStore(semester());
    store.toggleAssignmentForSlots(BLOCK, 'a1');
    store.toggleAssignmentForSlots(BLOCK, 'a1');
    expect(store.assignmentCoverage(BLOCK, 'a1')).toBe('none');
  });

  it('lässt andere Hilfskräfte im Block unberührt', () => {
    // Überlappende Schichten sind ausdrücklich erlaubt.
    const store = makeStore(semester({ assignments: { 'semester|1-10': ['a2'] } }));
    store.toggleAssignmentForSlots(BLOCK, 'a1');
    expect(store.assignedTo('semester|1-10')).toEqual(['a2', 'a1']);
    store.toggleAssignmentForSlots(BLOCK, 'a1');
    expect(store.assignedTo('semester|1-10')).toEqual(['a2']);
  });

  it('verkraftet einen leeren Block', () => {
    const store = makeStore(semester());
    store.toggleAssignmentForSlots([], 'a1');
    expect(store.assignmentCoverage([], 'a1')).toBe('none');
  });
});

describe('Zuweisen und Verschieben (Drag and Drop)', () => {
  it('fügt eine Hilfskraft hinzu, ohne andere zu verdrängen', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a2'] } }));
    store.assignToSlots(['semester|1-9'], 'a1');
    expect(store.assignedTo('semester|1-9')).toEqual(['a2', 'a1']);
  });

  it('fügt niemanden doppelt ein', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.assignToSlots(['semester|1-9'], 'a1');
    expect(store.assignedTo('semester|1-9')).toEqual(['a1']);
  });

  it('verschiebt eine Hilfskraft von einer Stunde in eine andere', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.moveAssignment('semester|1-9', ['semester|2-9'], 'a1');
    expect(store.assignedTo('semester|1-9')).toEqual([]);
    expect(store.assignedTo('semester|2-9')).toEqual(['a1']);
  });

  it('lässt beim Verschieben andere Hilfskräfte in der Quelle stehen', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1', 'a2'] } }));
    store.moveAssignment('semester|1-9', ['semester|2-9'], 'a1');
    expect(store.assignedTo('semester|1-9')).toEqual(['a2']);
  });

  it('verschiebt auf einen ganzen Block', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.moveAssignment('semester|1-9', ['semester|2-9', 'semester|2-10'], 'a1');
    expect(store.assignedTo('semester|1-9')).toEqual([]);
    expect(store.assignedTo('semester|2-9')).toEqual(['a1']);
    expect(store.assignedTo('semester|2-10')).toEqual(['a1']);
  });

  it('verliert niemanden, wenn Quelle im Ziel enthalten ist', () => {
    // Beim Ablegen auf einem Block, der die Quellstunde einschließt, darf die
    // Person dort nicht entfernt werden.
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.moveAssignment('semester|1-9', ['semester|1-9', 'semester|1-10'], 'a1');
    expect(store.assignedTo('semester|1-9')).toEqual(['a1']);
    expect(store.assignedTo('semester|1-10')).toEqual(['a1']);
  });

  it('verschiebt eine ganze Schicht in einem Schritt', () => {
    const store = makeStore(
      semester({
        assignments: {
          'semester|1-9': ['a1'],
          'semester|1-10': ['a1'],
          'semester|1-11': ['a1'],
        },
      }),
    );
    store.moveAssignment(
      ['semester|1-9', 'semester|1-10', 'semester|1-11'],
      ['semester|2-9', 'semester|2-10', 'semester|2-11'],
      'a1',
    );
    expect(store.assignedTo('semester|1-9')).toEqual([]);
    expect(store.assignedTo('semester|1-11')).toEqual([]);
    expect(store.assignedTo('semester|2-10')).toEqual(['a1']);
  });

  it('verliert bei überlappender Verschiebung keine Stunde', () => {
    // Schicht 9–11 wird um eine Stunde nach hinten gezogen: 10 und 11 sind
    // in Quelle und Ziel enthalten und dürfen nicht herausfallen.
    const store = makeStore(
      semester({
        assignments: {
          'semester|1-9': ['a1'],
          'semester|1-10': ['a1'],
          'semester|1-11': ['a1'],
        },
      }),
    );
    store.moveAssignment(
      ['semester|1-9', 'semester|1-10', 'semester|1-11'],
      ['semester|1-10', 'semester|1-11'],
      'a1',
    );
    expect(store.assignedTo('semester|1-9')).toEqual([]);
    expect(store.assignedTo('semester|1-10')).toEqual(['a1']);
    expect(store.assignedTo('semester|1-11')).toEqual(['a1']);
  });

  it('lässt beim Verschieben einer Schicht andere Personen unberührt', () => {
    const store = makeStore(
      semester({
        assignments: { 'semester|1-9': ['a1', 'a2'], 'semester|1-10': ['a1'] },
      }),
    );
    store.moveAssignment(['semester|1-9', 'semester|1-10'], ['semester|3-9', 'semester|3-10'], 'a1');
    expect(store.assignedTo('semester|1-9')).toEqual(['a2']);
    expect(store.assignedTo('semester|3-9')).toEqual(['a1']);
  });

  it('macht eine Verschiebung durch den umgekehrten Aufruf rückgängig', () => {
    // So funktioniert das Rückgängig in der Oberfläche: moveAssignment(to, from).
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.moveAssignment(['semester|1-9'], ['semester|3-9'], 'a1');
    store.moveAssignment(['semester|3-9'], ['semester|1-9'], 'a1');
    expect(store.assignedTo('semester|1-9')).toEqual(['a1']);
    expect(store.assignedTo('semester|3-9')).toEqual([]);
  });

  it('macht auch eine überlappende Blockverschiebung sauber rückgängig', () => {
    const store = makeStore(
      semester({
        assignments: { 'semester|1-9': ['a1'], 'semester|1-10': ['a1'], 'semester|1-11': ['a1'] },
      }),
    );
    const from = ['semester|1-9', 'semester|1-10', 'semester|1-11'];
    const to = ['semester|1-10', 'semester|1-11', 'semester|1-12'];
    store.moveAssignment(from, to, 'a1');
    store.moveAssignment(to, from, 'a1');
    expect(store.assignedTo('semester|1-9')).toEqual(['a1']);
    expect(store.assignedTo('semester|1-10')).toEqual(['a1']);
    expect(store.assignedTo('semester|1-11')).toEqual(['a1']);
    expect(store.assignedTo('semester|1-12')).toEqual([]);
  });

  it('rührt beim Rückgängigmachen andere Personen nicht an', () => {
    const store = makeStore(
      semester({ assignments: { 'semester|1-9': ['a1', 'a2'] } }),
    );
    store.moveAssignment(['semester|1-9'], ['semester|2-9'], 'a1');
    store.moveAssignment(['semester|2-9'], ['semester|1-9'], 'a1');
    expect(store.assignedTo('semester|1-9')).toEqual(['a2', 'a1']);
  });

  it('verkraftet ein leeres Ziel', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.moveAssignment('semester|1-9', [], 'a1');
    expect(store.assignedTo('semester|1-9')).toEqual(['a1']);
  });
});

describe('Moduswechsel', () => {
  it('behält die Daten beider Modi, sodass der Wechsel umkehrbar ist', () => {
    const store = makeStore(
      semester({
        availability: { a1: { 'semester|1-9': 'yes' } },
        assignments: { 'semester|1-9': ['a1'] },
      }),
    );
    store.setMode('break');
    // Im Ferienmodus ist die Musterwoche nicht sichtbar ...
    expect(store.weekPlans().some((p) => p.key === 'semester')).toBe(false);
    store.setMode('semester');
    // ... aber nach dem Zurückwechseln unverändert vorhanden.
    expect(store.assignedTo('semester|1-9')).toEqual(['a1']);
    expect(store.getAvailability('a1', 'semester|1-9')).toBe('yes');
  });

  it('meldet Zuweisungen, die zu keinem aktuellen Wochenplan gehören', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    store.setMode('break');
    expect(store.hasOrphanAssignments()).toBe(true);
    store.pruneOrphanAssignments();
    expect(store.hasOrphanAssignments()).toBe(false);
  });
});

describe('Warnungen', () => {
  it('meldet unbesetzte Stunden', () => {
    const store = makeStore(semester());
    expect(store.warnings()).toHaveLength(12);
    expect(store.warnings().every((w) => w.level === 'warn')).toBe(true);
  });

  it('meldet eine Einteilung gegen ein Nein als Fehler', () => {
    const store = makeStore(
      semester({
        availability: { a1: { 'semester|1-9': 'no' } },
        assignments: { 'semester|1-9': ['a1'] },
      }),
    );
    const forSlot = store.warningsBySlot().get('semester|1-9') ?? [];
    expect(forSlot.some((w) => w.level === 'error')).toBe(true);
  });

  it('meldet fehlende Antworten als Fehler', () => {
    const store = makeStore(semester({ assignments: { 'semester|1-9': ['a1'] } }));
    const forSlot = store.warningsBySlot().get('semester|1-9') ?? [];
    expect(forSlot.some((w) => w.level === 'error')).toBe(true);
  });

  it('meldet eine nur notfalls besetzte Stunde als Hinweis', () => {
    const store = makeStore(
      semester({
        availability: { a1: { 'semester|1-9': 'ifNeeded' } },
        assignments: { 'semester|1-9': ['a1'] },
      }),
    );
    const forSlot = store.warningsBySlot().get('semester|1-9') ?? [];
    expect(forSlot.some((w) => w.level === 'info')).toBe(true);
  });

  it('schweigt, wenn ein Ja-Kandidat dabei ist', () => {
    const store = makeStore(
      semester({
        availability: { a1: { 'semester|1-9': 'ifNeeded' }, a2: { 'semester|1-9': 'yes' } },
        assignments: { 'semester|1-9': ['a1', 'a2'] },
      }),
    );
    expect(store.warningsBySlot().get('semester|1-9')).toBeUndefined();
  });

  it('ordnet Warnungen ihrer Woche zu', () => {
    const store = makeStore(breakPlan());
    expect(store.warningsOfWeek('2026-08-10')).toHaveLength(12);
    expect(store.warningsOfWeek('2026-08-17')).toHaveLength(12);
  });
});

describe('Migration älterer Stände', () => {
  it('macht aus einem v1-Stand einen Semesterplan', () => {
    const state = normalizeState({
      version: 1,
      title: 'Alter Plan',
      openingHours: OPENING,
      assistants: STAFF,
      availability: { a1: { '1-9': 'yes' } },
      assignments: { '1-9': ['a1'], '3-10': ['a1', 'a2'] },
    });
    expect(state.version).toBe(6);
    expect(state.mode).toBe('semester');
    expect(state.title).toBe('Alter Plan');
    expect(state.assignments['semester|1-9']).toEqual(['a1']);
    expect(state.assignments['semester|3-10']).toEqual(['a1', 'a2']);
    expect(state.availability['a1']?.['semester|1-9']).toBe('yes');
  });

  it('macht aus einem datumsbasierten Stand einen Ferienplan', () => {
    const state = normalizeState({
      version: 3,
      period: PERIOD,
      openingHours: OPENING,
      assistants: STAFF,
      assignments: { '2026-08-10T09': ['a1'], '2026-08-17T10': ['a2'] },
    });
    expect(state.mode).toBe('break');
    expect(state.assignments['2026-08-10|1-9']).toEqual(['a1']);
    expect(state.assignments['2026-08-17|1-10']).toEqual(['a2']);
  });

  it('übernimmt wochenweise Angaben aus v3', () => {
    const state = normalizeState({
      version: 3,
      period: PERIOD,
      assistants: STAFF,
      weeklyAvailability: { a1: { '2026-08-10': { '1-9': 'yes' } } },
    });
    expect(state.availability['a1']?.['2026-08-10|1-9']).toBe('yes');
  });

  it('lässt einen v4-Stand unverändert', () => {
    const state = normalizeState({
      version: 4,
      mode: 'break',
      assistants: STAFF,
      assignments: { '2026-08-10|1-9': ['a1'] },
    });
    expect(state.assignments).toEqual({ '2026-08-10|1-9': ['a1'] });
  });

  it('verkraftet kaputte Eingaben', () => {
    expect(normalizeState(null).version).toBe(6);
    expect(normalizeState('kaputt').mode).toBe('semester');
    expect(normalizeState({}).assistants).toEqual([]);
  });

  it('begradigt einen verkehrt eingegebenen Zeitraum', () => {
    const state = normalizeState({ period: { start: '2026-09-01', end: '2026-08-01' } });
    expect(state.period.end).toBe('2026-09-01');
  });

  it('verwirft Zuweisungen auf gelöschte Hilfskräfte', () => {
    const state = normalizeState({
      version: 4,
      assistants: [],
      assignments: { 'semester|1-9': ['weg'] },
    });
    expect(state.assignments).toEqual({});
  });
});

describe('Aufräumen beim Entfernen einer Hilfskraft', () => {
  it('nimmt Verfügungszeiten und Einteilungen mit', () => {
    const store = makeStore(
      semester({
        availability: { a1: { 'semester|1-9': 'yes' } },
        assignments: { 'semester|1-9': ['a1', 'a2'] },
      }),
    );
    store.removeAssistant('a1');
    expect(store.assistants()).toHaveLength(1);
    expect(store.getAvailability('a1', 'semester|1-9')).toBeUndefined();
    expect(store.assignedTo('semester|1-9')).toEqual(['a2']);
  });
});
