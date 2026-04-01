import { useState, useRef, useEffect } from 'react';

export interface AddressResult {
  fullAddress: string;
  street: string;
  city: string;
  postcode: string;
  lat: number;
  lng: number;
}

interface AddressAutocompleteProps {
  value: AddressResult | null;
  onChange: (address: AddressResult | null) => void;
  label?: string;
  error?: string;
}

interface GouvFeature {
  properties: {
    label: string;
    name: string;
    city: string;
    postcode: string;
    context: string;
  };
  geometry: {
    coordinates: [number, number]; // [lng, lat]
  };
}

export function AddressAutocomplete({
  value,
  onChange,
  label = 'Address *',
  error,
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState(value?.fullAddress || '');
  const [suggestions, setSuggestions] = useState<GouvFeature[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close suggestions on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const fetchSuggestions = async (q: string) => {
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`
      );
      const data = await res.json();
      setSuggestions(data.features || []);
      setShowSuggestions(true);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (val: string) => {
    setQuery(val);
    // Clear the selected value when user edits
    if (value) {
      onChange(null);
    }

    // Debounce API calls
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
  };

  const handleSelect = (feature: GouvFeature) => {
    const result: AddressResult = {
      fullAddress: feature.properties.label,
      street: feature.properties.name,
      city: feature.properties.city,
      postcode: feature.properties.postcode,
      lat: feature.geometry.coordinates[1],
      lng: feature.geometry.coordinates[0],
    };
    onChange(result);
    setQuery(feature.properties.label);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handleClear = () => {
    setQuery('');
    onChange(null);
    setSuggestions([]);
  };

  return (
    <div className="mb-5" ref={containerRef}>
      <label className="mb-2 block text-sm font-medium text-gray-700">
        {label}
      </label>

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          placeholder="Start typing an address..."
          className={`h-12 w-full rounded-lg border-[1.5px] bg-white px-4 pr-10 text-base text-gray-950 outline-none transition-colors placeholder:text-gray-400 ${
            error ? 'border-red-600' : 'border-gray-300 focus:border-red-600'
          }`}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <svg className="h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
        {value && !loading && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}

        {/* Suggestions dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            {suggestions.map((feature, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelect(feature)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
              >
                <span className="mt-0.5 text-gray-400">📍</span>
                <div>
                  <p className="text-sm font-medium text-gray-950">
                    {feature.properties.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {feature.properties.postcode} {feature.properties.city}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}

      {/* Structured address display — only when sub-fields are populated */}
      {value && value.street && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <span className="text-xs text-gray-400">Street</span>
              <p className="font-medium text-gray-950">{value.street}</p>
            </div>
            <div>
              <span className="text-xs text-gray-400">City</span>
              <p className="font-medium text-gray-950">{value.city}</p>
            </div>
            <div>
              <span className="text-xs text-gray-400">Postal code</span>
              <p className="font-medium text-gray-950">{value.postcode}</p>
            </div>
          </div>
        </div>
      )}

      <p className="mt-1 text-xs text-gray-400">
        📍 Powered by adresse.data.gouv.fr
      </p>
    </div>
  );
}
