/** @module 책임: 열린 공고 행을 마감 임박 순 그대로 TanStack headless 표로 그리고, 폭에 따라 열을 접으며 상태색은 마감 셀의 D-0·D-1에만 건다. */
'use client';

import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo } from 'react';

import { buildTodayFilterRoute, type TodaySearch } from '../_lib/today-search-params';
import type { ClosesTone, OpenAuctionRowPresentation } from '../_model/present-open-auctions';

const columnHelper = createColumnHelper<OpenAuctionRowPresentation>();

// 1440은 열 열 개 전부, 1024는 참여 수·최근 낙찰·내 기록을 접고, 768은 기관·기초금액·마감·열기 넷만
// 남기고 품목·보통 참여를 기관 셀 둘째 줄에 둔다(설계 §4.6). 잘린 desktop 표를 그대로 스크롤시키지 않는다.
const VISIBILITY: Record<string, string> = {
  organization: '',
  item: 'hidden lg:table-cell',
  baseAmount: '',
  floorRate: 'hidden lg:table-cell',
  closes: '',
  bidCount: 'hidden xl:table-cell',
  medianList: 'hidden lg:table-cell',
  lastAwarded: 'hidden xl:table-cell',
  myRecord: 'hidden xl:table-cell',
  open: ''
};

const ALIGN: Record<string, string> = {
  organization: 'text-left',
  item: 'text-left',
  baseAmount: 'text-right',
  floorRate: 'text-right',
  closes: 'text-right',
  bidCount: 'text-right',
  medianList: 'text-right',
  lastAwarded: 'text-right',
  myRecord: 'text-right',
  open: 'text-right'
};

// 빨강은 상태 색으로만 쓴다. 오늘 마감은 red, 내일 마감은 amber(주의)이며 그 밖의 셀·헤더·칩에는 쓰지 않는다
// (screen-system §9.2, EAT-39 판정 F). 색과 함께 `D-0`·`D-1` 텍스트가 같이 있다.
const CLOSES_TONE: Record<ClosesTone, string> = {
  today: 'text-destructive font-bold',
  tomorrow: 'text-pushed font-bold',
  later: 'text-foreground',
  unknown: 'text-muted-foreground'
};

const MUTED = 'text-[13px] font-medium text-muted-foreground';

// 기관·최근 낙찰 셀은 자기 안에서 줄을 바꾼다. 나머지 숫자 셀은 nowrap이다.
const WRAPPING_CELLS = new Set(['organization', 'lastAwarded']);

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

/** 원천 품목 라벨은 "농산물 , 수산물 , …"처럼 쉼표로 이어진 여러 품목일 수 있다. 셀 하나가 그 전체를 nowrap으로
 * 품으면 1024폭에서 표가 카드를 넘기므로 첫 품목과 나머지 개수로 접는다. 접은 문구는 표시에만 쓰고 필터
 * 링크는 원문 라벨 그대로다(AGENTS 2·15). */
export function summarizeItemLabel(label: string): { readonly text: string; readonly full: string | null } {
  const parts = label.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length <= 1) return { text: label, full: null };
  return { text: `${parts[0]} 외 ${parts.length - 1}`, full: parts.join(', ') };
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

function useOpenAuctionColumns(search: TodaySearch) {
  return useMemo(
    () => [
      columnHelper.display({ id: 'organization', header: '기관', cell: (context) => <OrganizationCell row={context.row.original} search={search} /> }),
      columnHelper.display({ id: 'item', header: '품목', cell: (context) => <ItemCell row={context.row.original} search={search} /> }),
      columnHelper.accessor('baseAmountText', { id: 'baseAmount', header: '기초금액' }),
      // 하한율은 사정률 축의 상수다. 축을 머리글에 적어 투찰률 축(최근 낙찰)과 같은 눈금으로 읽히지 않게 한다(PDR-0004).
      columnHelper.accessor('floorRateText', { id: 'floorRate', header: '하한(사정률)' }),
      columnHelper.display({ id: 'closes', header: '마감', cell: (context) => <ClosesCell row={context.row.original} /> }),
      columnHelper.accessor('bidCountText', { id: 'bidCount', header: '참여 수' }),
      columnHelper.display({ id: 'medianList', header: '보통 참여', cell: (context) => <MedianCell row={context.row.original} /> }),
      columnHelper.display({ id: 'lastAwarded', header: '최근 낙찰(투찰률)', cell: (context) => <LastAwardedCell row={context.row.original} /> }),
      // 내 기록은 인증 뒤 켜지는 슬롯이다. 브라우저 로컬 저장을 만들지 않는다(ADR 0032, EAT-39 판정 E).
      columnHelper.display({ id: 'myRecord', header: '내 기록', cell: () => <span className='text-muted-foreground/70'>없음</span> }),
      columnHelper.display({
        id: 'open',
        header: '',
        cell: (context) => (
          <Link href={context.row.original.href} className='inline-flex h-8 items-center rounded-lg border border-border px-3 text-[13px] font-semibold whitespace-nowrap hover:bg-muted'>
            열기
          </Link>
        )
      })
    ],
    [search]
  );
}

export function OpenAuctionTable({ rows, search }: { readonly rows: readonly OpenAuctionRowPresentation[]; readonly search: TodaySearch }) {
  const data = useMemo(() => [...rows], [rows]);
  const columns = useOpenAuctionColumns(search);
  // oxlint-disable-next-line react/incompatible-library -- headless table 인스턴스는 함수를 돌려주지만 React Compiler는 annotation mode라 이 컴포넌트를 메모하지 않는다(apps/web AGENTS.md).
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <table className='w-full border-collapse'>
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id} className='border-b border-border'>
            {group.headers.map((header) => (
              <th key={header.id} scope='col' className={`px-2 py-2 text-[13px] font-semibold whitespace-nowrap text-muted-foreground xl:px-3 ${ALIGN[header.column.id]} ${VISIBILITY[header.column.id]}`}>
                {flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} data-closes={row.original.closes.tone} className='border-b border-border/60 last:border-0'>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id} className={`px-2 py-2 align-top text-[15px] font-medium xl:px-3 ${ALIGN[cell.column.id]} ${VISIBILITY[cell.column.id]} ${WRAPPING_CELLS.has(cell.column.id) ? '' : 'whitespace-nowrap tabular-nums'}`}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
