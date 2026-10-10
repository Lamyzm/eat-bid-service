/**
 * @module 책임: 오늘 투찰 목록을 마감 시각 묶음 아래 행(왼쪽 공고 세 줄, 오른쪽 맞춤·전국 공식 금액 칸)과 더 보기로 그린다. 무엇을
 * 쓸지는 표시 모델이 정하고 여기는 server component로 남는다 — 복사 손잡이만 client다.
 */
import Link from 'next/link';

import { CopyValue } from '@/shared/ui/copy-value';
import type { AmountCell, AmountLine, BoardRowView, BoardView, ClosingGroupView } from '../model/present-bid-board';

type Board = Extract<BoardView, { kind: 'board' }>;

// 글자 위계는 오늘 화면(U9)과 같다. 기관 17/700, 금액 16/800, 본문 14, 묶음 머리 14/700.
const HINT = 'text-muted-foreground/70';
const CELLS = 'sm:grid-cols-[minmax(0,1fr)_184px_184px]';

function AmountLines({ lines }: { readonly lines: readonly AmountLine[] }) {
  return (
    <>
      {lines.map((line) => (
        <span key={line.label} className='flex items-baseline justify-end gap-1.5 whitespace-nowrap'>
          <span className={`text-[12px] font-semibold ${HINT}`}>{line.label}</span>
          <CopyValue value={line.copyValue} label={`${line.label} 금액 ${line.amount}`} className='inline-flex items-baseline gap-1 rounded text-[16px] font-extrabold tracking-[-0.02em] tabular-nums hover:underline'>
            <span>{line.amount}</span>
          </CopyValue>
        </span>
      ))}
    </>
  );
}

// 넓은 화면은 칸 머리줄이 방법 이름을 말한다. 좁은 화면에서는 머리줄이 숨고 칸이 세로로 쌓이므로 칸 안의 이름만이 어느
// 방법인지 말한다 — 그래서 이름은 좁은 화면에서만 보이고 넓은 화면에서는 읽기 도구에만 남는다.
const METHOD_NAME = 'sm:sr-only';

function Cell({ cell, method }: { readonly cell: AmountCell; readonly method: string }) {
  if (cell.kind === 'reason') {
    return (
      <div data-slot='bid-board-cell' data-cell='reason' className='flex flex-wrap content-start justify-end gap-x-1.5 rounded-lg px-2.5 py-2 text-[12px] font-semibold'>
        <span data-slot='bid-board-cell-method' className={METHOD_NAME}>{method}</span>
        <span className={`text-right ${HINT}`}>{cell.text}</span>
      </div>
    );
  }
  return (
    <div
      data-slot='bid-board-cell'
      data-cell='amounts'
      className={`grid content-start justify-items-end gap-1 rounded-lg px-2.5 py-2 ${cell.lead ? 'bg-background ring-2 ring-primary' : ''}`}
      aria-label={cell.lead ? `${method}, 지금 근거가 가장 강한 방법` : method}
      role='group'
    >
      {/* 주도 표시가 없는 칸은 넓은 화면에서 이 줄이 비므로 줄째 감춘다. 이름은 칸의 aria-label이 말한다. */}
      <span className={`flex items-baseline gap-1.5 text-[11.5px] font-bold ${cell.lead ? '' : 'sm:hidden'}`}>
        <span data-slot='bid-board-cell-method' className={METHOD_NAME}>{method}</span>
        {cell.lead ? <span className='text-primary'>근거 가장 강함</span> : null}
      </span>
      <AmountLines lines={cell.lines} />
    </div>
  );
}

function More({ row }: { readonly row: BoardRowView }) {
  const { single, spares, band } = row.more;
  if (single === null && spares.length === 0 && band === null) return null;
  return (
    <details className='col-span-full mt-1 rounded-lg bg-muted/60 px-3 py-2 text-[13px] open:pb-3'>
      <summary className='cursor-pointer font-bold text-primary'>더 보기 · 한 곳만 넣을 때와 예비 순위</summary>
      <dl className='mt-2 grid gap-1.5 sm:max-w-md'>
        {single === null ? null : (
          <div className='flex items-baseline justify-between gap-3'>
            <dt className='text-muted-foreground'>{single.label}{single.note === null ? '' : ` · ${single.note}`}</dt>
            <dd><AmountLines lines={[{ ...single, label: '' }]} /></dd>
          </div>
        )}
        {spares.map((spare) => (
          <div key={spare.label} className='flex items-baseline justify-between gap-3'>
            <dt className='text-muted-foreground'>{spare.label}</dt>
            <dd><AmountLines lines={[{ ...spare, label: '' }]} /></dd>
          </div>
        ))}
      </dl>
      {band === null ? null : <p className={`mt-2 ${HINT}`}>{band}</p>}
    </details>
  );
}

function Row({ row, columns }: { readonly row: BoardRowView; readonly columns: Board['columns'] }) {
  return (
    <article data-slot='bid-board-row' className={`grid gap-x-2.5 gap-y-2 rounded-xl py-3.5 ${CELLS} [&+&]:shadow-[inset_0_1px_0_var(--border)]`}>
      <div className='min-w-0'>
        <p className='flex min-w-0 flex-wrap items-baseline gap-x-2'>
          <Link href={row.href} className='text-[17px] font-bold tracking-[-0.025em] hover:underline'>{row.organization}</Link>
          <span className='text-[14px] font-semibold text-muted-foreground'>{row.item}</span>
        </p>
        <p className='mt-1 truncate text-[14px] text-muted-foreground'>{row.title}</p>
        <p className={`mt-[7px] text-[14px] tabular-nums ${HINT}`}>{row.facts}</p>
      </div>
      {row.selfJudged ? (
        <p className='self-start rounded-lg bg-muted px-3 py-2 text-[13px] font-semibold text-muted-foreground sm:col-span-2 sm:text-right'>
          하한율 88% · 직접 판단
        </p>
      ) : (
        row.cells.map((cell, index) => <Cell key={columns[index]!.label} cell={cell} method={columns[index]!.label} />)
      )}
      <More row={row} />
    </article>
  );
}

function Group({ group, columns }: { readonly group: ClosingGroupView; readonly columns: Board['columns'] }) {
  return (
    <section aria-label={`${group.label} ${group.rows.length}건`} className='mt-5'>
      <h3 className='flex items-baseline gap-2.5 border-b border-border pb-2'>
        <span className='text-[16px] font-extrabold tracking-[-0.03em]'>{group.label}</span>
        <span className='text-[14px] font-semibold text-muted-foreground'>{group.relative}</span>
        <span className={`ml-auto text-[14px] font-semibold tabular-nums ${HINT}`}>{group.rows.length}건</span>
      </h3>
      {group.rows.map((row) => <Row key={row.auctionId} row={row} columns={columns} />)}
    </section>
  );
}

export function BidBoardList({ view }: { readonly view: Board }) {
  return (
    <div data-slot='bid-board'>
      <div className={`mt-5 hidden items-end gap-x-2.5 border-b border-border pb-1.5 sm:grid ${CELLS}`}>
        <span className={`text-[12px] font-semibold ${HINT}`}>{view.columnCaption}</span>
        {view.columns.map((column) => (
          <span key={column.label} className='pr-2.5 text-right text-[13px] font-extrabold'>
            {column.label}
            <span className={`block text-[11.5px] font-semibold ${HINT}`}>{column.record}</span>
          </span>
        ))}
      </div>
      {view.groups.map((group) => <Group key={`${group.label}-${group.relative}`} group={group} columns={view.columns} />)}
    </div>
  );
}
