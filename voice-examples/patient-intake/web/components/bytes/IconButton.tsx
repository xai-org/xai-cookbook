import * as React from 'react';
import { type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Button, buttonVariants } from './Button';

// Vendored from @repo/bytes-react. Upstream wraps the button in a ToggleTip unless
// `tooltip={false}`; this app only ever passes `false`, so the tooltip path (and its Radix
// dependencies) is dropped and the prop is kept solely to preserve the call signature.

export type IconButtonSize = 'sm' | 'lg' | 'xl';

export const ICON_BUTTON_SIZE_MAP: Record<
  IconButtonSize,
  {
    buttonSize: Exclude<VariantProps<typeof buttonVariants>['size'], null | undefined>;
    iconClass: string;
  }
> = {
  sm: { buttonSize: 'icon-sm', iconClass: 'size-4' },
  lg: { buttonSize: 'icon-lg', iconClass: 'size-4' },
  xl: { buttonSize: 'icon-xl', iconClass: 'size-5' },
};

export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  children: React.ReactElement<{ className?: string }>;
  label: string;
  variant?: VariantProps<typeof buttonVariants>['variant'];
  size?: IconButtonSize;
  tooltip?: false;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ children, label, variant, size = 'sm', className, tooltip: _tooltip, ...props }, ref) => {
    const { buttonSize, iconClass } = ICON_BUTTON_SIZE_MAP[size];
    const content = React.cloneElement(children, {
      ...children.props,
      className: cn(iconClass, children.props.className),
    });

    return (
      <Button
        ref={ref}
        variant={variant}
        size={buttonSize}
        aria-label={label}
        className={className}
        {...props}
      >
        {content}
      </Button>
    );
  },
);
IconButton.displayName = 'IconButton';

export { IconButton };
