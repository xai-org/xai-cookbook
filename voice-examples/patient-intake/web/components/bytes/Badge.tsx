import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// Vendored from @repo/bytes-react. The class strings are copied verbatim so the badge renders
// identically to livekit.com; the upstream `tooltip` and `asChild` paths are dropped because
// nothing here uses them (they pull in ToggleTip and its Radix dependencies).

export const sizes = {
  large: 'px-1.5 py-0.5 text-xs ',
  medium: 'px-1 py-0.5 text-xxs',
} as const;

export const variants = {
  muted: 'bg-bg3 text-fg3',
  accent: 'bg-bgAccentPrimary2 text-fgAccentPrimary1',
  accent2: 'bg-bgAccentSecondary2 text-fgAccentSecondary1',
  success: 'bg-bgSuccess2 text-fgSuccess',
  warning: 'bg-bgModerate2 text-fgModerate',
  error: 'bg-bgSerious2 text-fgSerious1',
  fatal: 'bg-fgSerious1 text-bgSerious2',
} as const;

const badgeVariants = cva(
  'text-mono-caps pointer-events-none inline-flex h-min w-fit items-center justify-center gap-1 rounded font-semibold whitespace-nowrap select-none',
  {
    variants: {
      size: sizes,
      variant: variants,
    },
    defaultVariants: {
      size: 'medium',
      variant: 'muted',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
  leftIcon?: React.ReactElement<{ className?: string }>;
  rightIcon?: React.ReactElement<{ className?: string }>;
}

function sizeIcon(variant: VariantProps<typeof badgeVariants>['size']) {
  return ((size) => {
    switch (size) {
      case 'medium':
        return 'w-2.5 h-2.5';
      case undefined:
      case null:
      case 'large':
        return 'w-3 h-3';
    }
  })(variant);
}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, size, leftIcon, rightIcon, children, ...props }, ref) => {
    const iconSize = sizeIcon(size);
    const leftIconPrepared =
      leftIcon &&
      React.cloneElement(leftIcon, {
        className: cn(iconSize, leftIcon.props?.className),
      });
    const rightIconPrepared =
      rightIcon &&
      React.cloneElement(rightIcon, {
        className: cn(iconSize, rightIcon.props?.className),
      });

    return (
      <div className={cn(badgeVariants({ variant, size, className }))} ref={ref} {...props}>
        {leftIconPrepared}
        {children}
        {rightIconPrepared}
      </div>
    );
  },
);
Badge.displayName = 'Badge';

export { Badge };
