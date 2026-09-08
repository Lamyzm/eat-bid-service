/** @module 책임: 현재 공고 제목과 확인된 기관 사실·품목 요약을 분석 필터와 분리해 표시한다. */
import type { OrgCadencePresentation } from '../_model/org-cadence';
import type { DecisionPresentation } from '../_model/present-decision';

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

// 사실 조각 하나다. 정보 값이므로 본문 15px를 쓰고 13px는 표본 수 같은 보조 꼬리 전용이다.
function Fact({ children, tail }: { readonly children: string; readonly tail?: string | null }) {
  return (
    <span className='text-[15px] font-semibold whitespace-nowrap text-muted-foreground'>
      {children}
      {tail ? <span className='ml-1 text-[13px] font-semibold text-muted-foreground/70'>{tail}</span> : null}
    </span>
  );
}

export type ItemLabelSummary = { readonly text: string; readonly full: string | null };

/** 원천 품목 라벨은 "농산물 , 수산물 , …"처럼 쉼표로 이어진 여러 품목일 수 있다. 칩 한 개가 그 전체를 nowrap으로
 * 품으면 768폭 근거 열(약 480px)을 혼자 넘기므로 첫 품목과 나머지 개수로 접는다. 여기서 나눈 조각은 표시에만 쓰고
 * 코호트·조인 키로 되살리지 않는다(AGENTS 2·15). 품목이 하나면 라벨을 그대로 두고 full은 비운다. */
export function summarizeItemLabel(label: string): ItemLabelSummary {
  const parts = label
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length <= 1) return { text: label, full: null };
  return { text: `${parts[0]} 외 ${parts.length - 1}`, full: parts.join(', ') };
}

export function DecisionHeader({ decision, cadence }: {
  readonly decision: DecisionPresentation;
  readonly cadence: OrgCadencePresentation;
}) {
  const item = summarizeItemLabel(decision.itemLabelText);
  return (
    <div className='grid min-w-0 gap-2'>
      {/* 제목은 nowrap 대상이 아니다: 전역적으로 글자 잘림을 두지 않으므로 truncate 대신 줄바꿈을 허용한다.
          break-keep은 어절 안에서 끊지 않지만, 띄어쓰기 없는 긴 기관명은 어절 하나가 열보다 길 수 있어
          wrap-anywhere로 그때만 어절 안 줄바꿈을 허용한다. */}
      <h1 id='decision-title' title={decision.identity.title} className='min-w-0 break-keep wrap-anywhere text-xl font-bold tracking-tight'>{decision.identity.title}</h1>
      {/* 사실은 각 조각 단위로 줄바꿈하고, 제목은 자체 행을 사용해 긴 공고명과 경쟁하지 않는다. */}
    <div data-slot='decision-summary' className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1'>
      <Fact>{`소재지 ${decision.locationText}`}</Fact>
      <Fact>{`하한율 ${decision.floorRateText}`}</Fact>
      <Fact>{cadence.attemptCountText}</Fact>
      {cadence.cadenceText ? <Fact tail={cadence.cadenceBasisText}>{cadence.cadenceText}</Fact> : null}
      <Chip tail='공고 기준' className='ml-auto' title={item.full ?? undefined}>{item.text}</Chip>
    </div>
    </div>
  );
}
