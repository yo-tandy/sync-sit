import { forwardRef, useState, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  tooltip?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, tooltip, className = '', id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    const [showTooltip, setShowTooltip] = useState(false);

    return (
      <div className="mb-5">
        {label && (
          <div className="mb-2 flex items-center gap-1.5">
            <label
              htmlFor={inputId}
              className="block text-sm font-medium text-gray-700"
            >
              {label}
            </label>
            {tooltip && (
              <div className="relative">
                <button
                  type="button"
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-500 hover:bg-gray-300 hover:text-gray-700 transition-colors"
                  onClick={() => setShowTooltip(!showTooltip)}
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                  aria-label="More info"
                >
                  ?
                </button>
                {showTooltip && (
                  <div className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs leading-relaxed text-white shadow-lg">
                    {tooltip}
                    <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`h-12 w-full rounded-lg border-[1.5px] bg-white px-4 text-base text-gray-950 outline-none transition-colors placeholder:text-gray-400 ${
            error
              ? 'border-red-600 focus:border-red-600'
              : 'border-gray-300 focus:border-red-600'
          } ${className}`}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        {hint && !error && (
          <p className="mt-1 text-xs text-gray-400">{hint}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
