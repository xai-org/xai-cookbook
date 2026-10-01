import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  [
    'group relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded border font-sans transition-all',
    'focus-visible:ring-fgAccentPrimary1 focus-visible:ring-offset-bg1 focus-visible:ring-1 focus-visible:ring-offset-2 focus-visible:outline-hidden',
    // apply active scale when NOT aria-disabled (works for <button> and <a aria-disabled="true">)
    '[&:not([aria-disabled="true"])]:active:scale-[99%]',
    // keep native disabled for <button> + aria-disabled support for anchors
    'disabled:cursor-not-allowed disabled:opacity-60',
    'aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
    '[&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-fgAccentPrimary1 text-bg1 border-none ' +
          // hover/active only when NOT aria-disabled (covers <button> and <a>)
          '[&:not([aria-disabled="true"])]:hover:bg-fgAccentPrimary2 [&:not([aria-disabled="true"])]:active:bg-fgAccentPrimary1' +
          'disabled:bg-gray-400',
        secondary:
          'border-separator1 bg-bg2 text-fg1 ' +
          '[&:not([aria-disabled="true"])]:hover:border-separator2 [&:not([aria-disabled="true"])]:hover:bg-bg3 [&:not([aria-disabled="true"])]:active:bg-bg2',
        outline:
          'border-separator1 bg-bg1 text-fg1 ' +
          '[&:not([aria-disabled="true"])]:hover:border-separator2 [&:not([aria-disabled="true"])]:hover:bg-bg2 [&:not([aria-disabled="true"])]:hover:text-fg1 [&:not([aria-disabled="true"])]:active:bg-bg1',
        ghost:
          'text-fg1 border-none bg-transparent ' +
          '[&:not([aria-disabled="true"])]:hover:bg-bg2 [&:not([aria-disabled="true"])]:active:bg-transparent',
        destructive:
          'border-separatorSerious1 bg-bgSerious1 text-fgSerious1 focus-visible:ring-fgSerious1 ' +
          '[&:not([aria-disabled="true"])]:hover:bg-fgSerious1 [&:not([aria-disabled="true"])]:hover:text-bg1 [&:not([aria-disabled="true"])]:active:bg-bgSerious2 [&:not([aria-disabled="true"])]:hover:border-transparent',
      },
      size: {
        sm: 'h-7 px-3 py-1 text-xs font-semibold',
        lg: 'h-9 px-3 py-2 text-base font-semibold',
        xl: 'h-11 gap-3 p-3 font-semibold text-[0,875rem]',
        'icon-sm': 'inline-grid size-7 place-items-center p-0',
        'icon-lg': 'inline-grid size-9 place-items-center p-0',
        'icon-xl': 'inline-grid size-11 place-items-center p-0',
        // @deprecated — use <IconButton> instead
        icon: 'inline-grid size-7 place-items-center p-0',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'sm',
    },
  },
);

const BUTTON_VARIANTS: Exclude<VariantProps<typeof buttonVariants>['variant'], null | undefined>[] =
  ['primary', 'secondary', 'outline', 'ghost', 'destructive'] as const;
const BUTTON_SIZES: Exclude<VariantProps<typeof buttonVariants>['size'], null | undefined>[] = [
  'sm',
  'lg',
  'icon',
  'icon-sm',
  'icon-lg',
  'icon-xl',
] as const;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  leftIcon?: React.ReactElement;
  rightIcon?: React.ReactElement;
}

export function prepareIcon(
  icon: React.ReactElement,
  buttonSize?: (typeof BUTTON_SIZES)[number] | null,
): React.ReactElement {
  let extraClassNames = 'size-3';
  switch (buttonSize) {
    case 'lg':
    case 'xl':
    case 'icon-lg':
    case 'icon-xl':
      extraClassNames = 'size-4';
      break;
  }

  return React.cloneElement(icon, {
    // @ts-expect-error React 19
    ...icon.props,
    // @ts-expect-error React 19
    className: cn(extraClassNames, icon.props.className, 'group-data-[pending=true]:opacity-0'),
  });
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps & { asChild?: boolean }>(
  ({ className, variant, size, leftIcon, rightIcon, asChild = false, ...props }, ref) => {
    if (size === 'icon' && process.env.NODE_ENV === 'development') {
      console.warn('Button size "icon" is deprecated — use <IconButton> instead.');
    }

    const leftIconPrepared = leftIcon ? prepareIcon(leftIcon, size) : null;
    const rightIconPrepared = rightIcon ? prepareIcon(rightIcon, size) : null;

    // If asChild, use Slot so ref and props are merged without reading ref during render (React 19).
    if (asChild && React.isValidElement(props.children)) {
      type ChildProps = { children?: React.ReactNode; className?: string };
      const child = React.Children.only(props.children) as React.ReactElement<ChildProps>;
      const childWithContent = React.cloneElement(child, {
        children: (
          <>
            {leftIconPrepared}
            {child.props.children}
            {rightIconPrepared}
          </>
        ),
      });
      return (
        <Slot
          ref={ref}
          className={cn(buttonVariants({ variant, size, className }), child.props.className)}
          {...props}
        >
          {childWithContent}
        </Slot>
      );
    }

    return (
      <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
        {leftIconPrepared}
        {props.children}
        {rightIconPrepared}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, BUTTON_VARIANTS };
