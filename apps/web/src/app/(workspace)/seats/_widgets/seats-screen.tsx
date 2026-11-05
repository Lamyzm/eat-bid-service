/** @module 책임: 시장 자리 목록(시장·업체·사업자번호·기간·상태·최근 기록)과 자리 주기 폼을 한 화면으로 배치하고, 운영자가 아니면 볼 수 없음을 그린다. */
import { Temporal } from '@eatbid/domain';

import type { OperatorMarketSeat, OperatorMarketSeatsRead } from '@/api/operator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { GrantSeatForm } from '../_features/grant-seat/ui/grant-seat-form';
import { SeatActions } from '../_features/seat-actions/ui/seat-actions';
import {
  businessNumberText,
  dateText,
  instantText,
  itemText,
  lastDayOf,
  reasonText,
  regionText,
  remainingDays,
  seatOrder,
  seatStanding,
  standingText,
  todayInKst,
  type SeatStanding
} from '../_lib/seat-text';
import { SeatsFrame } from './seats-frame';

const EVENT_TEXT: Record<OperatorMarketSeat['events'][number]['kind'], string> = {
  held: '선점',
  activated: '부여',
  extended: '연장',
  revoked: '회수',
  released: '해제',
  reclaimed: '되찾기',
  offered: '제안',
  corrected: '정정'
};

/** 무엇을 왜 했는지가 먼저고 시각은 뒤다. 운영자가 읽는 순서다. */
function latestEvent(seat: OperatorMarketSeat): string {
  const event = seat.events[0];
  if (event === undefined) return '기록 없음';
  const memo = event.memo === null ? '' : ` · ${event.memo}`;
  return `${EVENT_TEXT[event.kind]} · ${reasonText(event.reason)}${memo} (${instantText(event.occurredAt)})`;
}

interface SeatView {
  readonly seat: OperatorMarketSeat;
  readonly standing: SeatStanding;
  readonly status: string;
  /** 7일 안에 끝나면 굵게 한다. 글자("곧 끝남")가 먼저 말하고 굵기는 거든다. */
  readonly urgent: boolean;
  readonly period: string;
  readonly priority: string;
  readonly numbers: string;
}

function viewOf(seat: OperatorMarketSeat, now: Temporal.Instant): SeatView {
  const standing = seatStanding(seat, now);
  return {
    seat,
    standing,
    status: standingText(standing, seat, now),
    urgent: standing === 'active' && remainingDays(seat, now) <= 7,
    period: `${dateText(todayInKst(Temporal.Instant.from(seat.startsAt)))} ~ ${dateText(lastDayOf(seat.endsAt))}`,
    priority: `우선권 ${dateText(todayInKst(Temporal.Instant.from(seat.priorityStartedAt)))}`,
    numbers: seat.workspace.businessNumbers.length === 0 ? '등록 번호 없음' : seat.workspace.businessNumbers.map(businessNumberText).join(', ')
  };
}

function SeatTable({ views }: { readonly views: readonly SeatView[] }) {
  return (
    <div className='hidden overflow-x-auto rounded-2xl border border-border md:block'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope='col'>시장</TableHead>
            <TableHead scope='col'>업체 · 사업자번호</TableHead>
            <TableHead scope='col'>기간</TableHead>
            <TableHead scope='col'>상태</TableHead>
            <TableHead scope='col'>최근 기록</TableHead>
            <TableHead scope='col'><span className='sr-only'>동작</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {views.map((view) => (
            <TableRow key={view.seat.marketSeatId} className={view.standing === 'ended' ? 'text-muted-foreground' : undefined}>
              <TableCell className='align-top font-semibold'>
                {regionText(view.seat.region)}
                <span className='block text-[13px] font-normal text-muted-foreground'>{itemText(view.seat.item)}</span>
              </TableCell>
              <TableCell className='align-top'>
                {view.seat.workspace.name}
                <span className='block text-[13px] text-muted-foreground tabular-nums'>{view.numbers}</span>
              </TableCell>
              <TableCell className='align-top tabular-nums'>
                {view.period}
                <span className='block text-[13px] text-muted-foreground'>{view.priority}</span>
              </TableCell>
              <TableCell className={view.urgent ? 'align-top font-bold' : 'align-top'}>{view.status}</TableCell>
              <TableCell className='max-w-[280px] align-top text-[13px] whitespace-normal'>{latestEvent(view.seat)}</TableCell>
              <TableCell className='align-top'>{view.standing === 'ended' ? null : <SeatActions seat={view.seat} />}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** 휴대폰에서는 표가 잘려 동작 버튼이 화면 밖으로 나가므로 한 자리를 카드 하나로 쌓는다. */
function SeatCards({ views }: { readonly views: readonly SeatView[] }) {
  return (
    <ul className='grid gap-3 md:hidden'>
      {views.map((view) => (
        <li key={view.seat.marketSeatId} className={view.standing === 'ended' ? 'grid gap-2 rounded-2xl border border-border p-4 text-muted-foreground' : 'grid gap-2 rounded-2xl border border-border p-4'}>
          <div className='flex items-baseline justify-between gap-3'>
            <p className='font-semibold'>
              {regionText(view.seat.region)} · {itemText(view.seat.item)}
            </p>
            <p className={view.urgent ? 'shrink-0 text-[13px] font-bold' : 'shrink-0 text-[13px]'}>{view.status}</p>
          </div>
          <p className='text-[14px]'>
            {view.seat.workspace.name} <span className='text-muted-foreground tabular-nums'>{view.numbers}</span>
          </p>
          <p className='text-[14px] tabular-nums'>
            {view.period} <span className='text-muted-foreground'>· {view.priority}</span>
          </p>
          <p className='text-[13px] text-muted-foreground'>{latestEvent(view.seat)}</p>
          {view.standing === 'ended' ? null : <SeatActions seat={view.seat} />}
        </li>
      ))}
    </ul>
  );
}

export function SeatsScreen({ read, now }: { readonly read: OperatorMarketSeatsRead; readonly now: string }) {
  if (read.kind === 'forbidden') {
    return (
      <section className='mx-auto grid w-full max-w-xl gap-2 px-4 py-16 text-center' aria-labelledby='seats-forbidden-title'>
        <h1 id='seats-forbidden-title' className='text-xl font-semibold'>운영자만 볼 수 있는 화면입니다</h1>
        <p className='text-sm text-muted-foreground'>권한이 필요하면 운영자에게 요청해 주세요.</p>
      </section>
    );
  }
  const instant = Temporal.Instant.from(now);
  const views = read.seats.seats.toSorted(seatOrder(instant)).map((seat) => viewOf(seat, instant));
  return (
    <SeatsFrame form={<GrantSeatForm workspaces={read.workspaces.workspaces} today={dateText(todayInKst(instant))} />}>
      <section aria-labelledby='seats-list-title' className='grid gap-3'>
        <h2 id='seats-list-title' className='text-[18px] font-bold'>
          자리 목록 <span className='text-muted-foreground tabular-nums'>{views.length}</span>
        </h2>
        {views.length === 0 ? (
          <p className='rounded-2xl border border-dashed border-border p-6 text-center text-[15px] text-muted-foreground'>
            아직 준 자리가 없습니다. 아래에서 첫 자리를 주세요.
          </p>
        ) : (
          <>
            <SeatTable views={views} />
            <SeatCards views={views} />
          </>
        )}
        <p className='text-[13px] text-muted-foreground'>끝난 지 30일 안의 자리까지 보입니다. 끝나는 날은 그날 밤 12시까지입니다.</p>
      </section>
    </SeatsFrame>
  );
}
