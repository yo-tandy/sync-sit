import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './en';
import fr from './fr';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr'],
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      // 'querystring' goes first: study/do's /signup redirect (issue #435
      // milestone, PR5) hands off cross-origin to /enroll?lang=xx, and
      // localStorage is per-origin — this app has no prior record of the
      // visitor's language choice, so the incoming param is the only signal
      // available. Absent (the common in-app case), detection falls through
      // to localStorage/navigator exactly as before.
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: 'ejm_language',
      caches: ['localStorage'],
    },
  });

export default i18n;
