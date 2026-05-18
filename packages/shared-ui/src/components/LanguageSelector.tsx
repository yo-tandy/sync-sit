import { useTranslation } from 'react-i18next';

export function LanguageSelector({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation();

  const handleChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('ejm_language', lang);
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => handleChange('en')}
        className={`rounded-lg border-[1.5px] px-3 py-1.5 text-sm font-medium transition-colors ${
          i18n.language === 'en'
            ? 'border-red-600 bg-red-50 text-red-600'
            : 'border-gray-300 text-gray-700 hover:border-gray-400'
        }`}
      >
        English
      </button>
      <button
        type="button"
        onClick={() => handleChange('fr')}
        className={`rounded-lg border-[1.5px] px-3 py-1.5 text-sm font-medium transition-colors ${
          i18n.language?.startsWith('fr')
            ? 'border-red-600 bg-red-50 text-red-600'
            : 'border-gray-300 text-gray-700 hover:border-gray-400'
        }`}
      >
        Français
      </button>
    </div>
  );
}
