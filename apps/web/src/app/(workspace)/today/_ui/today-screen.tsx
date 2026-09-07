/** @module 책임: 오늘 화면을 조립한다. 제목·기준 시각, 조건 칩, 그리고 계보 없음·결과 0·목록 세 상태를 서로 다른 문구로 분기한다. */
import Link from 'next/link';

import { buildTodayRoute, type TodaySearch } from '../_lib/today-search-params';
import type { TodayPageData } from '../_model/load-today-page';
import { OpenAuctionTable } from './open-auction-table';
import { TodayFrame } from './today-frame';
import { TodayFilters, describeTodaySearch } from './today-filters';

// 지역 칩의 표시 이름은 응답 행에서 읽는다. 지역 어휘 계약이 없는 동안 그 id의 라벨을 아는 곳은 행뿐이다.
function regionTextOf(data: TodayPageData): string | null {
  const { region } = data.search;
  if (region === null) return null;
  for (const row of data.presentation.rows) {
    for (const reference of [row.region.sido, row.region.sigungu]) {
      if (reference?.codeValueId === region) return reference.text;
    }
  }
  return null;
}

function NoSnapshot() {
  return (
    <div className='rounded-xl bg-card p-4 shadow-xs'>
      <div className='flex items-baseline gap-2'>
        <span className='text-xl font-bold'>열린 공고</span>
        <span className='text-[13px] font-semibold text-muted-foreground'>수집 전</span>
      </div>
      {/* 활성 build가 없는 것은 오류가 아니라 파생물이 아직 만들어지지 않은 정상 상태다(ADR 0011·0034). */}
      <p className='mt-2 text-[15px] font-medium text-muted-foreground'>열린 공고 스냅샷이 아직 만들어지지 않았습니다.</p>
    </div>
  );
}

function EmptyResult({ search, regionText }: { readonly search: TodaySearch; readonly regionText: string | null }) {
  const sentence = describeTodaySearch(search, regionText);
  return (
    <div className='rounded-xl bg-card p-4 shadow-xs'>
      <span className='text-xl font-bold'>열린 공고</span>
      <p className='mt-2 text-[15px] font-medium text-muted-foreground'>
        {sentence === null ? '지금 열린 공고가 없습니다.' : `${sentence} 조건에서 열린 공고가 없습니다.`}
      </p>
      {/* 조건을 자동으로 넓히지 않는다. 사용자가 해제를 누른다. */}
      {sentence === null ? null : (
        <Link href='/today' className='mt-3 inline-flex h-8 items-center rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold hover:bg-foreground/10'>
          조건 모두 해제
        </Link>
      )}
    </div>
  );
}

export function TodayScreen({ data }: { readonly data: TodayPageData }) {
  const { presentation, search } = data;
  const regionText = regionTextOf(data);
  return (
    <TodayFrame
      header={
        <div className='flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1'>
          <h1 id='today-title' className='text-xl font-bold tracking-tight'>오늘</h1>
          {presentation.hasSnapshotBuild ? (
            <span className='text-[15px] font-semibold whitespace-nowrap text-muted-foreground'>열린 공고 {presentation.sampleCount}건</span>
          ) : null}
          <span className='ml-auto text-[13px] font-semibold whitespace-nowrap text-muted-foreground'>{presentation.asOfText} 기준</span>
        </div>
      }
      filters={<TodayFilters search={search} regionText={regionText} />}
      list={
        !presentation.hasSnapshotBuild ? (
          <NoSnapshot />
        ) : presentation.rows.length === 0 ? (
          <EmptyResult search={search} regionText={regionText} />
        ) : (
          <div className='overflow-hidden rounded-xl bg-card shadow-xs'>
            <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pt-4'>
              <span className='text-xl font-bold'>마감 임박 순</span>
              <span className='text-[13px] font-semibold text-muted-foreground'>
                {presentation.rows.length}건 표시 · 전체 {presentation.sampleCount}건
              </span>
              {data.cursorReset ? (
                <span className='text-[13px] font-semibold text-pushed'>목록이 갱신되어 처음부터 다시 보입니다.</span>
              ) : null}
            </div>
            {/* 표본 수·계보·산출 시각은 각주가 아니라 표 위 한 줄이다(AGENTS 7). */}
            <p className='px-4 py-2 text-[13px] font-medium text-muted-foreground'>{presentation.lineageText}</p>
            <OpenAuctionTable rows={presentation.rows} search={search} />
            {presentation.nextCursor !== null ? (
              <div className='flex justify-end px-4 py-3'>
                <Link href={buildTodayRoute({ ...search, cursor: presentation.nextCursor })} className='inline-flex h-8 items-center rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold hover:bg-foreground/10'>
                  다음 공고 보기
                </Link>
              </div>
            ) : null}
          </div>
        )
      }
    />
  );
}
