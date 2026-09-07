/** @module 책임: 과거 회차 크게 보기의 12열 표를 행 상한 없이 그리고, 사정률 축 "낙찰 − 내 값"과 투찰률 축 "지금 값 썼다면"을 각자의 축 값으로만 계산해 붙인다. */
'use client';

import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';

import type { HistoryRow } from '../../_model/attempt-history';
import { toMilli } from '../../_model/bid-rate';
import { judgeRow, type RowVerdict } from '../../_model/rehearsal';
import { NO_RATE_PHRASE, ROW_VERDICT_PHRASE } from '../../_model/verdict-vocabulary';
import { useBidRate } from '../bid-rate-context';
import { rateDeltaText } from './rate-delta';

const columnHelper = createColumnHelper<HistoryRow>();

const NUMERIC = 'text-right tabular-nums';

const HEAD_CLASS: Record<string, string> = {
  opened: 'text-left',
  item: 'text-left',
  baseAmount: NUMERIC,
  floorRate: NUMERIC,
  winRate: NUMERIC,
  secondRate: NUMERIC,
  dayFloor: NUMERIC,
  winner: 'text-left',
  list: NUMERIC,
  belowFloor: 'text-left',
  delta: `${NUMERIC} text-primary`,
  verdict: `${NUMERIC} text-primary`
};

// 빨강은 그날 하한 하나에만, 파란 기운은 내 값이 들어간 두 열에만 건다(history-table.tsx와 같은 역할 배정).
const CELL_CLASS: Record<string, string> = {
  opened: 'font-medium',
  item: 'font-medium',
  baseAmount: `${NUMERIC} font-medium`,
  floorRate: `${NUMERIC} font-medium text-muted-foreground`,
  winRate: `${NUMERIC} font-semibold`,
  secondRate: `${NUMERIC} font-medium text-muted-foreground`,
  dayFloor: `${NUMERIC} font-medium text-destructive`,
  winner: 'font-medium',
  list: `${NUMERIC} font-medium`,
  belowFloor: 'font-medium',
  delta: `${NUMERIC} font-medium`,
  verdict: NUMERIC
};

const VERDICT_CLASS: Record<RowVerdict, string> = {
  won: 'text-primary font-semibold',
  missed: 'text-muted-foreground',
  invalid: 'text-destructive',
  unknown: 'text-muted-foreground'
};

/**
 * 하한 아래로 들어온 명단 수를 그 회차 명단 대비 막대로 보인다. 막대는 장식이고 숫자가 내용이라
 * 막대만 `aria-hidden`이다. 명단이 없거나 0이면 비율을 만들 수 없어 숫자만 남긴다.
 */
function BelowFloorCell({ row }: { readonly row: HistoryRow }) {
  if (row.belowDayFloorCount === null) return <>—</>;
  const ratio = row.listCount === null || row.listCount === 0 ? null : Math.min(1, row.belowDayFloorCount / row.listCount);
  return (
    <span className='flex items-center gap-2'>
      <span aria-hidden='true' className='block h-1.5 w-20 rounded-sm bg-foreground/10'>
        {ratio === null ? null : <span className='block h-1.5 rounded-sm bg-destructive/70' style={{ width: `${Math.round(ratio * 100)}%` }} />}
      </span>
      <span className='tabular-nums'>{row.belowDayFloorCount}</span>
    </span>
  );
}

function useExpandColumns(rate: string | null, myRate: string | null) {
  const rateMilli = rate === null ? null : toMilli(rate);
  const myRateMilli = myRate === null ? null : toMilli(myRate);
  return useMemo(
    () => [
      columnHelper.accessor('openedText', { id: 'opened', header: '개찰' }),
      columnHelper.accessor('itemLabel', { id: 'item', header: '품목' }),
      columnHelper.accessor('baseAmountText', { id: 'baseAmount', header: '기초금액' }),
      columnHelper.accessor((row) => row.floorRateText ?? '—', { id: 'floorRate', header: '하한율' }),
      // 축을 머리글에 적지 않으면 사정률과 투찰률이 같은 눈금으로 읽힌다(AGENTS 15, PDR-0004).
      columnHelper.accessor((row) => row.winRateText ?? '—', { id: 'winRate', header: '낙찰률(사정률)' }),
      columnHelper.accessor((row) => row.secondRateText ?? '—', { id: 'secondRate', header: '2등가(사정률)' }),
      columnHelper.accessor((row) => row.dayFloorText ?? '예정가격 미관측', { id: 'dayFloor', header: '그날 하한(투찰률)' }),
      columnHelper.accessor('winnerText', { id: 'winner', header: '낙찰 업체' }),
      columnHelper.accessor((row) => (row.listCount === null ? '—' : row.listCount.toLocaleString('ko-KR')), { id: 'list', header: '명단' }),
      columnHelper.display({ id: 'belowFloor', header: '하한 아래', cell: (context) => <BelowFloorCell row={context.row.original} /> }),
      // 내 값(URL `myRate`)은 사정률이라 낙찰률과 같은 축이다. 값이 없으면 어떤 값으로도 빼지 않는다(AGENTS 8).
      columnHelper.display({
        id: 'delta',
        header: myRate === null ? '낙찰 − 내 값' : `낙찰 − 내 값 ${myRate}`,
        cell: (context) => {
          const win = context.row.original.winRateMilli;
          if (myRateMilli === null || win === null) return <span className='text-muted-foreground'>—</span>;
          return rateDeltaText(win, myRateMilli);
        }
      }),
      // 손잡이 값은 투찰률이라 낙찰률이 아닌 awardedBidRate와 견준다. 규칙은 표 안쪽과 같은 judgeRow다.
      columnHelper.display({
        id: 'verdict',
        header: rate === null ? NO_RATE_PHRASE.header.text : `${rate} 썼다면`,
        cell: (context) => {
          if (rateMilli === null) return <span className={VERDICT_CLASS.unknown}>{NO_RATE_PHRASE.row.text}</span>;
          const verdict = judgeRow(context.row.original, rateMilli);
          return <span className={VERDICT_CLASS[verdict]}>{ROW_VERDICT_PHRASE[verdict].text}</span>;
        }
      })
    ],
    [rate, rateMilli, myRate, myRateMilli]
  );
}

export function HistoryExpandTable({
  rows,
  myRate
}: {
  readonly rows: readonly HistoryRow[];
  /** URL `myRate`(사정률). 레일 손잡이가 아니라 이 값만 낙찰률과 뺄셈할 수 있다. */
  readonly myRate: string | null;
}) {
  const { rate } = useBidRate();
  const columns = useExpandColumns(rate, myRate);
  // oxlint-disable-next-line react/incompatible-library -- headless table 인스턴스는 함수를 돌려주지만 React Compiler는 annotation mode라 이 컴포넌트를 메모하지 않는다(apps/web AGENTS.md).
  const table = useReactTable({ data: rows as HistoryRow[], columns, getCoreRowModel: getCoreRowModel() });

  // 12열은 1024·768에서 모달 폭을 넘는다. 페이지가 아니라 이 컨테이너만 가로로 움직인다.
  return (
    <div data-slot='history-expand-table' className='min-w-0 overflow-x-auto'>
      <table className='w-full border-separate border-spacing-0 text-[15px]'>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  scope='col'
                  className={`border-b border-border px-2 py-2 text-[13px] font-semibold whitespace-nowrap text-muted-foreground ${HEAD_CLASS[header.column.id]}`}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className='group/row'>
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={`border-b border-border/60 px-2 py-2 whitespace-nowrap group-last/row:border-b-0 ${CELL_CLASS[cell.column.id]}`}
                >
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
