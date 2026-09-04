/** @module 책임: 공고가 열렸는지·언제 닫히는지를 사실 짝 한 줄로 보인다. 절대 위치 없이 플렉스 두 줄이다.
 * 내 기록은 이 슬라이스의 진실 원천이 아니다(rail 하나가 소유한다). */
import type { DecisionPresentation } from '../_model/present-decision';

type DecisionBannerProps = {
  readonly decision: DecisionPresentation;
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

export function DecisionBanner({ decision }: DecisionBannerProps) {
  const { banner, railState } = decision;
  // 첫 Fact 라벨·꼬리는 상태별로 다른 사실을 짝짓는다: open은 남은 시간·마감 시각, closed는 개찰 후
  // 지난 시간·개찰 시각, unknown은 값 자체가 이미 "미확인"이라 꼬리를 두지 않는다(미확인 중복 금지).
  const firstLabel = railState === 'closed' ? '개찰 후' : railState === 'unknown' ? '마감' : '마감까지';
  const firstTail = railState === 'closed' ? banner.openedAt : railState === 'unknown' ? undefined : banner.deadlineAt;
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
        <Fact label={firstLabel} value={banner.remaining} tail={firstTail} />
        {/* closed일 때 개찰 시각은 이미 첫 Fact의 꼬리로 나왔으므로 여기서는 마감 시각을 짝짓는다(중복 방지). */}
        {railState === 'closed' ? <Fact label='마감' value={banner.deadlineAt} /> : <Fact label='개찰' value={banner.openedAt} />}
        <Fact label='공고' value={banner.announcedAt} />
      </div>
    </div>
  );
}
