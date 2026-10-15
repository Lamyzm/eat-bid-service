/**
 * @module 책임: 오늘 투찰의 화면 상태(목록·관심 지역 미확인·권한 없음·조회 실패)를 하나씩 그린다. 상태마다 사용자가 할 일이 다르므로
 * 같은 빈 화면으로 합치지 않는다.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';

import { BidBoardList } from '../_features/bid-board/ui/bid-board-list';
import { ItemChips } from '../_features/bid-board/ui/item-chips';
import { SchoolFilterProvider, SchoolSearch } from '../_features/bid-board/ui/school-filter';
import type { WorkView } from '../_lib/load-work-page';
import { WorkFrame } from './work-frame';

/** 목록이 어떤 범위로 걸러졌는지 말한다. 지역과 사업자는 설정 화면이 소유하므로 바꾸는 길만 잇는다. 품목은 바로 아래 단추가 바꾼다. */
function ConditionLine({ summary }: { readonly summary: string }) {
  return (
    <p className='mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-[13px] font-semibold'>
      <span>{summary}</span>
      <Link href='/setup' className='font-bold text-primary hover:underline'>내 사업자에서 바꾸기</Link>
    </p>
  );
}

function Notice({ title, body, action }: { readonly title: string; readonly body: string; readonly action?: React.ReactNode }) {
  return (
    <div role='status' className='mt-8 grid max-w-xl gap-2 rounded-xl bg-muted px-5 py-4'>
      <p className='text-[15px] font-bold'>{title}</p>
      <p className='text-[14px] text-muted-foreground'>{body}</p>
      {action}
    </div>
  );
}

export function WorkScreen({ view, floorEntry = null }: { readonly view: WorkView; readonly floorEntry?: ReactNode }) {
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
          // 설정 화면 맨 위는 사업자 목록이라 그냥 보내면 "사업자를 등록하라"로 읽힌다(EAT-338). 지역 칸으로 바로 보내고 말로도 적는다.
          body='오늘 투찰은 저장한 관심 지역(참가제한지역)의 공고만 보여요. 사업자는 다시 등록하지 않아도 돼요 — 내 설정의 "내 지역" 칸에서 지역을 고르고 저장하세요.'
          action={
            <Link href='/setup#region-preference' className='text-[14px] font-bold text-primary hover:underline'>
              내 지역 칸으로 가기
            </Link>
          }
        />
      </WorkFrame>
    );
  }
  // 학교 거르기는 이미 받은 행만 좁힌다. 검색 칸과 목록이 같은 검색어를 보도록 화면 전체를 감싼다.
  const targets = view.groups.flatMap((group) => group.rows.map((row) => ({ organization: row.organization, title: row.title })));
  const filters = (
    <>
      <ConditionLine summary={view.summary} />
      <ItemChips />
      {targets.length === 0 ? null : <SchoolSearch />}
    </>
  );
  return (
    <SchoolFilterProvider targets={targets}>
      <WorkFrame lede={view.lede} stamp={view.stamp} filters={filters} entry={floorEntry}>
        {view.truncatedNote === null ? null : (
          <p role='status' className='mt-4 rounded-lg border border-dashed border-border px-3 py-2 text-[13px] font-semibold'>
            {view.truncatedNote}
          </p>
        )}
        {view.groups.length === 0 ? null : <BidBoardList view={view} />}
      </WorkFrame>
    </SchoolFilterProvider>
  );
}
