import { type ApplicationConfig, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { registerDocumentFonts } from './core/font-files';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    // Starts the font download early without delaying the first render.
    provideAppInitializer(() => void registerDocumentFonts()),
  ],
};
