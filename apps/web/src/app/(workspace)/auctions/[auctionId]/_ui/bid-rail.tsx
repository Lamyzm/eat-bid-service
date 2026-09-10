/** @module 책임: 투찰률 손잡이·직접 입력·넣을 금액·내 값 기록의 브라우저 상태를 소유한다. 추천값은 만들지 않고 사용자가 정한 값만 다루며, 값이 없는 동안은 손잡이·금액·기록을 멈춘다. */
'use client';

import { useEffect, useState } from 'react';

import { createMemoryBidRecordPort, type BidRecord, type BidRecordPort } from '../_lib/bid-record-port';
import { type BidRateStep, bidAmount, formatWon, parseBidRate, stepBidRate } from '../_model/bid-rate';
import type { DecisionPresentation } from '../_model/present-decision';
import { NO_RATE_PHRASE } from '../_model/verdict-vocabulary';
import { useBidRate } from './bid-rate-context';

type BidRailProps = {
  readonly decision: DecisionPresentation;
  readonly port?: BidRecordPort;
  readonly onRecord?: (record: BidRecord) => void;
  /** "이 값이면" 패널 슬롯. 레일은 자리만 주고 회차 이력 의존성은 화면 조립부가 소유한다. */
  readonly rehearsal?: React.ReactNode;
};

const STEPS: readonly BidRateStep[] = ['-0.01', '-0.001', '+0.001', '+0.01'];

// 손잡이 aria-label은 부호·소수만 읽는 스크린리더 경험을 피하려고 "투찰률 0.001 올리기" 형태로 쓴다.
function stepLabel(step: BidRateStep): string {
  return `투찰률 ${step.slice(1)} ${step.startsWith('-') ? '내리기' : '올리기'}`;
}

// RSC는 함수·port 객체를 client component에 prop으로 넘길 수 없다(직렬화 불가). DecisionScreen이
// port를 안 넘기면 이 모듈 스코프 싱글턴을 쓴다. 영속화 adapter는 app 스키마와 함께 후속 슬라이스에서 바꾼다.
const defaultPort = createMemoryBidRecordPort();

// 저장·복사 실패는 서로 다른 위치(상태 줄 vs 버튼 라벨)에 나타나지만 동시에 둘 다 실패 상태일 수는
// 없으므로(사용자가 한 번에 하나씩 누른다) 하나의 상태로 관리한다.
type ActionFailure = 'save' | 'copy' | null;

export function BidRail({ decision, port = defaultPort, onRecord, rehearsal }: BidRailProps) {
  // 투찰률은 레일만의 상태가 아니다. 흐름 차트와 표의 마지막 열이 같은 값을 봐야 하므로 화면
  // 전체가 공유하는 context가 소유하고, 손잡이·직접 입력은 그 값을 바꾸기만 한다.
  const { rate, setRate } = useBidRate();
  const [draft, setDraft] = useState(rate ?? '');
  const [record, setRecord] = useState<BidRecord | null>(null);
  const [actionFailure, setActionFailure] = useState<ActionFailure>(null);
  // 값이 없으면 금액도 없다. 빈 손잡이에서 어떤 원점으로든 계산해 보이면 그 원점이 추천값이 된다(AGENTS 8).
  const amount = rate === null ? null : bidAmount(decision.baseAmount.raw, rate);

  // 마운트 시 이 공고에 이미 저장된 값이 있으면 복원한다. 진실 원천은 port 하나이며 이 컴포넌트는
  // 그 값을 반영만 한다.
  useEffect(() => {
    let cancelled = false;
    port
      .load(decision.identity.auctionId)
      .then((loaded) => {
        if (!cancelled && loaded) setRecord(loaded);
      })
      .catch(() => {
        // 복원 실패는 "아직 기록 없음"으로 보이는 것과 구분할 수 없어도 안전한 fallback이다.
      });
    return () => {
      cancelled = true;
    };
  }, [decision.identity.auctionId, port]);

  if (decision.railState === 'closed') {
    return (
      <div className='rounded-xl bg-card p-4 shadow-xs'>
        <span className='text-xl font-bold'>복기</span>
        <p className='mt-2 flex flex-col gap-0.5 text-[15px] font-medium text-muted-foreground'>
          <span>개찰이 끝난 공고입니다</span>
          <span>지난 회차의 참여 기록은 과거 회차 표에서 확인할 수 있어요</span>
        </p>
      </div>
    );
  }

  function commitDraft() {
    // 지운 입력은 잘못된 입력이 아니라 "값 없음"으로 돌아가겠다는 뜻이다. 이전 값을 되살리면 지울 수 없다.
    if (draft.trim() === '') {
      setRate(null);
      setDraft('');
      return;
    }
    const parsed = parseBidRate(draft);
    if (parsed) setRate(parsed);
    setDraft(parsed ?? rate ?? '');
  }

  // 손잡이는 있는 값을 옮길 뿐 값을 만들지 않는다. 빈 상태에서 눌렀을 때 어떤 원점에서 출발하든 그
  // 원점이 화면이 놓은 첫 값, 곧 추천값이 된다.
  function applyStep(step: BidRateStep) {
    if (rate === null) return;
    const next = stepBidRate(rate, step);
    setRate(next);
    setDraft(next);
  }

  // 기록 시각은 서버 영속화가 저장 시점에 붙이는 사실이다(규칙 15·17). 이 슬라이스는 영속화가 없으니
  // 값을 만들지 않고 null을 저장한다.
  async function saveRecord() {
    if (rate === null || amount === null) return;
    const next: BidRecord = { auctionId: decision.identity.auctionId, rate, amount, recordedAt: null };
    try {
      await port.save(next);
      setRecord(next);
      setActionFailure(null);
      onRecord?.(next);
    } catch {
      setActionFailure('save');
    }
  }

  // raw setTimeout 지연값은 architecture:check의 semantic-value gate가 ElapsedMilliseconds 기원만
  // 허용하는데, ElapsedMilliseconds는 @eatbid/domain 소유라 client bundle에 넣을 수 없다(rule 15·17,
  // apps/web AGENTS.md). 타이머 없이 다음 시도(재복사 성공/실패)에서 자연스럽게 사라지게 한다.
  async function copyAmount() {
    if (amount === null) return;
    try {
      await navigator.clipboard?.writeText(amount);
      setActionFailure(null);
    } catch {
      setActionFailure('copy');
    }
  }

  return (
    <div className='flex flex-col gap-2.5 rounded-xl bg-card p-4 shadow-xs'>
      <span className='text-xl font-bold'>투찰</span>
      <div className='flex h-16 items-center rounded-lg bg-foreground/[0.04] px-4'>
        {/* 이름은 이 label 하나가 만든다. 같은 입력에 aria-label을 겹치면 그쪽이 이겨 "눌러서 직접 입력"이
            이름에서 빠진다. 두 줄 사이의 공백은 이름을 붙여 읽지 않게 하려는 것이고, 공백만 있는 텍스트는
            flex 항목이 되지 않으므로 보이는 배치는 그대로다. */}
        <label htmlFor='bid-rate' className='flex flex-col'>
          <span className='text-[15px] font-semibold text-muted-foreground'>투찰률</span>{' '}
          <span className='text-[15px] font-medium text-muted-foreground'>눌러서 직접 입력</span>
        </label>
        {/* placeholder는 상태 이름이지 예시 값이 아니다. 숫자를 예로 보이면 그 숫자가 추천값으로 읽힌다. */}
        <input
          id='bid-rate'
          inputMode='decimal'
          placeholder={NO_RATE_PHRASE.panel.text}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          className='ml-auto w-36 bg-transparent text-right text-[32px] leading-tight font-bold tracking-tight tabular-nums outline-none placeholder:text-[20px] placeholder:font-semibold placeholder:text-muted-foreground/60'
        />
      </div>
      <div className='flex gap-1.5'>
        {STEPS.map((step) => (
          <button
            key={step}
            type='button'
            aria-label={stepLabel(step)}
            disabled={rate === null}
            onClick={() => applyStep(step)}
            className='h-11 flex-1 rounded-lg bg-foreground/5 text-[15px] font-semibold tabular-nums whitespace-nowrap disabled:opacity-40'
          >
            {step.replace('-', '−')}
          </button>
        ))}
      </div>
      <div className='flex items-center gap-2 px-1'>
        <span className='text-[15px] font-semibold text-muted-foreground'>넣을 금액</span>
        {amount === null ? (
          <span className='ml-auto text-[15px] font-semibold whitespace-nowrap text-muted-foreground'>{NO_RATE_PHRASE.panel.text}</span>
        ) : (
          <span className='ml-auto flex items-baseline gap-1 whitespace-nowrap'>
            <span className='text-2xl font-bold tracking-tight tabular-nums'>{formatWon(amount)}</span>
            <span className='text-[13px] font-semibold text-muted-foreground'>원</span>
          </span>
        )}
        <button
          type='button'
          disabled={amount === null}
          onClick={() => void copyAmount()}
          className='h-8 rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold whitespace-nowrap disabled:opacity-40'
        >
          {actionFailure === 'copy' ? '복사 실패' : '금액 복사'}
        </button>
      </div>
      <button
        type='button'
        disabled={rate === null}
        onClick={() => void saveRecord()}
        className='h-12 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40'
      >
        내 값 기록
      </button>
      <div className='flex items-baseline gap-2 px-1'>
        <span className='flex flex-col'>
          <span className='text-[15px] font-semibold'>
            {record ? `${record.rate} 기록됨` : actionFailure === 'save' ? '기록하지 못했습니다' : '아직 기록 없음'}
          </span>
          <span className='text-[15px] font-medium text-muted-foreground'>저장은 다음 단계에서 붙습니다</span>
        </span>
        <span className='ml-auto text-[13px] font-semibold whitespace-nowrap text-muted-foreground'>마감 {decision.banner.deadlineAt}</span>
      </div>
      {rehearsal}
    </div>
  );
}
