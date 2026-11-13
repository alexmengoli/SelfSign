import { type ApplicationConfig, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './core/auth.service';
import { registerDocumentFonts } from './core/font-files';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Starts the font download early without delaying the first render.
    provideAppInitializer(() => void registerDocumentFonts()),
  ],
};
