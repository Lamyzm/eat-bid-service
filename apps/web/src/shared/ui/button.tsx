/** @module 책임: 접근성·시각 variant·크기 셋·공통 누름(0.96배·70ms)만 소유하는 기본 Button을 제공한다. */
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/shared/lib/cn';

export type ButtonInteraction = 'press' | 'quiet';

// 크기는 셋이다(#240): 기본 48px·17px·bold, 작은 단추 40px·14px, 아이콘 단추 40·48px. 32px 이하는 만들지 않는다 —
// 60대 사용자가 PC에서 누르는 자리라 손가락이 아니라 눈으로 찾는 크기가 기준이다. 옛 이름(xs·lg·icon-xs …)은 지우지 않고
// 이 셋 중 하나로 접어, 부르는 화면을 고치지 않아도 같은 크기 체계에 들어오게 한다.
export const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-control border border-transparent bg-clip-padding font-bold whitespace-nowrap outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline:
          'bg-muted text-foreground hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] aria-expanded:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)]',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
        destructive:
          'bg-danger-weak text-danger hover:bg-[color-mix(in_oklch,var(--color-danger-weak),var(--color-danger)_10%)] focus-visible:ring-destructive/30',
        link: 'text-brand-strong underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-12 gap-2 px-5 text-body',
        lg: 'h-12 gap-2 px-5 text-body',
        sm: "h-10 gap-1.5 px-4 text-label [&_svg:not([class*='size-'])]:size-4",
        xs: "h-10 gap-1.5 px-4 text-label [&_svg:not([class*='size-'])]:size-4",
        icon: 'size-10',
        'icon-xs': 'size-10',
        'icon-sm': 'size-10',
        'icon-lg': 'size-12'
      },
      interaction: {
        press: 'pressable',
        quiet: 'transition-colors duration-[var(--motion-duration-state)]'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
      interaction: 'press'
    }
  }
);

export type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    readonly interaction?: ButtonInteraction;
  };

/** 시각·접근성·공통 press만 소유하며 실제 행동은 호출자가 주입한다. */
export function Button({
  className,
  variant = 'default',
  size = 'default',
  interaction,
  ...props
}: ButtonProps) {
  const resolvedInteraction = interaction ?? (variant === 'link' ? 'quiet' : 'press');

  return (
    <ButtonPrimitive
      data-slot='button'
      data-interaction={resolvedInteraction}
      className={cn(buttonVariants({ variant, size, interaction: resolvedInteraction, className }))}
      {...props}
    />
  );
}
