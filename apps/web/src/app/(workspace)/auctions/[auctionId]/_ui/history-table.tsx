/** @module 책임: 기관 회차 이력 최근 12회를 표로 그리고 마지막 열에 내 값을 그때 냈다면 어땠을지 붙인다. */
'use client';

import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';

import type { HistoryRow } from '../_model/attempt-history';
import { toMilli } from '../_model/bid-rate';
import { judgeRow, type RowVerdict } from '../_model/rehearsal';
import { useBidRate } from './bid-rate-context';

/** 표가 그리는 최대 행 수. 캡션의 "최근 N회 표시"가 같은 상한을 써야 문구와 표가 어긋나지 않는다. */
export const SHOWN_ROWS = 12;
const columnHelper = createColumnHelper<HistoryRow>();

// 왼쪽 열은 사실, 마지막 열은 가정이다. 열 정렬·색 역할을 여기 한 곳에서만 정해 헤더와 셀이 어긋나지
// 않게 한다. 파란 기운은 '내 값' 하나에만, 빨강은 '그날 하한' 하나에만 건다.
const CELL_CLASS: Record<string, string> = {
  opened: 'text-[15px] font-medium',
  item: 'text-[15px] font-medium',
  winRate: 'text-right text-[15px] font-semibold tabular-nums',
  secondRate: 'text-right text-[15px] font-medium tabular-nums',
  dayFloor: 'text-right text-[15px] font-medium tabular-nums text-destructive',
  winner: 'text-[15px] font-medium',
  list: 'text-right text-[15px] font-medium tabular-nums',
  verdict: 'text-right text-[15px] tabular-nums bg-primary/10'
};

const HEAD_CLASS: Record<string, string> = {
  opened: 'text-left',
  item: 'text-left',
  winRate: 'text-right',
  secondRate: 'text-right',
  dayFloor: 'text-right',
  winner: 'text-left',
  list: 'text-right',
  verdict: 'text-right tabular-nums bg-primary/10 text-primary'
};

const VERDICT_TEXT: Record<RowVerdict, string> = {
  won: '낙찰',
  missed: '놓침',
  invalid: '무효',
  unknown: '—'
};

const VERDICT_CLASS: Record<RowVerdict, string> = {
  won: 'text-primary font-semibold',
  missed: 'text-muted-foreground',
  invalid: 'text-destructive',
  unknown: 'text-muted-foreground'
};

function ListCell({ row }: { readonly row: HistoryRow }) {
  if (row.listCount === null) return <>—</>;
  return (
    <>
      {row.listCount}
      {row.belowDayFloorCount === null ? null : <span className='text-[13px] font-medium text-muted-foreground'> 하한 미만 {row.belowDayFloorCount}</span>}
    </>
  );
}

function useHistoryColumns(rateMilli: bigint, rate: string) {
  return useMemo(
    () => [
      columnHelper.accessor('openedText', { id: 'opened', header: '개찰' }),
      columnHelper.accessor('itemLabel', { id: 'item', header: '품목' }),
      columnHelper.accessor((row) => row.winRateText ?? '—', { id: 'winRate', header: '낙찰률' }),
      columnHelper.accessor((row) => row.secondRateText ?? '—', { id: 'secondRate', header: '2등가' }),
      columnHelper.accessor((row) => row.dayFloorText ?? '—', { id: 'dayFloor', header: '그날 하한' }),
      columnHelper.accessor('winnerText', { id: 'winner', header: '낙찰 업체' }),
      columnHelper.display({ id: 'list', header: '명단', cell: (context) => <ListCell row={context.row.original} /> }),
      columnHelper.display({
        id: 'verdict',
        header: `${rate} 썼다면`,
        cell: (context) => {
          const verdict = judgeRow(context.row.original, rateMilli);
          return <span className={VERDICT_CLASS[verdict]}>{VERDICT_TEXT[verdict]}</span>;
        }
      })
    ],
    [rate, rateMilli]
  );
}

export function HistoryTable({ rows }: { readonly rows: readonly HistoryRow[] }) {
  const { rate } = useBidRate();
  const rateMilli = toMilli(rate);
  // 응답이 최근 → 오래된 순이라 그대로 앞에서 잘라 최근 12회가 된다. 열 클릭 정렬은 넣지 않는다.
  const data = useMemo(() => rows.slice(0, SHOWN_ROWS), [rows]);
  const columns = useHistoryColumns(rateMilli, rate);
  // oxlint-disable-next-line react/incompatible-library -- headless table 인스턴스는 함수를 돌려주지만 React Compiler는 annotation mode라 이 컴포넌트를 메모하지 않는다(apps/web AGENTS.md). "use memo"를 붙일 때 이 표를 함께 검증한다.
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  // 1024에서도 8열이 근거 열 안에 들어가도록 xl 아래에서는 셀 여백을 줄인다. 그래도 넘치면 페이지가
  // 아니라 이 컨테이너만 가로로 움직인다.
  return (
    <div className='overflow-x-auto'>
      <table className='w-full border-collapse'>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className='border-b border-border'>
              {group.headers.map((header) => (
                <th key={header.id} scope='col' className={`px-2 py-2 text-[13px] font-semibold whitespace-nowrap text-muted-foreground xl:px-3 ${HEAD_CLASS[header.column.id]}`}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className='border-b border-border/60 last:border-0'>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className={`px-2 py-2 whitespace-nowrap xl:px-3 ${CELL_CLASS[cell.column.id]}`}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
