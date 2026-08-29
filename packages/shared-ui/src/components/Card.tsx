import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  interactive?: boolean;
  borderColor?: string;
  children: ReactNode;
}

export function Card({
  elevated = false,
  interactive = false,
  borderColor,
  className = '',
  children,
  ...props
}: CardProps) {
  // `shadow-card`, not a hardcoded arbitrary value. The elevation used to be
  // inlined here, which meant --shadow-card existed as a token but nothing
  // read it — so the Recess pass (#366) would have changed the token and not
  // a single card. Cards stay white ON the tinted ground, so they read as
  // raised rather than flush — but via `bg-ground-raised`, not a literal
  // `bg-white` (review round 1): that token was defined in all three brand
  // files and read nowhere, which is the same bug one level down. It resolves
  // to #ffffff in every app today, so this is a no-op visually and a real one
  // structurally — raised surfaces are now themeable from one place.
  //
  // CASCADE-NEUTRAL, verified against built CSS (review round 5), because the
  // colour resolving the same says nothing about which rule wins. Conflicting
  // utilities resolve by generated-stylesheet order, not class-attribute
  // order — the shape of issue #226. In apps/web/dist the emitted order is
  // amber-50 < blue-50 < brand-50 < gray-50 < green-50 < ground-raised <
  // white, so swapping the base from `bg-white` to `bg-ground-raised` moves it
  // EARLIER, i.e. weaker. Rebuilding with `bg-white` restored produced a
  // byte-identical stylesheet, so no call site changes behaviour either way.
  //
  // What that check DID surface is pre-existing and not this pass's: 34 of the
  // 37 `<Card className="bg-*">` call sites name a colour emitted before the
  // base, so their override never applied — the amber and blue banners have
  // been rendering white all along, before this change and after it. Tracked
  // separately; do not "fix" it here by reordering, because making 34 banners
  // suddenly change colour is a visual decision, not a refactor.
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-ground-raised p-4 ${
        elevated ? 'shadow-card' : ''
      } ${
        interactive ? 'cursor-pointer transition-all hover:shadow-card-brand hover:-translate-y-px' : ''
      } ${className}`}
      style={borderColor ? { borderLeftWidth: 3, borderLeftColor: borderColor } : undefined}
      {...props}
    >
      {children}
    </div>
  );
}
