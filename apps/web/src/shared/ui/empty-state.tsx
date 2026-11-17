/**
 * @module 책임: 빈 상태와 읽기 실패를 같은 꼴 두 크기(구역 안·화면 전체)로 그린다. 읽기 실패의 "다시 시도"는 누른 뒤 초점을 이
 * 덩이의 제목으로 돌려, 다시 불러온 결과를 화면 읽기 사용자도 같은 자리에서 듣게 한다(#240).
 */
'use client';

import { useRef, type ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';

type Size = 'section' | 'page';

type EmptyStateProps = {
  readonly title: string;
  /** 제목 옆에 붙는 짧은 상태말이다. 없으면 자리도 만들지 않는다. */
  readonly status?: string;
  readonly description?: string;
  /** 조건 해제처럼 사용자가 할 수 있는 행동 하나다. */
  readonly action?: ReactNode;
  /** `section`은 판 안의 한 덩이, `page`는 화면에 이것 하나만 있을 때다. */
  readonly size?: Size;
  readonly role?: 'status' | 'alert';
  readonly titleRef?: React.Ref<HTMLParagraphElement>;
};

/**
 * 문구는 화면이 넘긴다. 이 컴포넌트가 상태나 enum에서 문구를 되읽으면 같은 사실을 두 곳이 말하게 되고,
 * 화면마다 다른 사정(수집 전인지 조건 때문인지)을 한 문장으로 뭉갠다(apps/web AGENTS.md).
 */
export function EmptyState({
  title,
  status,
  description,
  action,
  size = 'section',
  role = 'status',
  titleRef
}: EmptyStateProps) {
  return (
    <div
      role={role}
      data-slot='empty-state'
      data-size={size}
      className={cn(
        'grid max-w-notice content-start gap-2 rounded-panel bg-card',
        size === 'page' ? 'px-6 py-8' : 'px-5 py-5'
      )}
    >
      <div className='flex flex-wrap items-baseline gap-2'>
        <p
          ref={titleRef}
          tabIndex={-1}
          className={cn('font-bold outline-none', size === 'page' ? 'text-title' : 'text-body')}
        >
          {title}
        </p>
        {status === undefined ? null : (
          <span className='text-label font-semibold text-muted-foreground'>{status}</span>
        )}
      </div>
      {description === undefined ? null : (
        <p className='text-body text-muted-foreground'>{description}</p>
      )}
      {action === undefined ? null : <div className='mt-2'>{action}</div>}
    </div>
  );
}

type ReadFailureProps = {
  readonly title: string;
  readonly description?: string;
  readonly onRetry: () => void;
  readonly size?: Size;
};

/** 읽기 실패 한 덩이. 빈 상태와 같은 꼴이며 "다시 시도" 하나를 가진다. */
export function ReadFailure({ title, description, onRetry, size = 'section' }: ReadFailureProps) {
  const titleRef = useRef<HTMLParagraphElement>(null);
  return (
    <EmptyState
      role='alert'
      size={size}
      title={title}
      description={description}
      titleRef={titleRef}
      action={
        <Button
          variant='secondary'
          onClick={() => {
            onRetry();
            titleRef.current?.focus();
          }}
        >
          다시 시도
        </Button>
      }
    />
  );
}
