'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { dictionary, Locale, DictKey } from '../locales/dictionary';

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: DictKey) => string;
}>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const stored = localStorage.getItem('topup-locale') as Locale | null;
    if (stored && (stored === 'en' || stored === 'km')) setLocaleState(stored);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('topup-locale', l);
    document.documentElement.lang = l;
  };

  const t = (key: DictKey) => dictionary[locale][key] ?? dictionary.en[key];

  return <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);
