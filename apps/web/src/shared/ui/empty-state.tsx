/** @module 책임: 무엇이 비었는지 모르는 채 제목·상태말·설명·행동 슬롯만 카드 하나에 배치한다. */
import type { ReactNode } from 'react';

type EmptyStateProps = {
  readonly title: string;
  /** 제목 옆에 붙는 짧은 상태말이다. 없으면 자리도 만들지 않는다. */
  readonly status?: string;
  readonly description: string;
  /** 조건 해제처럼 사용자가 할 수 있는 행동 하나다. */
  readonly action?: ReactNode;
};

/**
 * 문구는 화면이 넘긴다. 이 컴포넌트가 상태나 enum에서 문구를 되읽으면 같은 사실을 두 곳이 말하게 되고,
 * 화면마다 다른 사정(수집 전인지 조건 때문인지)을 한 문장으로 뭉갠다(apps/web AGENTS.md).
 */
export function EmptyState({ title, status, description, action }: EmptyStateProps) {
  return (
    <div className='rounded-xl bg-card p-4 shadow-xs'>
      <div className='flex items-baseline gap-2'>
        <span className='text-xl font-bold'>{title}</span>
        {status === undefined ? null : <span className='text-[13px] font-semibold text-muted-foreground'>{status}</span>}
      </div>
      <p className='mt-2 text-[15px] font-medium text-muted-foreground'>{description}</p>
      {action === undefined ? null : <div className='mt-3'>{action}</div>}
    </div>
  );
}
