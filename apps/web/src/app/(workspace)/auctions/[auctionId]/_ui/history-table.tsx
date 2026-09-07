/** @module 책임: 기관 회차 이력 최근 12회를 표로 그리고 마지막 열에 내 값을 그때 냈다면 어땠을지 붙인다. */
'use client';

import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { AuctionRosterPanel } from './auction-roster-panel';

import type { HistoryRow } from '../_model/attempt-history';
import { toMilli } from '../_model/bid-rate';
import { HISTORY_WINDOW_LIMIT } from '../_model/history-window';
import { judgeRow, type RowVerdict } from '../_model/rehearsal';
import { NO_RATE_PHRASE, ROW_VERDICT_PHRASE } from '../_model/verdict-vocabulary';
import { useBidRate } from './bid-rate-context';

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
  verdict: 'text-right text-[15px] tabular-nums'
};

const HEAD_CLASS: Record<string, string> = {
  opened: 'text-left',
  item: 'text-left',
  winRate: 'text-right',
  secondRate: 'text-right',
  dayFloor: 'text-right',
  winner: 'text-left',
  list: 'text-right',
  verdict: 'text-right tabular-nums text-primary'
};

// 마지막 열은 원본 판정이 아니라 내 값과 낙찰값·그날 하한의 비교이므로 문구는 파생 서술 어휘에서만 가져온다(PDR-0002).
const VERDICT_TEXT: Record<RowVerdict, string> = {
  won: ROW_VERDICT_PHRASE.won.text,
  missed: ROW_VERDICT_PHRASE.missed.text,
  invalid: ROW_VERDICT_PHRASE.invalid.text,
  unknown: ROW_VERDICT_PHRASE.unknown.text
};

// 첫 열(개찰)과 마지막 열(판정)은 표가 근거 열보다 넓을 때 양 끝에 고정된다. 고정 열이 아래 열을 덮으므로
// 바탕이 불투명해야 한다. 판정 열의 primary 10% 기운을 반투명 `bg-primary/10`으로 두면 덮인 글자가 비치므로
// 카드색과 미리 섞은 불투명 색 하나만 건다(다른 bg-* 유틸리티와 함께 두면 stylesheet 순서가 이긴다).
const STICKY_CLASS: Record<string, string> = {
  opened: 'sticky left-0 z-10 bg-card',
  verdict: 'sticky right-0 z-10 bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))]'
};
const OPENED_EDGE_SHADOW = 'shadow-[14px_0_14px_-10px_rgb(0_0_0/0.3)]';
const VERDICT_EDGE_SHADOW = 'shadow-[-14px_0_14px_-10px_rgb(0_0_0/0.3)]';

type ScrollEdges = { readonly left: boolean; readonly right: boolean };

// 컨테이너가 가로로 넘칠 때만 고정 열 안쪽에 그림자를 걸어 "이 밑에 열이 더 있다"를 알린다. 넘치지 않으면
// 아무 힌트도 없어야 표가 열에 맞는 폭에서 장식이 남지 않는다(EAT-86).
function useScrollEdges() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const left = node.scrollLeft > 1;
      const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
      setEdges((previous) => (previous.left === left && previous.right === right ? previous : { left, right }));
    };
    update();
    node.addEventListener('scroll', update, { passive: true });
    // 폭은 viewport뿐 아니라 손잡이 값(머리글 길이)·행 데이터로도 바뀌므로 컨테이너와 표 둘 다 관측한다.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(node);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    return () => {
      node.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);
  return { ref, edges };
}

function edgeClass(columnId: string, edges: ScrollEdges) {
  const sticky = STICKY_CLASS[columnId];
  if (!sticky) return '';
  if (columnId === 'opened') return `${sticky} ${edges.left ? OPENED_EDGE_SHADOW : ''}`;
  return `${sticky} ${edges.right ? VERDICT_EDGE_SHADOW : ''}`;
}

const VERDICT_CLASS: Record<RowVerdict, string> = {
  won: 'text-primary font-semibold',
  missed: 'text-muted-foreground',
  invalid: 'text-destructive',
  unknown: 'text-muted-foreground'
};

function ListCell({ row, onOpen }: { readonly row: HistoryRow; readonly onOpen: (attemptId: string) => void }) {
  return (
    <Button variant='link' size='sm' className='h-auto p-0' onClick={() => onOpen(row.attemptId)}
      aria-label={`${row.openedText} 회차 참여 기록 보기`}>
      {row.listCount ?? '명단 보기'}
      {row.belowDayFloorCount === null ? null : <span className='text-[13px] font-medium text-muted-foreground'> 하한 아래 {row.belowDayFloorCount}</span>}
    </Button>
  );
}

// 손잡이가 비어 있으면 마지막 열은 무엇을 하면 계산되는지만 말하고 어떤 값으로도 판정하지 않는다(EAT-84).
function useHistoryColumns(rateMilli: bigint | null, rate: string | null, onOpen: (attemptId: string) => void) {
  return useMemo(
    () => [
      columnHelper.accessor('openedText', { id: 'opened', header: '개찰' }),
      columnHelper.accessor('itemLabel', { id: 'item', header: '품목' }),
      // 축을 머리글에 적지 않으면 사정률 두 열과 투찰률 두 열이 같은 눈금으로 읽힌다. 남산초에서
      // 두 축은 최대 2.19%p 벌어지므로 이 표기는 장식이 아니라 값의 의미다(AGENTS 15, PDR-0004).
      columnHelper.accessor((row) => row.winRateText ?? '—', { id: 'winRate', header: '낙찰률(사정률)' }),
      columnHelper.accessor((row) => row.secondRateText ?? '—', { id: 'secondRate', header: '2등가(사정률)' }),
      // 그날 하한이 없는 회차는 값이 비어 있는 것이 아니라 예정가격이 아직 추첨되지 않은 회차다.
      // '—'로 두면 다른 열의 "관측 없음"과 같은 모양이 되어 왜 없는지가 사라진다(EAT-74).
      columnHelper.accessor((row) => row.dayFloorText ?? '예정가격 미관측', { id: 'dayFloor', header: '그날 하한(투찰률)' }),
      columnHelper.accessor('winnerText', { id: 'winner', header: '낙찰 업체' }),
      columnHelper.display({ id: 'list', header: '명단', cell: (context) => <ListCell row={context.row.original} onOpen={onOpen} /> }),
      columnHelper.display({
        id: 'verdict',
        header: rate === null ? NO_RATE_PHRASE.header.text : `${rate} 썼다면`,
        cell: (context) => {
          if (rateMilli === null) return <span className={VERDICT_CLASS.unknown}>{NO_RATE_PHRASE.row.text}</span>;
          const verdict = judgeRow(context.row.original, rateMilli);
          return <span className={VERDICT_CLASS[verdict]}>{VERDICT_TEXT[verdict]}</span>;
        }
      })
    ],
    [rate, rateMilli, onOpen]
  );
}

export function HistoryTable({ rows }: { readonly rows: readonly HistoryRow[] }) {
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const selectedRow = rows.find((row) => row.attemptId === selectedAttemptId);
  useEffect(() => {
    if (selectedAttemptId !== null && !rows.some((row) => row.attemptId === selectedAttemptId)) setSelectedAttemptId(null);
  }, [rows, selectedAttemptId]);
  const { rate } = useBidRate();
  const rateMilli = rate === null ? null : toMilli(rate);
  // 응답이 최근 → 오래된 순이라 그대로 앞에서 잘라 최근 12회가 된다. 열 클릭 정렬은 넣지 않는다.
  const data = useMemo(() => rows.slice(0, HISTORY_WINDOW_LIMIT), [rows]);
  const columns = useHistoryColumns(rateMilli, rate, setSelectedAttemptId);
  // oxlint-disable-next-line react/incompatible-library -- headless table 인스턴스는 함수를 돌려주지만 React Compiler는 annotation mode라 이 컴포넌트를 메모하지 않는다(apps/web AGENTS.md). "use memo"를 붙일 때 이 표를 함께 검증한다.
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  const { ref, edges } = useScrollEdges();

  // 1024에서도 8열이 근거 열 안에 들어가도록 xl 아래에서는 셀 여백을 줄인다. 그래도 넘치면 페이지가
  // 아니라 이 컨테이너만 가로로 움직이고, 첫·마지막 열은 고정돼 판정 열이 잘려 보이지 않는다.
  // border-collapse에서는 sticky 셀이 행 테두리를 끌고 가지 못해 separate로 두고 테두리를 셀에 건다.
  return (
    <>
    <div ref={ref} data-scroll-left={edges.left ? '' : undefined} data-scroll-right={edges.right ? '' : undefined} className='overflow-x-auto'>
      <table className='w-full border-separate border-spacing-0'>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  scope='col'
                  className={`border-b border-border px-2 py-2 text-[13px] font-semibold whitespace-nowrap text-muted-foreground xl:px-3 ${HEAD_CLASS[header.column.id]} ${edgeClass(header.column.id, edges)}`}
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
                  className={`border-b border-border/60 px-2 py-2 whitespace-nowrap group-last/row:border-b-0 xl:px-3 ${CELL_CLASS[cell.column.id]} ${edgeClass(cell.column.id, edges)}`}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {selectedRow ? <AuctionRosterPanel key={selectedRow.attemptId} row={selectedRow} onClose={() => setSelectedAttemptId(null)} /> : null}
    </>
  );
}
