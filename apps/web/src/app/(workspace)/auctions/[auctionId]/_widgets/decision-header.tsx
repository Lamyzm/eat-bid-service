/** @module 책임: 검토 중인 공고 하나를 상태·제목·마감·기초금액·하한율과 오른쪽 상세 진입까지 한 문맥으로 보인다. 기관 이력 수치와 원본 추적 정보는 여기서 다시 강조하지 않는다. */
import { summarizeItemLabel } from '@/entities/item/item-label';

import type { DecisionPresentation } from '../_lib/present-decision';
import { CurrentAuctionInfoButton } from './decision-tools';

// children을 별도 span으로 감싸 tail(꼬리 라벨·드롭다운 표시)이 붙어도 값 텍스트가 단독 노드로 남게 한다.
function Chip({ children, tail, className = '', title }: {
  readonly children: React.ReactNode;
  readonly tail?: string;
  readonly className?: string;
  readonly title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold whitespace-nowrap text-foreground ${className}`}
    >
      <span>{children}</span>
      {tail ? <span className='text-[13px] font-semibold text-muted-foreground'>{tail}</span> : null}
    </span>
  );
}

// 사실 조각 하나다. 정보 값이므로 본문 15px를 쓰고 13px는 시각·표본 수 같은 보조 꼬리 전용이다.
function Fact({ children, tail }: { readonly children: string; readonly tail?: string | null }) {
  return (
    <span className='text-[15px] font-semibold whitespace-nowrap text-muted-foreground'>
      {children}
      {tail ? <span className='ml-1 text-[13px] font-semibold text-muted-foreground/70'>{tail}</span> : null}
    </span>
  );
}

// 상태는 색만으로 말하지 않는다. 세 값은 `rail-state.ts`가 일정 관측에서 정한 것이라 화면이 다시 세지 않는다.
const STATUS_TEXT = { open: '진행 중', closed: '개찰 완료', unknown: '마감 미확인' } as const;

/** `present-decision.ts`가 관측 없는 지역에 싣는 값이다. 요약 줄에서 뺄지 판단할 때만 쓰고 다른 뜻을 되살리지 않는다. */
const UNOBSERVED_TEXT = '미확인';

/**
 * 마감 조각은 상태마다 다른 사실을 짝짓는다: open은 남은 시간과 마감 시각, closed는 개찰 후 지난 시간과
 * 개찰 시각, unknown은 값 자체가 이미 "미확인"이라 꼬리를 두지 않는다(미확인 중복 금지).
 */
function deadlineFact(decision: DecisionPresentation): { readonly text: string; readonly tail: string | null } {
  const { banner, railState } = decision;
  if (railState === 'closed') return { text: `개찰 후 ${banner.remaining}`, tail: banner.openedAt };
  if (railState === 'unknown') return { text: '마감 미확인', tail: null };
  return { text: `마감까지 ${banner.remaining}`, tail: banner.deadlineAt };
}

export function DecisionHeader({ decision }: { readonly decision: DecisionPresentation }) {
  const item = summarizeItemLabel(decision.itemLabelText);
  const deadline = deadlineFact(decision);
  return (
    <div className='grid min-w-0 gap-2'>
      <div data-slot='decision-context-label' className='flex flex-wrap items-center gap-2'>
        <span className='text-[13px] font-semibold whitespace-nowrap text-muted-foreground'>검토 중인 공고</span>
        <span
          data-slot='decision-status'
          className='inline-flex h-6 items-center rounded-md bg-primary/10 px-2 text-[13px] font-semibold whitespace-nowrap text-primary'
        >
          {STATUS_TEXT[decision.railState]}
        </span>
      </div>
      {/* 제목은 nowrap 대상이 아니다: 전역적으로 글자 잘림을 두지 않으므로 truncate 대신 줄바꿈을 허용한다.
          break-keep은 어절 안에서 끊지 않지만, 띄어쓰기 없는 긴 기관명은 어절 하나가 열보다 길 수 있어
          wrap-anywhere로 그때만 어절 안 줄바꿈을 허용한다. */}
      <h1 id='decision-title' title={decision.identity.title} className='min-w-0 break-keep wrap-anywhere text-xl font-bold tracking-tight'>{decision.identity.title}</h1>
      {/* 사실은 각 조각 단위로 줄바꿈하고, 제목은 자체 행을 사용해 긴 공고명과 경쟁하지 않는다.
          나머지 수치(공고일·참여·납품·기관 발주 주기)는 오른쪽 현재 공고 정보 패널이 소유한다(EAT-115). */}
      <div data-slot='decision-summary' className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1'>
        {/* eaT 공고지역이지 기관 사업장 주소가 아니다. 라벨을 "소재지"로 부르면 없는 사실을 말한 것이 되고,
            제목·기관명에서 주소를 추정하지 않는다는 결정과도 어긋난다(AGENTS 2·6). 관측이 없으면 조각 자체를
            그리지 않는다 — 요약 줄의 "미확인"은 진입 버튼과 경쟁하는 잡음이고, 상세는 오른쪽 패널이 말한다. */}
        {decision.locationText === UNOBSERVED_TEXT ? null : <Fact>{`공고 지역 ${decision.locationText}`}</Fact>}
        <Fact tail={deadline.tail}>{deadline.text}</Fact>
        <Fact>{`기초 ${decision.baseAmount.text}원`}</Fact>
        <Fact>{`하한율 ${decision.floorRateText}`}</Fact>
        <Chip tail='공고 기준' className='ml-auto' title={item.full ?? undefined}>{item.text}</Chip>
        <CurrentAuctionInfoButton />
      </div>
    </div>
  );
}
