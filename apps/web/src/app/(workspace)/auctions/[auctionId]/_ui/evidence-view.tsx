/** @module 책임: 근거 카드가 서버에서 함께 받아 둔 흐름·분포 본문 중 무엇을 보일지 브라우저에서 정하고 그 선택을 주소의 view로 남긴다. */
'use client';

import { useQueryStates } from 'nuqs';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import {
  decisionSearchParsers,
  withDecisionView,
  type DecisionRoute,
  type DecisionView
} from '../_lib/decision-search-params';

type EvidenceViewStore = {
  readonly active: DecisionView;
  readonly show: (view: DecisionView) => void;
};

// 기본값을 둔 context 대신 null을 둬서 provider 밖 사용을 조용한 오작동이 아니라 즉시 오류로 만든다.
const Context = createContext<EvidenceViewStore | null>(null);

function useEvidenceView(): EvidenceViewStore {
  const store = useContext(Context);
  if (!store) throw new Error('근거 보기는 EvidenceViews 안에서만 쓸 수 있습니다');
  return store;
}

/**
 * 어떤 전환이 서버를 다시 부르는지의 경계다. **질의가 달라지면 서버 왕복, 이미 받은 것 중 무엇을 보일지만
 * 달라지면 브라우저 전환이다.** 기간·모집단·품목·`pages`·`historyRead`는 회차 이력과 분포를 다시 읽으므로
 * 링크 그대로 두고, 흐름↔분포는 서버가 두 본문을 이미 함께 렌더해 두었으므로 주소만 shallow로 고친다.
 *
 * 예외는 확대가 열린 상태다. 그때 탭을 옮기면 키우던 본문이 더 이상 보이지 않으므로 확대를 함께 닫고,
 * 분포 모달은 같은 분포를 달별로 다시 부르는 조회라 그 전환만은 서버 왕복으로 되돌린다.
 */
export function EvidenceViews({
  initialView,
  expanded,
  children
}: {
  /** 서버가 이 요청에서 읽은 `view`. 주소에 값이 없을 때의 기본값이라 두 진실이 생기지 않는다. */
  readonly initialView: DecisionView;
  readonly expanded: boolean;
  readonly children: ReactNode;
}) {
  const parsers = useMemo(
    () => ({ view: decisionSearchParsers.view.withDefault(initialView), expand: decisionSearchParsers.expand }),
    [initialView]
  );
  const [query, setQuery] = useQueryStates(parsers);
  const active = query.view;
  const store = useMemo<EvidenceViewStore>(
    () => ({
      active,
      show: (view) => {
        // push라야 뒤로 가기가 이전 탭으로 돌아간다. shallow 전환은 history만 고치고 RSC를 다시 받지 않는다.
        void setQuery(expanded ? { view, expand: null } : { view }, { shallow: !expanded, history: 'push', scroll: false });
      }
    }),
    [active, expanded, setQuery]
  );
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export type EvidenceTab = {
  readonly view: DecisionView;
  readonly label: string;
  /** 주소 공유·새 탭 열기가 지금처럼 되도록 진짜 href를 유지한다. 평범한 왼쪽 클릭만 가로챈다. */
  readonly href: DecisionRoute;
};

export function EvidenceViewTabs({ tabs }: { readonly tabs: readonly EvidenceTab[] }) {
  const { active, show } = useEvidenceView();
  return (
    <nav aria-label='근거 보기' className='flex flex-wrap items-center gap-1'>
      {tabs.map((tab) => (
        <a
          key={tab.view}
          href={tab.href}
          aria-current={tab.view === active ? 'page' : undefined}
          onClick={(event) => {
            // 새 탭·새 창으로 여는 클릭은 브라우저에 맡긴다.
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            show(tab.view);
          }}
          className={`inline-flex h-9 items-center rounded-md px-3 text-[15px] whitespace-nowrap ${
            tab.view === active ? 'bg-primary/10 font-semibold text-primary' : 'font-medium text-muted-foreground'
          }`}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * 한 본문에서만 뜻이 있는 조각의 자리다. 범례는 흐름 계열 토글이고 분포 범위 조건은 분포에만 쓰인다.
 * `hidden` 자리를 남기지 않고 통째로 빼는 이유는 이 조각들이 도구 줄·조건 줄의 flex 항목이라 빈 wrapper가
 * 한 칸과 gap을 차지하기 때문이다. 본문 두 벌과 달리 이 조각들은 다시 그리는 데 새 조회가 필요 없다.
 */
export function EvidenceViewOnly({
  view,
  children
}: {
  readonly view: DecisionView;
  readonly children: ReactNode;
}) {
  return useEvidenceView().active === view ? children : null;
}

/**
 * 서버가 그린 주소의 `view`를 지금 보고 있는 본문으로 고쳐 준다. 그대로 두면 조건·확대·내 값 링크가 서버가
 * 아는 한 걸음 전의 본문으로 사용자를 되돌린다. provider 밖(독립 미리보기·검사)에는 고칠 값이 없으므로
 * 서버가 그린 주소를 그대로 쓴다.
 */
export function useDecisionRoute(): (route: DecisionRoute) => DecisionRoute {
  const active = useContext(Context)?.active;
  return useCallback(
    (route: DecisionRoute) => (active === undefined ? route : withDecisionView(route, active)),
    [active]
  );
}

/**
 * 한 본문의 자리다. 꺼진 본문은 `hidden`으로 접근성 트리에서도 빠지므로 화면 읽기 프로그램이 두 벌을 읽지
 * 않는다. DOM에서 지우지 않는 이유는 그래야 전환에 새 조회가 필요 없기 때문이다.
 */
export function EvidenceViewPanel({
  view,
  className,
  children
}: {
  readonly view: DecisionView;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const shown = useEvidenceView().active === view;
  // 꺼진 자리에는 배치 utility를 걸지 않는다. `display` utility는 `[hidden]`보다 뒤에 오는 layer라 함께 두면
  // 숨김이 지고 두 본문이 겹쳐 보인다.
  return (
    <div data-slot='evidence-panel' data-view={view} hidden={!shown} className={shown ? className : undefined}>
      {children}
    </div>
  );
}
