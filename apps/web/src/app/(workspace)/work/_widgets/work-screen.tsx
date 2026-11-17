/**
 * @module 책임: 넣을 공고의 화면 상태(목록·관심 지역 미확인·사업장 없음·권한 없음·조회 실패)를 하나씩 그린다. 상태마다 사용자가
 * 할 일이 다르므로 같은 빈 화면으로 합치지 않는다.
 */
import Link from 'next/link';

import { ClosingDays } from '../_features/pass-values/ui/closing-days';
import { ValueCards } from '../_features/pass-values/ui/value-cards';
import type { WorkView } from '../_lib/load-work-page';
import { WorkFrame } from './work-frame';

function Notice({ title, action }: { readonly title: string; readonly action?: React.ReactNode }) {
  return (
    <div role='status' className='mt-8 grid max-w-xl gap-2 rounded-xl bg-muted px-5 py-4'>
      <p className='text-[17px] font-bold'>{title}</p>
      {action}
    </div>
  );
}

const linkClass = 'text-[16px] font-bold text-primary hover:underline';

export function WorkScreen({ view }: { readonly view: WorkView }) {
  if (view.kind === 'forbidden') return <WorkFrame stamp={null}><Notice title='이 화면을 볼 권한이 없어요.' /></WorkFrame>;
  if (view.kind === 'failed') return <WorkFrame stamp={null}><Notice title='넣을 공고를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.' /></WorkFrame>;
  if (view.kind === 'region-unconfirmed') {
    return (
      <WorkFrame stamp={null}>
        <Notice title='관심 지역을 먼저 정하세요.' action={<Link href='/setup#region-preference' className={linkClass}>내 지역 칸으로 가기</Link>} />
      </WorkFrame>
    );
  }
  if (view.kind === 'no-business') {
    return (
      <WorkFrame stamp={null}>
        <Notice title='등록한 사업장이 없어요.' action={<Link href='/setup' className={linkClass}>사업장 등록하기</Link>} />
      </WorkFrame>
    );
  }
  return (
    <WorkFrame stamp={`${view.asOfText} 기준`}>
      <ValueCards monthLabel={view.monthLabel} cards={view.cards} />
      {view.truncated ? (
        <p role='status' className='mt-4 rounded-lg border border-dashed border-border px-3 py-2 text-[15px] font-semibold'>
          늦게 마감하는 공고 일부를 읽지 못했어요.
        </p>
      ) : null}
      <ClosingDays days={view.days} businessNames={view.businessNames} />
    </WorkFrame>
  );
}
