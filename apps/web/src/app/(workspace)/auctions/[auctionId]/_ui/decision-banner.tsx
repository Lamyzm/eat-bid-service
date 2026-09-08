/** @module 책임: 공고가 열렸는지·언제 닫히는지·몇 곳이 참여했는지를 사실 짝 한 줄로 보이고, 정정·지난 공고 같은
 * 공고 배지 줄을 오른쪽에 둔다. 절대 위치 없이 플렉스 두 줄이다. 내 기록은 이 슬라이스의 진실 원천이 아니다
 * (rail 하나가 소유한다). */
import type { OrgCadencePresentation } from '../_model/org-cadence';
import type { DecisionPresentation } from '../_model/present-decision';

type DecisionBannerProps = {
  readonly decision: DecisionPresentation;
  readonly cadence: OrgCadencePresentation;
};

const SENTENCE = {
  open: '이 공고가 열려 있습니다',
  closed: '개찰이 끝났습니다',
  unknown: '마감 시각이 아직 관측되지 않았습니다'
} as const;

function Fact({ label, value, tail }: { readonly label: string; readonly value: string; readonly tail?: string | null }) {
  return (
    <div className='flex items-baseline gap-2 whitespace-nowrap'>
      <span className='text-[13px] font-semibold text-muted-foreground/70'>{label}</span>
      <span className='text-sm font-semibold tabular-nums text-foreground'>{value}</span>
      {tail ? <span className='text-[13px] font-semibold text-muted-foreground'>{tail}</span> : null}
    </div>
  );
}

export function DecisionBanner({ decision, cadence }: DecisionBannerProps) {
  const { banner, participation, railState } = decision;
  // 첫 Fact 라벨·꼬리는 상태별로 다른 사실을 짝짓는다: open은 남은 시간·마감 시각, closed는 개찰 후
  // 지난 시간·개찰 시각, unknown은 값 자체가 이미 "미확인"이라 꼬리를 두지 않는다(미확인 중복 금지).
  const firstLabel = railState === 'closed' ? '개찰 후' : railState === 'unknown' ? '마감' : '마감까지';
  const firstTail = railState === 'closed' ? banner.openedAt : railState === 'unknown' ? undefined : banner.deadlineAt;
  // 참여 꼬리는 하루 전 관측이 있으면 증감, 없으면 관측 시각이다. 관측 시각 없는 참여 수는 추정으로 읽히므로
  // 둘 다 없을 때(참여 미확인)만 꼬리를 비운다.
  const participationTail = participation.deltaText ?? (participation.observedAtText ? `${participation.observedAtText} 관측` : null);
  // 정정 횟수는 아직 소스 필드가 정규화되지 않아 관측할 수 없다. 배지 자리를 비우면 "정정 없음"으로 읽히므로
  // 미확인이라고 적는다(AGENTS 3). 지난 공고는 회차 이력에서 오며 앞선 회차가 없으면 조각을 그리지 않는다.
  const badges = ['정정 미확인', cadence.lastAnnouncementText].filter((text): text is string => text !== null);
  return (
    <div className='relative flex flex-col gap-2 overflow-hidden rounded-lg bg-card px-4 py-2 shadow-xs'>
      <div className='absolute inset-y-0 left-0 w-1 bg-primary' aria-hidden />
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-[15px] font-semibold whitespace-nowrap text-primary'>{SENTENCE[railState]}</span>
        <span className='inline-flex h-7 items-center gap-1.5 rounded-lg bg-foreground/5 px-2 text-sm font-semibold whitespace-nowrap'>
          기초 {decision.baseAmount.text}원
        </span>
        {/* 배지 줄도 조각마다 직계 자식이다. 한 nowrap에 이으면 768에서 문장·기초금액 칩과 한 줄을 다투다 문서를 민다. */}
        {badges.map((text, index) => (
          <span key={text} className={`text-[13px] font-semibold whitespace-nowrap text-muted-foreground ${index === 0 ? 'ml-auto' : ''}`}>
            {text}
          </span>
        ))}
      </div>
      <div className='flex flex-wrap gap-x-5 gap-y-1'>
        <Fact label={firstLabel} value={banner.remaining} tail={firstTail} />
        {/* closed일 때 개찰 시각은 이미 첫 Fact의 꼬리로 나왔으므로 여기서는 마감 시각을 짝짓는다(중복 방지). */}
        {railState === 'closed' ? <Fact label='마감' value={banner.deadlineAt} /> : <Fact label='개찰' value={banner.openedAt} />}
        <Fact label='공고' value={banner.announcedAt} />
        <Fact label='참여' value={participation.countText} tail={participationTail} />
        {/* 납품 기간은 소스 DLVRY_STRT_DT·DLVRY_END_DT가 아직 정규화·계약에 없다. 지어내지 않고 미확인이라 적는다. */}
        <Fact label='납품' value='미확인' />
      </div>
    </div>
  );
}
