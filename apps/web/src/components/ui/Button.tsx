import { forwardRef, type ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
type ButtonSize = 'default' | 'sm' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-red-600 text-white hover:bg-red-600/90 disabled:opacity-50',
  secondary:
    'bg-gray-100 text-gray-950 border border-gray-200 hover:bg-gray-200',
  outline:
    'bg-white text-gray-950 border-[1.5px] border-gray-300 hover:border-gray-950',
  ghost: 'bg-transparent text-red-600 hover:bg-red-50',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: 'h-[52px] px-6 text-base rounded-xl',
  sm: 'h-10 px-4 text-sm rounded-lg',
  icon: 'h-10 w-10 rounded-full p-0',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'default', className = '', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex w-full items-center justify-center gap-2 font-semibold transition-all cursor-pointer disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
