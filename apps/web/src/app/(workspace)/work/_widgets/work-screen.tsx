/**
 * @module 책임: 오늘 투찰의 화면 상태(목록·관심 지역 미확인·권한 없음·조회 실패)를 하나씩 그린다. 상태마다 사용자가 할 일이 다르므로
 * 같은 빈 화면으로 합치지 않는다.
 */
import Link from 'next/link';

import { BidBoardList } from '../_features/bid-board/ui/bid-board-list';
import { ItemChips } from '../_features/bid-board/ui/item-chips';
import type { WorkView } from '../_lib/load-work-page';
import { WorkFrame } from './work-frame';

function Notice({ title, body, action }: { readonly title: string; readonly body: string; readonly action?: React.ReactNode }) {
  return (
    <div role='status' className='mt-8 grid max-w-xl gap-2 rounded-xl bg-muted px-5 py-4'>
      <p className='text-[15px] font-bold'>{title}</p>
      <p className='text-[14px] text-muted-foreground'>{body}</p>
      {action}
    </div>
  );
}

export function WorkScreen({ view }: { readonly view: WorkView }) {
  if (view.kind === 'forbidden') {
    return (
      <WorkFrame lede={null} stamp={null} filters={null}>
        <Notice title='이 화면을 볼 권한이 없어요.' body='오늘 투찰은 운영자 계정에서만 열려요.' />
      </WorkFrame>
    );
  }
  if (view.kind === 'failed') {
    return (
      <WorkFrame lede={null} stamp={null} filters={null}>
        <Notice title='오늘 투찰을 불러오지 못했어요.' body='잠시 뒤 새로고침해 주세요.' />
      </WorkFrame>
    );
  }
  if (view.kind === 'region-unconfirmed') {
    return (
      <WorkFrame lede={null} stamp={null} filters={null}>
        <Notice
          title='관심 지역을 먼저 정하세요.'
          body='오늘 투찰은 저장한 관심 지역(참가제한지역)의 공고만 보여요.'
          action={<Link href='/setup' className='text-[14px] font-bold text-primary hover:underline'>관심 지역 정하기</Link>}
        />
      </WorkFrame>
    );
  }
  return (
    <WorkFrame lede={view.lede} stamp={view.stamp} filters={<ItemChips />}>
      {view.groups.length === 0 ? null : <BidBoardList view={view} />}
    </WorkFrame>
  );
}
