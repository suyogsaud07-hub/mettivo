'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
// FIXED: Using the absolute alias path to src/lib
import { translations, Language, TranslationKey } from '@/lib/translations';

interface LanguageContextProps {
  language: Language;
  changeLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('en');

  useEffect(() => {
    const savedLang = localStorage.getItem('mettivo_language') as Language;
    if (savedLang && translations[savedLang]) {
      setLanguage(savedLang);
    }
  }, []);

  const changeLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('mettivo_language', lang);
  };

  const t = (key: TranslationKey): string => {
    return translations[language]?.[key] || translations['en'][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}