/** @module 책임: 자리 한 줄의 연장·회수 command 입력과 회수 확인(시장 이름 다시 쓰기)·거절 문구를 소유한다. */
'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import {
  extendMarketSeat,
  maxMarketSeatMonths,
  revokeMarketSeat,
  type MarketSeatCommandResult,
  type MarketSeatReason,
  type OperatorMarketSeat
} from '@/api/operator';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { LoadingButton } from '@/shared/ui/loading-button';
import { REASON_OPTIONS, marketText, rejectionText } from '@/app/(workspace)/seats/_lib/seat-text';

type Mode = 'idle' | 'extend' | 'revoke';
const MONTHS = Array.from({ length: maxMarketSeatMonths }, (_, index) => index + 1);
const fieldClass = 'h-9 w-full rounded-lg border border-input bg-background px-2.5 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring';

function reasonOf(value: string): MarketSeatReason {
  return REASON_OPTIONS.find((option) => option.value === value)?.value ?? 'other';
}

export function SeatActions({ seat }: { readonly seat: OperatorMarketSeat }) {
  const router = useRouter();
  const id = useId();
  const [mode, setMode] = useState<Mode>('idle');
  const [months, setMonths] = useState(1);
  const [reason, setReason] = useState<MarketSeatReason>('payment-confirmed');
  const [memo, setMemo] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [result, setResult] = useState<MarketSeatCommandResult | null>(null);
  const market = marketText(seat);

  const command = useMutation({
    mutationFn: () => {
      const note = { reason, memo: memo.trim() === '' ? undefined : memo.trim() };
      return mode === 'extend' ? extendMarketSeat(seat.marketSeatId, { ...note, months }) : revokeMarketSeat(seat.marketSeatId, note);
    },
    onSuccess: (outcome) => {
      setResult(outcome);
      if (outcome.kind === 'saved') {
        setMode('idle');
        router.refresh();
      }
    }
  });

  function open(next: Mode) {
    setMode(next);
    setResult(null);
    setMemo('');
    setConfirmation('');
    setReason(next === 'extend' ? 'payment-confirmed' : 'refund-request');
    command.reset();
  }

  if (mode === 'idle') {
    return (
      <div className='flex gap-1.5'>
        <button type='button' onClick={() => open('extend')} className='h-8 rounded-lg px-3 text-[13px] font-semibold hover:bg-foreground/5'>
          연장
        </button>
        <button type='button' onClick={() => open('revoke')} className='h-8 rounded-lg px-3 text-[13px] font-semibold text-destructive hover:bg-destructive/10'>
          회수
        </button>
      </div>
    );
  }

  // 회수는 마감 전 공고를 바로 다른 후보에게 넘긴다. 잘못 누르지 않게 시장 이름을 그대로 다시 쓰게 한다.
  const confirmed = mode === 'extend' || confirmation.trim() === market;
  const messageId = `${id}-message`;
  const message = command.isError
    ? '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
    : result?.kind === 'rejected' ? `저장할 수 없습니다: ${rejectionText(result.rejection)}` : null;

  return (
    <form
      aria-label={mode === 'extend' ? `${market} 연장` : `${market} 회수`}
      className='grid min-w-[260px] gap-2'
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmed) command.mutate();
      }}
    >
      {mode === 'extend' ? (
        <div className='grid gap-1'>
          <Label htmlFor={`${id}-months`} className='text-[13px]'>늘릴 기간</Label>
          <select id={`${id}-months`} value={months} onChange={(event) => setMonths(Number(event.target.value))} className={fieldClass}>
            {MONTHS.map((count) => (
              <option key={count} value={count}>
                {count}개월
              </option>
            ))}
          </select>
          <p className='text-[12px] text-muted-foreground'>끝만 늘어나고 우선권 시작일은 그대로입니다.</p>
        </div>
      ) : (
        <div className='grid gap-1'>
          <Label htmlFor={`${id}-confirm`} className='text-[13px]'>확인하려면 시장 이름을 그대로 쓰세요: {market}</Label>
          <Input id={`${id}-confirm`} value={confirmation} autoComplete='off' onChange={(event) => setConfirmation(event.target.value)} />
          <p className='text-[12px] text-muted-foreground'>지금 시각에 끝나고, 마감 전 공고는 다른 후보에게 넘어가거나 금액이 나가지 않습니다.</p>
        </div>
      )}
      <div className='grid grid-cols-2 gap-2'>
        <div className='grid gap-1'>
          <Label htmlFor={`${id}-reason`} className='text-[13px]'>사유</Label>
          <select id={`${id}-reason`} value={reason} onChange={(event) => setReason(reasonOf(event.target.value))} className={fieldClass}>
            {REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className='grid gap-1'>
          <Label htmlFor={`${id}-memo`} className='text-[13px]'>메모</Label>
          <Input id={`${id}-memo`} value={memo} maxLength={500} required={reason === 'other'} onChange={(event) => setMemo(event.target.value)} />
        </div>
      </div>
      <div className='flex gap-1.5'>
        <LoadingButton type='submit' loading={command.isPending} disabled={!confirmed} className='h-8 flex-1' aria-describedby={message === null ? undefined : messageId}>
          {mode === 'extend' ? '연장하기' : '회수하기'}
        </LoadingButton>
        <button type='button' onClick={() => setMode('idle')} className='h-8 rounded-lg px-3 text-[13px] font-semibold hover:bg-foreground/5'>
          취소
        </button>
      </div>
      {message === null ? null : (
        <p id={messageId} role='alert' className='text-[13px] font-semibold text-destructive'>
          {message}
        </p>
      )}
    </form>
  );
}
