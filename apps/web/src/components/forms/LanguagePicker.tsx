import { useState } from 'react';
import { Chip } from '@/components/ui';

const PRIMARY_LANGUAGES = ['French', 'English', 'Spanish', 'German', 'Arabic'];

const MORE_LANGUAGES = [
  'Hebrew', 'Mandarin', 'Cantonese', 'Korean', 'Japanese',
  'Russian', 'Ukrainian', 'Portuguese', 'Farsi', 'Italian',
];

interface LanguagePickerProps {
  selected: string[];
  onChange: (languages: string[]) => void;
  label?: string;
}

export function LanguagePicker({ selected, onChange, label = 'Languages spoken *' }: LanguagePickerProps) {
  const [showMore, setShowMore] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customValue, setCustomValue] = useState('');

  // Check if any "more" or custom languages are already selected (to auto-expand)
  const hasMoreSelected = selected.some(
    (l) => MORE_LANGUAGES.includes(l) || (!PRIMARY_LANGUAGES.includes(l) && l !== '')
  );

  const toggle = (lang: string) => {
    if (selected.includes(lang)) {
      onChange(selected.filter((l) => l !== lang));
    } else {
      onChange([...selected, lang]);
    }
  };

  const addCustomLanguage = () => {
    const trimmed = customValue.trim();
    if (trimmed && !selected.includes(trimmed)) {
      onChange([...selected, trimmed]);
      setCustomValue('');
      setShowCustom(false);
    }
  };

  const handleCustomKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomLanguage();
    }
  };

  // Find custom languages (not in primary or more lists)
  const customLanguages = selected.filter(
    (l) => !PRIMARY_LANGUAGES.includes(l) && !MORE_LANGUAGES.includes(l)
  );

  return (
    <div className="mb-5">
      <label className="mb-2 block text-sm font-medium text-gray-700">
        {label}
      </label>

      {/* All language chips in a single wrapping container */}
      <div className="flex flex-wrap gap-2">
        {PRIMARY_LANGUAGES.map((lang) => (
          <Chip key={lang} selected={selected.includes(lang)} onClick={() => toggle(lang)}>
            {lang}
          </Chip>
        ))}

        {/* More button */}
        {!showMore && !hasMoreSelected && (
          <Chip onClick={() => setShowMore(true)}>
            + More
          </Chip>
        )}

        {/* Extended languages */}
        {(showMore || hasMoreSelected) && (
          <>
            {MORE_LANGUAGES.map((lang) => (
              <Chip key={lang} selected={selected.includes(lang)} onClick={() => toggle(lang)}>
                {lang}
              </Chip>
            ))}

            {/* Custom languages already added */}
            {customLanguages.map((lang) => (
              <Chip key={lang} selected onClick={() => toggle(lang)}>
                {lang}
              </Chip>
            ))}

            {/* Other button */}
            {!showCustom && (
              <Chip onClick={() => setShowCustom(true)}>
                + Other
              </Chip>
            )}
          </>
        )}
      </div>

      {/* Custom language input */}
      {showCustom && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={handleCustomKeyDown}
            placeholder="Enter language..."
            className="h-10 flex-1 rounded-lg border-[1.5px] border-gray-300 bg-white px-3 text-sm outline-none focus:border-red-600"
            autoFocus
          />
          <button
            type="button"
            onClick={addCustomLanguage}
            disabled={!customValue.trim()}
            className="h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setShowCustom(false); setCustomValue(''); }}
            className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-500"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
