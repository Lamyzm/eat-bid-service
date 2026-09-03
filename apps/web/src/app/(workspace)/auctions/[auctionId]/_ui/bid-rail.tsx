'use client';
/** @module 책임: 투찰률 손잡이·직접 입력·넣을 금액·내 값 기록의 브라우저 상태를 소유한다. 추천값은 만들지 않고 사용자가 정한 값만 다룬다. */
import { useState } from 'react';

import { createMemoryBidRecordPort, type BidRecord, type BidRecordPort } from '../_lib/bid-record-port';
import { type BidRate, type BidRateStep, bidAmount, formatWon, parseBidRate, stepBidRate } from '../_model/bid-rate';
import type { DecisionPresentation } from '../_model/present-decision';

type BidRailProps = {
  readonly decision: DecisionPresentation;
  readonly port?: BidRecordPort;
  readonly initialRate?: BidRate;
  readonly onRecord?: (record: BidRecord) => void;
};

const STEPS: readonly BidRateStep[] = ['-0.01', '-0.001', '+0.001', '+0.01'];

// RSC는 함수·port 객체를 client component에 prop으로 넘길 수 없다(직렬화 불가). DecisionScreen이
// port를 안 넘기면 이 모듈 스코프 싱글턴을 쓴다. 영속화 adapter는 app 스키마와 함께 후속 슬라이스에서 바꾼다.
const defaultPort = createMemoryBidRecordPort();

export function BidRail({ decision, port = defaultPort, initialRate = '90.000', onRecord }: BidRailProps) {
  const [rate, setRate] = useState<BidRate>(initialRate);
  const [draft, setDraft] = useState(initialRate);
  const [record, setRecord] = useState<BidRecord | null>(null);
  const amount = bidAmount(decision.baseAmount.raw, rate);

  if (decision.railState === 'closed') {
    return (
      <div className='rounded-xl bg-card p-4 shadow-xs'>
        <span className='text-xl font-bold'>복기</span>
        <p className='mt-2 flex flex-col gap-0.5 text-[15px] font-medium text-muted-foreground'>
          <span>개찰이 끝난 공고입니다</span>
          <span>결과 명단은 다음 슬라이스에서 붙습니다</span>
        </p>
      </div>
    );
  }

  function commitDraft() {
    const parsed = parseBidRate(draft);
    if (parsed) setRate(parsed);
    setDraft(parsed ?? rate);
  }

  function applyStep(step: BidRateStep) {
    const next = stepBidRate(rate, step);
    setRate(next);
    setDraft(next);
  }

  // 기록 시각은 서버 영속화가 저장 시점에 붙이는 사실이다(규칙 15·17). 이 슬라이스는 영속화가 없으니
  // 값을 만들지 않고 null을 저장한다.
  async function saveRecord() {
    const next: BidRecord = { auctionId: decision.identity.auctionId, rate, amount, recordedAt: null };
    await port.save(next);
    setRecord(next);
    onRecord?.(next);
  }

  return (
    <div className='flex flex-col gap-2.5 rounded-xl bg-card p-4 shadow-xs'>
      <span className='text-xl font-bold'>투찰</span>
      <div className='flex h-16 items-center rounded-lg bg-foreground/[0.04] px-4'>
        <label htmlFor='bid-rate' className='flex flex-col'>
          <span className='text-[15px] font-semibold text-muted-foreground'>투찰률</span>
          <span className='text-[15px] font-medium text-muted-foreground'>눌러서 직접 입력</span>
        </label>
        <input
          id='bid-rate'
          aria-label='투찰률'
          inputMode='decimal'
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          className='ml-auto w-36 bg-transparent text-right text-[32px] leading-none font-bold tracking-tight tabular-nums outline-none'
        />
      </div>
      <div className='flex gap-1.5'>
        {STEPS.map((step) => (
          <button
            key={step}
            type='button'
            aria-label={step}
            onClick={() => applyStep(step)}
            className='h-11 flex-1 rounded-lg bg-foreground/5 text-[15px] font-semibold tabular-nums whitespace-nowrap'
          >
            {step.replace('-', '−')}
          </button>
        ))}
      </div>
      <div className='flex items-center gap-2 px-1'>
        <span className='text-[15px] font-semibold text-muted-foreground'>넣을 금액</span>
        <span className='ml-auto flex items-baseline gap-1 whitespace-nowrap'>
          <span className='text-2xl font-bold tracking-tight tabular-nums'>{formatWon(amount)}</span>
          <span className='text-[13px] font-semibold text-muted-foreground'>원</span>
        </span>
        <button
          type='button'
          onClick={() => navigator.clipboard?.writeText(amount)}
          className='h-8 rounded-lg bg-foreground/5 px-3 text-[13px] font-semibold whitespace-nowrap'
        >
          금액 복사
        </button>
      </div>
      <button type='button' onClick={saveRecord} className='h-12 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground'>
        내 값 기록
      </button>
      <div className='flex items-baseline gap-2 px-1'>
        <span className='flex flex-col'>
          <span className='text-[15px] font-semibold'>{record ? `${record.rate} 기록됨` : '아직 기록 없음'}</span>
          <span className='text-[15px] font-medium text-muted-foreground'>내가 쓰기로 한 값을 저장합니다</span>
        </span>
        <span className='ml-auto text-[13px] font-semibold whitespace-nowrap text-muted-foreground'>마감 {decision.banner.deadlineAt}</span>
      </div>
    </div>
  );
}
