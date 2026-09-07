/** @module 책임: 기관 제목과 기관 사실 네 조각(소재지·하한율·누적 회차·발주 주기), 화면 전체 조건(품목·기간·모집단) 칩을
 * 표시하고, 좁은 폭에서 어느 조각도 문서를 가로로 밀지 않도록 조각 단위 줄바꿈·품목 축약을 소유한다. 조건 변경은 후속
 * 슬라이스의 client 칩이 맡는다. */
import type { DecisionSearch } from '../_lib/decision-search-params';
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

export function DecisionHeader({ decision, cadence, search }: {
  readonly decision: DecisionPresentation;
  readonly cadence: OrgCadencePresentation;
  readonly search: DecisionSearch;
}) {
  const item = summarizeItemLabel(decision.itemLabelText);
  return (
    // 칩을 감싸는 별도 컨테이너를 두지 않는다. flex-wrap은 직계 자식 단위로만 줄을 바꾸므로 칩 셋을 한 div에
    // 묶으면 그 묶음이 통째로 남아 좁은 폭에서 문서가 가로로 밀린다(EAT-82). 시안(768 바텀 시트)도 품목 칩이
    // 첫 줄 오른쪽에 붙고 기간·모집단이 다음 줄로 내려가는 배치다. 사실 네 조각도 같은 이유로 한 span에
    // 잇지 않고 조각마다 직계 자식으로 둔다 — 소재지·회차·주기를 한 nowrap에 이으면 768에서 그 줄 하나가
    // 근거 열보다 길어진다.
    <div className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2'>
      {/* 제목은 nowrap 대상이 아니다: 전역적으로 글자 잘림을 두지 않으므로 truncate 대신 줄바꿈을 허용한다.
          break-keep은 어절 안에서 끊지 않지만, 띄어쓰기 없는 긴 기관명은 어절 하나가 열보다 길 수 있어
          wrap-anywhere로 그때만 어절 안 줄바꿈을 허용한다. */}
      <h1 id='decision-title' className='min-w-0 break-keep wrap-anywhere text-xl font-bold tracking-tight'>{decision.identity.title}</h1>
      <Fact>{`소재지 ${decision.locationText}`}</Fact>
      <Fact>{`하한율 ${decision.floorRateText}`}</Fact>
      <Fact>{cadence.attemptCountText}</Fact>
      {cadence.cadenceText ? <Fact tail={cadence.cadenceBasisText}>{cadence.cadenceText}</Fact> : null}
      <Chip tail='공고 기준' className='ml-auto' title={item.full ?? undefined}>{item.text}</Chip>
      {/* 기간·모집단은 후속 슬라이스에서 드롭다운이 되므로 드롭다운 표시를 tail로 미리 붙인다. */}
      <Chip tail='▾'>{search.period}</Chip>
      <Chip tail='▾'>{search.scope}</Chip>
    </div>
  );
}
