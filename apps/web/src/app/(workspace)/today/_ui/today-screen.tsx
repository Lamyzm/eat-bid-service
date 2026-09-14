/** @module 책임: 오늘 화면을 조립한다. 제목·기준 시각과 조건 칩을 두고, 목록 자리는 표시 모델이 정한 세 상태(계보 없음·결과 0·목록)를 그대로 고른다. */
import Link from 'next/link';

import { EmptyState } from '@/shared/ui/empty-state';

import { RegionScopeStrip, RegionSetupRequest } from '../_features/region-scope/ui/region-scope-strip';
import { buildTodayFilterRoute, buildTodayRoute, type TodaySearch } from '../_lib/today-search-params';
import type { TodayPageData } from '../_model/load-today-page';
import { summarizeFloorRates, type OpenAuctionListPresentation, type OpenAuctionRowPresentation } from '../_model/present-open-auctions';
import { kstToday, type OpenSummaryPresentation } from '../_model/present-open-summary';
import { OpenAuctionTable } from './open-auction-table';
import { TodayFrame } from './today-frame';
import { TodayFilters, describeTodaySearch } from './today-filters';
import { TodayTabs } from './today-tabs';

// 지역 칩의 표시 이름은 응답 행에서 읽는다. 지역 어휘 계약이 없는 동안 그 id의 라벨을 아는 곳은 행뿐이다.
function regionTextOf(rows: readonly OpenAuctionRowPresentation[], region: string | null): string | null {
  if (region === null) return null;
  for (const row of rows) {
    for (const reference of [row.region.sido, row.region.sigungu]) {
      if (reference?.codeValueId === region) return reference.text;
    }
  }
  return null;
}

const LINK = 'inline-flex h-8 items-center rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold hover:bg-foreground/10';

function NoSnapshot() {
  // 활성 build가 없는 것은 오류가 아니라 파생물이 아직 만들어지지 않은 정상 상태다(ADR 0011·0034).
  return <EmptyState title='열린 공고' status='수집 전' description='열린 공고 스냅샷이 아직 만들어지지 않았습니다.' />;
}

/**
 * 0건인 날의 출구다. 조건을 자동으로 넓히지 않는다 — 사용자가 고른 날에 없다는 사실이 먼저고, 어디로
 * 갈지는 사용자가 고른다.
 *
 * 다음 마감일은 요약이 세어 둔 값이라 여기서 다시 묻지 않는다. 요약은 날짜 축으로 좁히지 않으므로
 * 0건인 날을 보고 있어도 마감이 있는 가장 이른 날을 말할 수 있다.
 */
function EmptyResult({
  search,
  regionText,
  summary
}: {
  readonly search: TodaySearch;
  readonly regionText: string | null;
  readonly summary: OpenSummaryPresentation | null;
}) {
  const sentence = describeTodaySearch(search, regionText);
  const next = summary?.nextClosingDay ?? null;
  return (
    <EmptyState
      title='열린 공고'
      description={sentence === null ? '지금 열린 공고가 없습니다.' : `${sentence} 조건에서 열린 공고가 없습니다.`}
      action={
        next === null && sentence === null ? undefined : (
          <div className='flex flex-wrap gap-2'>
            {next === null ? null : (
              <Link
                href={buildTodayFilterRoute(search, { closesOn: next.date, announcedOn: null, closesWithinHours: null })}
                className={LINK}
              >
                마감이 가장 이른 날 {next.dayText} · {next.count}건
              </Link>
            )}
            {sentence === null ? null : <Link href='/today' className={LINK}>조건 모두 해제</Link>}
          </div>
        )
      }
    />
  );
}

function OpenAuctionList({
  rows,
  presentation,
  search,
  cursorReset
}: {
  readonly rows: readonly OpenAuctionRowPresentation[];
  readonly presentation: OpenAuctionListPresentation;
  readonly search: TodaySearch;
  readonly cursorReset: boolean;
}) {
  // 하한은 이 결과 집합의 성질이라 열이 아니라 조건 줄에 한 번 적는다. 표와 같은 판정을 써야
  // 조건 줄이 세는 수와 행에 붙는 값이 어긋나지 않는다.
  const floorRates = summarizeFloorRates(rows);
  return (
    <div className='overflow-hidden rounded-xl bg-card shadow-xs'>
      <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pt-4'>
        <span className='text-xl font-bold'>마감 임박 순</span>
        <span className='text-[13px] font-semibold text-muted-foreground'>
          {rows.length}건 표시 · 전체 {presentation.sampleCount}건
        </span>
        {floorRates.axisText === '' ? null : <span className='text-[13px] font-semibold text-muted-foreground'>{floorRates.axisText}</span>}
        {cursorReset ? <span className='text-[13px] font-semibold text-pushed'>목록이 갱신되어 처음부터 다시 보입니다.</span> : null}
      </div>
      {/* 표본 수·계보·산출 시각은 각주가 아니라 표 위 한 줄이다(AGENTS 7). */}
      <p className='px-4 py-2 text-[13px] font-medium text-muted-foreground'>{presentation.lineageText}</p>
      <OpenAuctionTable rows={rows} search={search} floorRates={floorRates} />
      {presentation.nextCursor !== null ? (
        <div className='flex justify-end px-4 py-3'>
          <Link href={buildTodayRoute({ ...search, cursor: presentation.nextCursor })} className={LINK}>
            다음 공고 보기
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** 목록 자리의 네 상태를 한 곳에서 고른다. 종류가 늘면 이 switch가 컴파일에서 막는다. */
function TodayList({ data, regionText }: { readonly data: TodayPageData; readonly regionText: string | null }) {
  const { presentation, search } = data;
  // 지역 미설정은 목록의 상태가 아니라 목록 앞의 상태다. 조회 자체를 하지 않았으므로 표시 모델이 없다.
  if (presentation === null) return <RegionSetupRequest />;
  const view = presentation.view;
  switch (view.kind) {
    case 'no-snapshot':
      return <NoSnapshot />;
    case 'empty':
      return <EmptyResult search={search} regionText={regionText} summary={data.summary} />;
    case 'list':
      return <OpenAuctionList rows={view.rows} presentation={presentation} search={search} cursorReset={data.cursorReset} />;
  }
}

export function TodayScreen({ data }: { readonly data: TodayPageData }) {
  const { presentation, search } = data;
  const view = presentation?.view ?? null;
  const regionText = regionTextOf(view?.kind === 'list' ? view.rows : [], search.sido);
  return (
    <TodayFrame
      header={
        <div className='flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1'>
          <h1 id='today-title' className='text-xl font-bold tracking-tight'>오늘</h1>
          {presentation === null || view?.kind === 'no-snapshot' ? null : (
            <span className='text-[15px] font-semibold whitespace-nowrap text-muted-foreground'>열린 공고 {presentation.sampleCount}건</span>
          )}
          {presentation === null ? null : (
            <span className='ml-auto text-[13px] font-semibold whitespace-nowrap text-muted-foreground'>{presentation.asOfText} 기준</span>
          )}
        </div>
      }
      filters={
        <div className='grid min-w-0 gap-3'>
          {/* 무엇으로 좁혔는지는 조건 칩보다 위, 목록 바로 앞에 계속 남는다(screen-system §6.4.1). */}
          <RegionScopeStrip
            gate={data.regionGate}
            search={search}
            matchedCount={presentation?.eligibilityMatchedCount ?? null}
            unobservedCount={presentation?.eligibilityUnobservedCount ?? null}
          />
          {presentation === null ? null : <TodayFilters search={search} regionText={regionText} />}
          {/* 탭과 달력은 언제를 말하고 그 아래 축·목록이 무엇을 말한다. 조건과 목록이 붙어 있어야 한다. */}
          {data.summary === null ? null : (
            <TodayTabs summary={data.summary} search={search} today={kstToday(data.nowIso).toString()} />
          )}
        </div>
      }
      list={<TodayList data={data} regionText={regionText} />}
    />
  );
}
