/** @module 책임: 공고가 열렸는지·언제 닫히는지·내가 기록했는지를 사실 짝 한 줄로 보인다. 절대 위치 없이 플렉스 두 줄이다. */
import type { DecisionPresentation } from '../_model/present-decision';

type DecisionBannerProps = {
  readonly decision: DecisionPresentation;
  // recordedAt은 서버 영속화가 붙이는 사실이라 이 슬라이스에서는 항상 null이다. 값이 생기면
  // "rate · 시각"으로 붙이는 건 영속화가 붙는 후속 슬라이스의 몫이다.
  readonly record: { readonly rate: string; readonly recordedAt: string | null } | null;
};

const SENTENCE = {
  open: '이 공고가 열려 있습니다',
  closed: '개찰이 끝났습니다',
  unknown: '마감 시각이 아직 관측되지 않았습니다'
} as const;

function Fact({ label, value, tail }: { readonly label: string; readonly value: string; readonly tail?: string }) {
  return (
    <div className='flex items-baseline gap-2 whitespace-nowrap'>
      <span className='text-[13px] font-semibold text-muted-foreground/70'>{label}</span>
      <span className='text-base font-semibold tabular-nums text-foreground'>{value}</span>
      {tail ? <span className='text-[13px] font-semibold text-muted-foreground'>{tail}</span> : null}
    </div>
  );
}

export function DecisionBanner({ decision, record }: DecisionBannerProps) {
  const { banner, railState } = decision;
  return (
    <div className='relative flex flex-col gap-2 overflow-hidden rounded-xl bg-card px-5 py-3 shadow-xs'>
      <div className='absolute inset-y-0 left-0 w-1 bg-primary' aria-hidden />
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-[15px] font-semibold whitespace-nowrap text-primary'>{SENTENCE[railState]}</span>
        <span className='inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold whitespace-nowrap'>
          기초 {decision.baseAmount.text}원
        </span>
      </div>
      <div className='flex flex-wrap gap-x-7 gap-y-1'>
        <Fact label={railState === 'closed' ? '개찰' : '마감까지'} value={banner.remaining} tail={banner.deadlineAt} />
        <Fact label='개찰' value={banner.openedAt} />
        <Fact label='공고' value={banner.announcedAt} />
        <Fact label='내 기록' value={record ? record.rate : '아직 없음'} />
      </div>
    </div>
  );
}
