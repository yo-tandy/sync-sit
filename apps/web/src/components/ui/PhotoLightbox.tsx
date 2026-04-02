import { useState } from 'react';
import { Avatar } from './Avatar';

interface PhotoLightboxProps {
  src?: string;
  initials: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Avatar that opens a full-screen lightbox when clicked (if photo exists).
 * Click again to close.
 */
export function PhotoLightbox({ src, initials, size = 'md', className }: PhotoLightboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={src ? () => setOpen(true) : undefined}
        className={src ? 'cursor-pointer' : ''}
      >
        <Avatar initials={initials} src={src} size={size} className={className} />
      </button>

      {open && src && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpen(false)}
        >
          <img
            src={src}
            alt=""
            className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
