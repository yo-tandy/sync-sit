import { forwardRef, type ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
type ButtonSize = 'default' | 'sm' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Buttons are full-width by default (the app's mobile-first idiom). Pass
   * false for an intrinsic-width button. This is a PROP, not a className
   * override, because a caller's `w-auto` cannot reliably beat the base
   * `w-full` -- conflicting Tailwind utilities resolve by generated-stylesheet
   * order, not by position in the class attribute, and `w-full` wins that
   * order. Four call sites had written `w-auto` believing it worked; the
   * result was a full-width button painted over its row (issue #226).
   */
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-600/90 disabled:opacity-50',
  secondary:
    'bg-gray-100 text-gray-950 border border-gray-200 hover:bg-gray-200',
  outline:
    'bg-white text-gray-950 border-[1.5px] border-gray-300 hover:border-gray-950',
  ghost: 'bg-transparent text-brand-600 hover:bg-brand-50',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: 'h-[52px] px-6 text-base rounded-xl',
  sm: 'h-10 px-4 text-sm rounded-md',
  icon: 'h-10 w-10 rounded-full p-0',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'default', fullWidth = true, className = '', children, ...props }, ref) => {
    // icon is intrinsically sized by its token (w-10); emitting w-full/w-auto
    // beside it would re-create the stylesheet-order coin toss this prop
    // exists to eliminate (PR #229 review).
    const widthClass = size === 'icon' ? '' : fullWidth ? 'w-full' : 'w-auto';
    return (
      <button
        ref={ref}
        className={`inline-flex ${widthClass} items-center justify-center gap-2 font-semibold transition-all cursor-pointer disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
