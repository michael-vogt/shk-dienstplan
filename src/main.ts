import { provideBrowserGlobalErrorListeners } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

// Kein provideZonelessChangeDetection nötig: seit v21 ist zoneless der Standard.
bootstrapApplication(AppComponent, {
  providers: [provideBrowserGlobalErrorListeners()],
}).catch((err) => console.error(err));
