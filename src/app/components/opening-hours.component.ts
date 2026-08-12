import { Component, inject } from '@angular/core';
import {
  PLAN_MODE_LABELS,
  PlanMode,
  WEEKDAY_LABELS,
  Weekday,
  formatDateLong,
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
  readonly modeLabels = PLAN_MODE_LABELS;

  label(weekday: Weekday): string {
    return WEEKDAY_LABELS[weekday];
  }

  setMode(mode: PlanMode): void {
    this.store.setMode(mode);
  }

  setStart(weekday: Weekday, event: Event): void {
    this.store.setOpeningHours(weekday, { start: Number((event.target as HTMLInputElement).value) });
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
}
