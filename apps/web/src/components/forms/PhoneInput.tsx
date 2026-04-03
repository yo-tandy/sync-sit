import { useState } from 'react';

const COUNTRY_CODES = [
  { code: '+33', country: 'FR', flag: '🇫🇷' },
  { code: '+44', country: 'UK', flag: '🇬🇧' },
  { code: '+1', country: 'US', flag: '🇺🇸' },
  { code: '+49', country: 'DE', flag: '🇩🇪' },
  { code: '+34', country: 'ES', flag: '🇪🇸' },
  { code: '+39', country: 'IT', flag: '🇮🇹' },
  { code: '+41', country: 'CH', flag: '🇨🇭' },
  { code: '+32', country: 'BE', flag: '🇧🇪' },
  { code: '+351', country: 'PT', flag: '🇵🇹' },
  { code: '+31', country: 'NL', flag: '🇳🇱' },
  { code: '+46', country: 'SE', flag: '🇸🇪' },
  { code: '+47', country: 'NO', flag: '🇳🇴' },
  { code: '+45', country: 'DK', flag: '🇩🇰' },
  { code: '+48', country: 'PL', flag: '🇵🇱' },
  { code: '+43', country: 'AT', flag: '🇦🇹' },
  { code: '+353', country: 'IE', flag: '🇮🇪' },
  { code: '+972', country: 'IL', flag: '🇮🇱' },
  { code: '+81', country: 'JP', flag: '🇯🇵' },
  { code: '+82', country: 'KR', flag: '🇰🇷' },
  { code: '+86', country: 'CN', flag: '🇨🇳' },
  { code: '+91', country: 'IN', flag: '🇮🇳' },
  { code: '+55', country: 'BR', flag: '🇧🇷' },
  { code: '+61', country: 'AU', flag: '🇦🇺' },
  { code: '+7', country: 'RU', flag: '🇷🇺' },
  { code: '+90', country: 'TR', flag: '🇹🇷' },
  { code: '+212', country: 'MA', flag: '🇲🇦' },
  { code: '+216', country: 'TN', flag: '🇹🇳' },
  { code: '+213', country: 'DZ', flag: '🇩🇿' },
  { code: '+961', country: 'LB', flag: '🇱🇧' },
];

function parsePhone(fullNumber: string): { countryCode: string; number: string } {
  if (!fullNumber) return { countryCode: '+33', number: '' };
  // Try to match a country code
  for (const cc of COUNTRY_CODES.sort((a, b) => b.code.length - a.code.length)) {
    if (fullNumber.startsWith(cc.code)) {
      return { countryCode: cc.code, number: fullNumber.slice(cc.code.length).trim() };
    }
  }
  // If starts with +, extract code
  if (fullNumber.startsWith('+')) {
    const match = fullNumber.match(/^(\+\d{1,4})\s*(.*)/);
    if (match) return { countryCode: match[1], number: match[2] };
  }
  return { countryCode: '+33', number: fullNumber };
}

function formatFullNumber(countryCode: string, number: string): string {
  const cleaned = number.replace(/[^\d]/g, '');
  if (!cleaned) return '';
  return `${countryCode} ${cleaned}`;
}

interface PhoneInputProps {
  label: string;
  value: string;
  onChange: (fullNumber: string) => void;
  placeholder?: string;
  className?: string;
}

export function PhoneInput({ label, value, onChange, placeholder, className = '' }: PhoneInputProps) {
  const parsed = parsePhone(value);
  const [countryCode, setCountryCode] = useState(parsed.countryCode);
  const [number, setNumber] = useState(parsed.number);

  const handleCountryChange = (code: string) => {
    setCountryCode(code);
    onChange(formatFullNumber(code, number));
  };

  const handleNumberChange = (num: string) => {
    // Remove leading 0 if present (e.g. 06... → 6...)
    let cleaned = num;
    if (cleaned.startsWith('0') && countryCode === '+33') {
      cleaned = cleaned.slice(1);
    }
    setNumber(cleaned);
    onChange(formatFullNumber(countryCode, cleaned));
  };

  return (
    <div className={`mb-5 ${className}`}>
      <label className="mb-2 block text-sm font-medium text-gray-700">{label}</label>
      <div className="flex gap-2">
        <select
          value={countryCode}
          onChange={(e) => handleCountryChange(e.target.value)}
          className="h-12 rounded-lg border-[1.5px] border-gray-300 bg-white px-2 text-sm text-gray-950 outline-none focus:border-red-600"
        >
          {COUNTRY_CODES.map((cc) => (
            <option key={cc.code} value={cc.code}>
              {cc.flag} {cc.code}
            </option>
          ))}
        </select>
        <input
          type="tel"
          value={number}
          onChange={(e) => handleNumberChange(e.target.value)}
          placeholder={placeholder || '6 12 34 56 78'}
          className="h-12 flex-1 rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:border-red-600"
        />
      </div>
    </div>
  );
}

export { parsePhone, formatFullNumber, COUNTRY_CODES };
