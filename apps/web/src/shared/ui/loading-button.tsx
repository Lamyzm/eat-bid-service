'use client';

import { useId } from 'react';

import { cn } from '@/shared/lib/cn';
import { Button, type ButtonProps } from './button';
import { Spinner } from './spinner';

export interface LoadingButtonProps extends Omit<ButtonProps, 'className'> {
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  readonly className?: string;
}

/** label의 geometry와 focus를 보존하면서 중복 실행만 막는 공통 pending control이다. */
export function LoadingButton({
  loading = false,
  loadingLabel = '처리 중…',
  disabled,
  focusableWhenDisabled,
  className,
  children,
  'aria-describedby': describedBy,
  ...props
}: LoadingButtonProps) {
  const statusId = useId();
  const gap = props.size === 'sm' || props.size === 'xs' ? 'gap-1' : 'gap-1.5';
  const loadingDescription = loading
    ? [describedBy, statusId].filter(Boolean).join(' ')
    : describedBy;

  return (
    <>
      <Button
        {...props}
        disabled={disabled || loading}
        focusableWhenDisabled={loading || focusableWhenDisabled}
        aria-busy={loading || undefined}
        aria-describedby={loadingDescription}
        className={cn('relative', loading && 'aria-disabled:opacity-100', className)}
      >
        {loading ? <Spinner aria-hidden className='absolute inset-0 m-auto' /> : null}
        <span className={cn('inline-flex items-center', gap, loading && 'opacity-0')}>
          {children}
        </span>
      </Button>
      <span id={statusId} role='status' aria-live='polite' className='sr-only'>
        {loading ? loadingLabel : ''}
      </span>
    </>
  );
}
