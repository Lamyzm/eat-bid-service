/**
 * @module 책임: 오늘 투찰 목록을 마감 시각 묶음 아래 행(왼쪽 공고 세 줄, 오른쪽 아침 갱신·맞춤·전국 공식 금액 칸)과 더 보기로 그린다. 무엇을
 * 쓸지는 표시 모델이 정하고 여기는 server component로 남는다 — 복사 손잡이와 폰 접기만 client다.
 */
import Link from 'next/link';

import { RecordBarList } from '@/entities/market-pick-record/record-bar-list';
import { BidFigureLine } from '@/entities/bid-figure/bid-figure-line';
import { CopyValue } from '@/shared/ui/copy-value';
import type { AmountCell, AmountLine, BoardRowView, BoardView, ClosingGroupView } from '../model/present-bid-board';
import { PhoneFold } from './phone-fold';

type Board = Extract<BoardView, { kind: 'board' }>;

// 글자 위계는 오늘 화면(U9)과 같다. 기관 17/700, 금액 16/800, 본문 14, 묶음 머리 14/700. 흐린 글자도 밝은 테마에서 읽히는
// 대비(muted-foreground 그대로)를 쓴다 — 투명도를 더 내리면 4.5:1 아래로 떨어진다.
const HINT = 'text-muted-foreground';
// 금액 칸 수에 따른 격자다. 세 칸은 넓은 화면(1280px 이상)에서만 한 줄에 두고, 그보다 좁으면 공고 줄 아래 세 칸을 나란히,
// 폰에서는 근거가 가장 강한 칸 하나만 두고 나머지는 접는다. 칸 폭은 시안(W1)의 184px이 아니라 두 칸 화면과 같은 204px이다 —
// 기초금액 1,000만 원대 공고의 "기초대비 % · 금액" 줄이 184px을 넘는다. 클래스 이름을 문자열로 다 적어야 Tailwind가 만든다.
const LAYOUTS = {
  2: {
    cells: 'sm:grid-cols-[minmax(0,1fr)_204px_204px]',
    info: '',
    header: 'sm:grid',
    methodName: 'sm:sr-only',
    hideUnlessLead: 'sm:hidden',
    span: 'sm:col-span-2'
  },
  3: {
    cells: 'sm:grid-cols-3 min-[1280px]:grid-cols-[minmax(0,1fr)_204px_204px_204px]',
    info: 'sm:col-span-3 min-[1280px]:col-span-1',
    header: 'min-[1280px]:grid',
    methodName: 'min-[1280px]:sr-only',
    hideUnlessLead: 'min-[1280px]:hidden',
    span: 'sm:col-span-3 min-[1280px]:col-span-3'
  }
} as const;
type Layout = (typeof LAYOUTS)[2 | 3];

// 폰에서는 근거가 가장 강한 칸을 DOM 맨 앞에 두고 나머지를 접는다. 넓은 화면에서는 열 자리를 이 순서로 되돌린다.
const COLUMN_ORDER = ['sm:order-1', 'sm:order-2', 'sm:order-3'] as const;

/** 투찰 소수는 손으로 옮겨 치면 사고가 나므로 복사 표시를 늘 보인다. 근거가 가장 강한 칸의 큰 숫자는 테두리와 같은 색이다. */
function AmountLines({ lines, lead = false, showLabel = true }: {
  readonly lines: readonly AmountLine[];
  readonly lead?: boolean;
  /** 더 보기 목록은 이름을 왼쪽 칸에 따로 적으므로 숫자 옆에서는 감춘다. 읽기 이름에는 그대로 남는다. */
  readonly showLabel?: boolean;
}) {
  return (
    <>
      {lines.map((line) => (
        <BidFigureLine key={line.label} label={line.label} figure={line.figure} lead={lead} showLabel={showLabel} />
      ))}
    </>
  );
}

function Cell({ cell, method, layout, order }: {
  readonly cell: AmountCell;
  readonly method: string;
  readonly layout: Layout;
  readonly order: string;
}) {
  if (cell.kind === 'reason') {
    return (
      <div data-slot='bid-board-cell' data-cell='reason' className={`flex flex-wrap content-start justify-end gap-x-1.5 rounded-lg px-2.5 py-2 text-[12px] font-semibold ${order}`}>
        <span data-slot='bid-board-cell-method' className={layout.methodName}>{method}</span>
        <span className='text-right text-muted-foreground'>{cell.text}</span>
      </div>
    );
  }
  // 근거 표시가 없는 칸은 글자를 한 단계 흐리게 둔다. 숫자 셋(사정률·기초대비·금액)은 그대로 다 보인다(ADR 0066) — 눈만 파란 칸에 먼저 간다.
  return (
    <div
      data-slot='bid-board-cell'
      data-cell='amounts'
      className={`grid content-start justify-items-end gap-1 rounded-lg px-2.5 py-2 ${order} ${cell.lead ? 'bg-background ring-2 ring-primary' : 'text-muted-foreground'}`}
      aria-label={cell.lead ? `${method}, 지금 근거가 가장 강한 방법` : method}
      role='group'
    >
      {/* 근거 칸은 어느 화면 폭에서도 방법 이름을 보인다 — 스크롤해 열 머리가 안 보여도 파란 칸이 무엇인지 안다. */}
      <span className={`flex w-full items-baseline justify-between gap-1.5 text-[11.5px] font-bold ${cell.lead ? '' : layout.hideUnlessLead}`}>
        <span data-slot='bid-board-cell-method' className={cell.lead ? 'text-foreground' : layout.methodName}>{method}</span>
        {cell.lead ? <span className='text-primary'>근거 가장 강함</span> : null}
      </span>
      {cell.note === undefined ? null : (
        <span data-slot='bid-board-cell-note' className='text-[11.5px] font-semibold text-muted-foreground tabular-nums'>{cell.note}</span>
      )}
      <AmountLines lines={cell.lines} lead={cell.lead} />
    </div>
  );
}

function Cells({ row, board, layout }: { readonly row: BoardRowView; readonly board: Board; readonly layout: Layout }) {
  const placed = row.cells.map((cell, index) => ({ cell, method: board.columns[index]!.label, order: COLUMN_ORDER[index]! }));
  const lead = placed.find(({ cell }) => cell.kind === 'amounts' && cell.lead);
  const draw = ({ cell, method, order }: (typeof placed)[number]) => (
    <Cell key={method} cell={cell} method={method} layout={layout} order={order} />
  );
  if (lead === undefined) return <>{placed.map(draw)}</>;
  // 접는 것은 금액 칸뿐이다. 이유 칸("내일 아침에 다시 열면 계산돼요")은 한 줄이고 언제 다시 볼지를 말하므로 폰에서도 펼쳐 둔다.
  const reasons = placed.filter((entry) => entry !== lead && entry.cell.kind === 'reason');
  const folded = placed.filter((entry) => entry !== lead && entry.cell.kind === 'amounts');
  return (
    <>
      {draw(lead)}
      {reasons.map(draw)}
      {folded.length === 0 ? null : (
        <PhoneFold label={folded.length === 1 ? `${folded[0]!.method} 금액도 보기` : `다른 방법 ${folded.length}개 금액 보기`}>
          {folded.map(draw)}
        </PhoneFold>
      )}
    </>
  );
}

function MoreCard({ title, wide = false, children }: { readonly title: string; readonly wide?: boolean; readonly children: React.ReactNode }) {
  return (
    <section className={`grid content-start gap-2 rounded-lg bg-background px-3 py-2.5 ${wide ? 'md:col-span-2' : ''}`}>
      <h4 className='text-[13px] font-bold'>{title}</h4>
      {children}
    </section>
  );
}

function MoreLines({ lines }: { readonly lines: readonly (AmountLine & { readonly note?: string | null })[] }) {
  return (
    <dl className='grid gap-1.5'>
      {lines.map((line) => (
        <div key={line.label} className='flex items-baseline justify-between gap-3'>
          <dt className='text-muted-foreground'>{line.label}{line.note ? ` · ${line.note}` : ''}</dt>
          <dd><AmountLines lines={[line]} showLabel={false} /></dd>
        </div>
      ))}
    </dl>
  );
}

/** 성적을 맨 위에 폭 전체로 둔다 — "얼마나 믿을지"가 예비 순위보다 먼저다. 방법별 상자는 그 아래에 아침 갱신부터 칸 순서대로 선다. */
function More({ row, board }: { readonly row: BoardRowView; readonly board: Pick<Board, 'record' | 'ruleBasis'> }) {
  const { record } = board;
  const { habit, market, ruleExtras, band } = row.more;
  if (habit === null && market === null && ruleExtras.length === 0 && band === null) return null;
  return (
    <details className='group col-span-full text-[13px] sm:order-last'>
      <summary className='w-fit cursor-pointer text-[13px] font-bold text-primary hover:underline'>
        더 보기 · 근거와 예비 순위
      </summary>
      <div className='mt-2 grid gap-2 rounded-xl bg-muted/70 p-2 md:grid-cols-2'>
        <MoreCard title={record.heading} wide>
          <RecordBarList bars={record.bars} />
          <p className={HINT}>{record.basis}</p>
        </MoreCard>
        {habit === null ? null : (
          <MoreCard title='아침 갱신'>
            <p>{habit.text}</p>
            <p className={HINT}>{habit.record}</p>
          </MoreCard>
        )}
        {market === null ? null : (
          <MoreCard title={market.title}>
            <MoreLines lines={[market.single, ...market.spares]} />
            <p className={HINT}>{market.basis}</p>
          </MoreCard>
        )}
        {ruleExtras.length === 0 && band === null ? null : (
          <MoreCard title='전국 공식 더 보기'>
            {ruleExtras.length === 0 ? null : <MoreLines lines={ruleExtras} />}
            {band === null ? null : <p className={HINT}>{band}.</p>}
            <p className={HINT}>{board.ruleBasis}</p>
          </MoreCard>
        )}
      </div>
    </details>
  );
}

function RowInfo({ row, layout }: { readonly row: BoardRowView; readonly layout: Layout }) {
  return (
    <div className={`min-w-0 ${layout.info}`}>
      <p className='flex min-w-0 flex-wrap items-baseline gap-x-2'>
        <Link href={row.href} className='text-[17px] font-bold tracking-[-0.025em] hover:underline'>{row.organization}</Link>
        {row.item === null ? null : <span className='text-[14px] font-semibold text-muted-foreground'>{row.item}</span>}
      </p>
      {/* 실제 eaT 제목은 "2026년 10월 ○○중 식재료(육류) 소액수의"처럼 뒤쪽에 정보가 있어 두 줄까지 보이고, 넘치면 전체를 title로 둔다. */}
      {row.title === null ? null : (
        <p className='mt-1 line-clamp-2 text-[14px] text-muted-foreground' title={row.title}>{row.title}</p>
      )}
      <p className='mt-[7px] flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[14px] tabular-nums'>
        {row.facts.map((fact) => (
          <span key={fact.label}>
            <span className={HINT}>{fact.label}</span> <span className='font-bold'>{fact.value}</span>
          </span>
        ))}
        {row.bidNo === null ? null : (
          <span className='text-[13px]'>
            <span className={HINT}>공고번호</span>{' '}
            <CopyValue value={row.bidNo} label={`공고번호 ${row.bidNo}`} chip className='inline-flex items-baseline gap-1 rounded font-semibold hover:underline'>
              <span>{row.bidNo}</span>
            </CopyValue>
          </span>
        )}
      </p>
    </div>
  );
}

function Row({ row, board }: { readonly row: BoardRowView; readonly board: Board }) {
  const layout = LAYOUTS[board.methods];
  const spanned = 'self-start rounded-lg border border-dashed border-border px-3 py-2 text-[13px] font-semibold text-muted-foreground sm:text-right';
  return (
    <article data-slot='bid-board-row' className={`grid gap-x-2.5 gap-y-2 py-3.5 ${layout.cells} [&+&]:border-t [&+&]:border-border`}>
      <RowInfo row={row} layout={layout} />
      {row.selfJudged ? (
        <p className={`${spanned} ${layout.span}`}>하한율 88% · 직접 판단</p>
      ) : row.sharedReason !== null ? (
        <p data-slot='bid-board-shared-reason' className={`${spanned} ${layout.span}`}>{row.sharedReason}</p>
      ) : (
        <Cells row={row} board={board} layout={layout} />
      )}
      <More row={row} board={board} />
    </article>
  );
}

function Group({ group, board }: { readonly group: ClosingGroupView; readonly board: Board }) {
  return (
    <section aria-label={`${group.label} ${group.rows.length}건`} className='mt-5'>
      <h3 className='flex items-baseline gap-2.5 border-b border-border pb-2'>
        <span className='text-[16px] font-extrabold tracking-[-0.03em]'>{group.label}</span>
        {group.relative === null ? null : <span className='text-[14px] font-semibold text-muted-foreground'>{group.relative}</span>}
        <span className={`ml-auto text-[14px] font-semibold tabular-nums ${HINT}`}>{group.rows.length}건</span>
      </h3>
      {group.rows.map((row) => <Row key={row.auctionId} row={row} board={board} />)}
    </section>
  );
}

/** 읽는 법은 목록 위에 접어 둔다. 처음 한 번 읽으면 되는 글이라 매번 목록 끝까지 내려가 찾게 하지 않는다. */
function ReadingGuide({ lines }: { readonly lines: readonly string[] }) {
  return (
    <details className='mt-4 rounded-xl bg-muted/60 px-4 py-2.5'>
      <summary className='w-fit cursor-pointer text-[14px] font-bold'>이 화면 읽는 법</summary>
      <ul className='mt-1.5 grid list-disc gap-1 pl-5 text-[13px] text-muted-foreground'>
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </details>
  );
}

export function BidBoardList({ view }: { readonly view: Board }) {
  const layout = LAYOUTS[view.methods];
  return (
    <div data-slot='bid-board'>
      <ReadingGuide lines={view.guide} />
      {/* 열 머리는 셸 머리(폰 64px·넓은 화면 56px) 바로 아래에 붙어 따라온다. 스크롤해도 각 칸이 무슨 방법인지 보인다. */}
      <div
        data-slot='bid-board-columns'
        className={`sticky top-16 z-10 mt-4 hidden items-end gap-x-2.5 border-b border-border bg-background pt-2 pb-1.5 md:top-14 ${layout.header} ${layout.cells}`}
      >
        <span className={`text-[12px] font-semibold ${HINT}`}>{view.columnCaption}</span>
        {view.columns.map((column) => (
          <span key={column.label} className='pr-2.5 text-right text-[13px] font-extrabold'>
            {column.label}
            <span className='block text-[11.5px] font-semibold text-foreground'>{column.record}</span>
            <span className='block text-[11.5px] font-semibold text-muted-foreground'>{column.sample}</span>
          </span>
        ))}
      </div>
      {view.groups.map((group) => (
        <Group key={`${group.label}-${group.relative ?? ''}`} group={group} board={view} />
      ))}
    </div>
  );
}
