type AvatarSize = 'sm' | 'md' | 'lg';

interface AvatarProps {
  initials: string;
  size?: AvatarSize;
  bgColor?: string;
  textColor?: string;
  src?: string;
  className?: string;
}

const sizeClasses: Record<AvatarSize, string> = {
  sm: 'h-9 w-9 text-sm',
  md: 'h-12 w-12 text-lg',
  lg: 'h-16 w-16 text-xl',
};

export function Avatar({
  initials,
  size = 'md',
  bgColor = 'bg-gray-200',
  textColor = 'text-gray-500',
  src,
  className = '',
}: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={initials}
        className={`flex-shrink-0 rounded-full object-cover ${sizeClasses[size]} ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center rounded-full font-semibold ${bgColor} ${textColor} ${sizeClasses[size]} ${className}`}
    >
      {initials}
    </div>
  );
}
