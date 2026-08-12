import { Component, inject, signal } from '@angular/core';
import { AvailabilityComponent } from './components/availability.component';
import { OpeningHoursComponent } from './components/opening-hours.component';
import { RosterComponent } from './components/roster.component';
import { ExportService } from './services/export.service';
import { ScheduleStore } from './services/schedule-store.service';

type Step = 'hours' | 'availability' | 'roster';

@Component({
  selector: 'app-root',
  imports: [OpeningHoursComponent, AvailabilityComponent, RosterComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly store = inject(ScheduleStore);
  readonly exporter = inject(ExportService);
  readonly step = signal<Step>('hours');
  readonly importError = signal<string | null>(null);

  setTitle(event: Event): void {
    this.store.setTitle((event.target as HTMLInputElement).value);
  }

  async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await this.exporter.importJson(file);
      this.importError.set(null);
    } catch {
      this.importError.set(
        'Die Datei ließ sich nicht lesen. Erwartet wird eine mit „Daten sichern" erzeugte JSON-Datei.',
      );
    } finally {
      input.value = '';
    }
  }
}
