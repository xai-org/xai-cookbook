import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Why? tailwind-merge misclassifies custom `text-*` utilities as font-size or color conflicts.
 * `text-xxs` needs registering as a font-size so it merges correctly against other sizes.
 * `text-mono-caps` and `text-group-header` are standalone utilities — registering them in their own
 * group prevents tailwind-merge from stripping them when other `text-*` classes are present.
 *
 * livekit.com splits this in two: @repo/bytes-react ships this extended merge for its own
 * components, while apps/www keeps a plain `twMerge` for the shadcn ones. Both sets of components
 * share one `cn` here, so it has to be the extended version — under a plain merge the badge's
 * `text-mono-caps` loses to the `text-xs` from its size variant, and the badge renders in sans
 * sentence case instead of uppercase monospace.
 */
const customTwMerge = extendTailwindMerge<'lk-typography'>({
  extend: {
    classGroups: {
      'font-size': [{ text: ['xxs'] }],
      'lk-typography': ['text-mono-caps', 'text-group-header'],
    },
    conflictingClassGroups: {
      // these set font-family via `@apply font-mono`, so last one wins over font-sans/font-mono
      'lk-typography': ['font-family'],
      'font-family': ['lk-typography'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs));
}
