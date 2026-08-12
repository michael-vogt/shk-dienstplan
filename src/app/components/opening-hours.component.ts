import { Component, inject } from '@angular/core';
import {
  DateException,
  IsoDate,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  Weekday,
  formatDateLong,
  weekdayOf,
} from '../models/schedule.model';
import { ScheduleStore } from '../services/schedule-store.service';

@Component({
  selector: 'app-opening-hours',
  templateUrl: './opening-hours.component.html',
  styleUrl: './opening-hours.component.css',
})
export class OpeningHoursComponent {
  readonly store = inject(ScheduleStore);
  readonly formatDateLong = formatDateLong;

  label(weekday: Weekday): string {
    return WEEKDAY_LABELS[weekday];
  }

  /** Feiertage fallen oft auf Wochenenden — dann ist die Ausnahme wirkungslos. */
  isWeekend(date: IsoDate): boolean {
    return weekdayOf(date) === null;
  }

  weekdayShort(date: IsoDate): string {
    const weekday = weekdayOf(date);
    return weekday === null ? 'Sa/So' : WEEKDAY_SHORT[weekday];
  }

  setStart(weekday: Weekday, event: Event): void {
    this.store.setOpeningHours(weekday, {
      start: Number((event.target as HTMLInputElement).value),
    });
  }

  setEnd(weekday: Weekday, event: Event): void {
    this.store.setOpeningHours(weekday, { end: Number((event.target as HTMLInputElement).value) });
  }

  setOpen(weekday: Weekday, event: Event): void {
    this.store.setOpeningHours(weekday, { open: (event.target as HTMLInputElement).checked });
  }

  setPeriodStart(event: Event): void {
    this.store.setPeriod({ start: (event.target as HTMLInputElement).value });
  }

  setPeriodEnd(event: Event): void {
    this.store.setPeriod({ end: (event.target as HTMLInputElement).value });
  }

  addException(input: HTMLInputElement, note: HTMLInputElement): void {
    this.store.addException(input.value, note.value);
    input.value = '';
    note.value = '';
  }

  toggleExceptionMode(exception: DateException): void {
    // Geschlossen ↔ abweichende Zeiten. Beim Wechsel auf Zeiten wird der
    // Wochentagsstandard als Ausgangswert übernommen.
    if (exception.closed) {
      const base = this.store.openingHours().find((o) => o.weekday === weekdayOf(exception.date));
      this.store.updateException(exception.date, {
        closed: false,
        start: exception.start ?? base?.start ?? 9,
        end: exception.end ?? base?.end ?? 18,
      });
    } else {
      this.store.updateException(exception.date, { closed: true });
    }
  }

  setExceptionStart(exception: DateException, event: Event): void {
    this.store.updateException(exception.date, {
      start: Number((event.target as HTMLInputElement).value),
    });
  }

  setExceptionEnd(exception: DateException, event: Event): void {
    this.store.updateException(exception.date, {
      end: Number((event.target as HTMLInputElement).value),
    });
  }
}
