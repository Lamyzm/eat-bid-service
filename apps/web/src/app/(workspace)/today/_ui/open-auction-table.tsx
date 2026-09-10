/** @module 책임: 열린 공고 행을 마감 임박 순 그대로 표로 그리고, 열의 정렬·폭별 접힘·줄바꿈을 한 열 서술에서 파생하며 상태색은 마감 셀의 D-0·D-1에만 건다. */
import Link from 'next/link';
import type { ReactNode } from 'react';

import { summarizeItemLabel } from '@/entities/item/item-label';

import { buildTodayFilterRoute, type TodaySearch } from '../_lib/today-search-params';
import type { ClosesTone, OpenAuctionRowPresentation } from '../_model/present-open-auctions';

// 빨강은 상태 색으로만 쓴다. 오늘 마감은 red, 내일 마감은 amber(주의)이며 그 밖의 셀·헤더·칩에는 쓰지 않는다
// (screen-system §9.2, EAT-39 판정 F). 색과 함께 `D-0`·`D-1` 텍스트가 같이 있다.
const CLOSES_TONE: Record<ClosesTone, string> = {
  today: 'text-destructive font-bold',
  tomorrow: 'text-pushed font-bold',
  later: 'text-foreground',
  unknown: 'text-muted-foreground'
};

const MUTED = 'text-[13px] font-medium text-muted-foreground';

function OrganizationCell({ row, search }: { readonly row: OpenAuctionRowPresentation; readonly search: TodaySearch }) {
  const { organization, region } = row;
  return (
    <div className='grid min-w-0 gap-0.5'>
      <span className={`line-clamp-2 break-keep wrap-anywhere text-[15px] font-semibold ${organization.tone === 'named' ? '' : 'text-muted-foreground'}`}>
        {organization.text}
      </span>
      <span className={`flex flex-wrap gap-x-2 ${MUTED}`}>
        {organization.type !== null && organization.type !== 'unknown' ? <span>{organization.type}</span> : null}
        {/* 지역 링크는 라벨이 아니라 code value id로 거른다. 라벨은 표시일 뿐이다(AGENTS 2·6). */}
        {[region.sido, region.sigungu].map((reference) =>
          reference === null ? null : (
            <Link key={reference.codeValueId} href={buildTodayFilterRoute(search, { region: reference.codeValueId })} className='hover:underline'>
              {reference.text}
            </Link>
          )
        )}
        {/* 좁은 폭에서 접힌 품목·보통 참여를 둘째 줄에 둔다. */}
        <span className='lg:hidden'>{row.itemLabel === null ? '품목 미확인' : summarizeItemLabel(row.itemLabel).text}</span>
        {row.orgSummary ? <span className='lg:hidden'>보통 참여 {row.orgSummary.medianListText}</span> : null}
      </span>
    </div>
  );
}

function ItemCell({ row, search }: { readonly row: OpenAuctionRowPresentation; readonly search: TodaySearch }) {
  if (row.itemLabel === null) return <span className='text-muted-foreground'>미확인</span>;
  const item = summarizeItemLabel(row.itemLabel);
  // 품목은 아직 code scheme이 없어 관측 라벨 완전일치로 거른다(EAT-39 판정 B).
  return (
    <Link href={buildTodayFilterRoute(search, { item: row.itemLabel })} title={item.full ?? undefined} className='hover:underline'>
      {item.text}
    </Link>
  );
}

function ClosesCell({ row }: { readonly row: OpenAuctionRowPresentation }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 whitespace-nowrap tabular-nums ${CLOSES_TONE[row.closes.tone]}`}>
      <span>{row.closes.label}</span>
      {row.closes.timeText ? <span className='text-[13px] font-medium'>{row.closes.timeText}</span> : null}
    </span>
  );
}

function MedianCell({ row }: { readonly row: OpenAuctionRowPresentation }) {
  if (row.orgSummary === null) return <span className='text-muted-foreground'>—</span>;
  return (
    <span className='whitespace-nowrap tabular-nums'>
      {row.orgSummary.medianListText}
      <span className={` ${MUTED}`}> n={row.orgSummary.listCountSampleCount}</span>
    </span>
  );
}

function LastAwardedCell({ row }: { readonly row: OpenAuctionRowPresentation }) {
  if (row.orgSummary === null) return <span className='text-muted-foreground'>—</span>;
  // 첫 줄(값)만 nowrap이다. 둘째 줄의 개찰 시각·명단은 줄바꿈을 허용해 열 하나가 표를 카드 밖으로 밀지 않게 한다.
  return (
    <span className='grid justify-items-end gap-0.5 tabular-nums'>
      <span className='whitespace-nowrap'>{row.orgSummary.lastAwardedText}</span>
      {row.orgSummary.lastOpenedText ? (
        <span className={`${MUTED} whitespace-normal`}>
          {row.orgSummary.lastOpenedText}
          {row.orgSummary.lastListText ? ` · ${row.orgSummary.lastListText}` : ''}
        </span>
      ) : null}
    </span>
  );
}

type OpenAuctionColumn = {
  readonly id: string;
  readonly header: string;
  readonly align: 'text-left' | 'text-right';
  /** 폭이 좁아질 때 접히는 규칙이다. 빈 문자열은 어느 폭에서나 보인다. */
  readonly visibility: string;
  /**
   * 머리글을 눈에서만 감추는 열이다. 행동 열은 화면에 머리글이 필요 없지만 이름이 없으면 그 열이 무엇인지
   * 말하지 않는다. `th` 자체가 아니라 안쪽 문구만 감춰야 `scope` 연결과 열 폭이 그대로 남는다.
   */
  readonly headerHidden?: true;
  /** 셀 안에서 줄을 바꾸는 열이다. 나머지 숫자 열은 nowrap에 tabular-nums다. */
  readonly wraps?: true;
  readonly cell: (row: OpenAuctionRowPresentation, search: TodaySearch) => ReactNode;
};

/**
 * 열의 머리글·정렬·접힘·줄바꿈·셀을 한 줄에 모은다. 이 넷을 따로 둔 표로 관리하면 열 하나를 더할 때
 * 네 곳을 맞춰야 하고, 하나를 빠뜨려도 className에 `undefined`가 들어갈 뿐 조용히 지나간다.
 *
 * xl(1280 이상)은 열 전부, lg(1024 이상)는 참여 수·최근 낙찰을 접고, md(768 이상)는 기관·기초금액·마감·열기
 * 넷만 남기고 품목·보통 참여를 기관 셀 둘째 줄에 둔다(설계 §4.6·§11). 잘린 desktop 표를 그대로 스크롤시키지 않는다.
 */
const COLUMNS: readonly OpenAuctionColumn[] = [
  { id: 'organization', header: '기관', align: 'text-left', visibility: '', wraps: true, cell: (row, search) => <OrganizationCell row={row} search={search} /> },
  { id: 'item', header: '품목', align: 'text-left', visibility: 'hidden lg:table-cell', cell: (row, search) => <ItemCell row={row} search={search} /> },
  { id: 'baseAmount', header: '기초금액', align: 'text-right', visibility: '', cell: (row) => row.baseAmountText },
  // 하한율은 사정률 축의 상수다. 축을 머리글에 적어 투찰률 축(최근 낙찰)과 같은 눈금으로 읽히지 않게 한다(PDR-0004).
  { id: 'floorRate', header: '하한(사정률)', align: 'text-right', visibility: 'hidden lg:table-cell', cell: (row) => row.floorRateText },
  { id: 'closes', header: '마감', align: 'text-right', visibility: '', cell: (row) => <ClosesCell row={row} /> },
  { id: 'bidCount', header: '참여 수', align: 'text-right', visibility: 'hidden xl:table-cell', cell: (row) => row.bidCountText },
  { id: 'medianList', header: '보통 참여', align: 'text-right', visibility: 'hidden lg:table-cell', cell: (row) => <MedianCell row={row} /> },
  { id: 'lastAwarded', header: '최근 낙찰(투찰률)', align: 'text-right', visibility: 'hidden xl:table-cell', wraps: true, cell: (row) => <LastAwardedCell row={row} /> },
  {
    id: 'open',
    header: '열기',
    align: 'text-right',
    visibility: '',
    headerHidden: true,
    cell: (row) => (
      <Link href={row.href} className='inline-flex h-8 items-center rounded-lg border border-border px-3 text-[13px] font-semibold whitespace-nowrap hover:bg-muted'>
        열기
      </Link>
    )
  }
];

/**
 * 행 값은 서버에서 이미 문자열로 만들어졌고 셀 안 상호작용은 링크뿐이라 이 표는 server component다.
 * 정렬·필터·페이징이 이 화면의 표에 생기기 전까지 headless 표 라이브러리를 다시 들이지 않는다 —
 * 그 순간 표 전체가 브라우저로 넘어가고 hydration 비용이 따라온다.
 */
export function OpenAuctionTable({ rows, search }: { readonly rows: readonly OpenAuctionRowPresentation[]; readonly search: TodaySearch }) {
  return (
    <table className='w-full border-collapse'>
      <thead>
        <tr className='border-b border-border'>
          {COLUMNS.map((column) => (
            <th key={column.id} scope='col' className={`px-2 py-2 text-[13px] font-semibold whitespace-nowrap text-muted-foreground xl:px-3 ${column.align} ${column.visibility}`}>
              {column.headerHidden ? <span className='sr-only'>{column.header}</span> : column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.auctionAttemptId} data-closes={row.closes.tone} className='border-b border-border/60 last:border-0'>
            {COLUMNS.map((column) => (
              <td
                key={column.id}
                className={`px-2 py-2 align-top text-[15px] font-medium xl:px-3 ${column.align} ${column.visibility} ${column.wraps ? '' : 'whitespace-nowrap tabular-nums'}`}
              >
                {column.cell(row, search)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
