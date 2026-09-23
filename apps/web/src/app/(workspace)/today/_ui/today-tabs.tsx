/** @module 책임: 오늘 화면 머리의 날짜 축 탭 줄(진행중·오늘 열린·오늘 마감)과 그 아래 기준 시각 줄을 그린다. 0건은 감추지 않고 자리를 지키며 못 센 수는 0이 아니다. */
import Link from 'next/link';

import { buildTodayFilterRoute, type TodaySearch } from '../_lib/today-search-params';
import type { OpenSummaryPresentation, TabPresentation } from '../_model/present-open-summary';

/**
 * 수가 고르는 것은 날짜 축이다. 시간 창과 함께 보내면 계약이 400으로 답하므로 링크가 시간 창을 지운다.
 * 세 수가 서로를 지우는 것도 여기서 한 번에 정해 링크마다 무엇을 남길지 다시 고르지 않게 한다.
 */
function tabRoute(search: TodaySearch, tab: TabPresentation, today: string) {
  const cleared = { closesOn: null, announcedOn: null, closesWithinHours: null };
  if (tab.id === 'live') return buildTodayFilterRoute(search, cleared);
  if (tab.id === 'openedToday') return buildTodayFilterRoute(search, { ...cleared, announcedOn: today });
  return buildTodayFilterRoute(search, { ...cleared, closesOn: today });
}

/**
 * 수 자리의 글이다. **0과 못 센 것을 같은 모양으로 쓰지 않는다** — 0은 세었는데 없다는 말이고 못 센 것은
 * 아직 모른다는 말이라 사용자가 할 일이 다르다(AGENTS 3). 수를 못 셌어도 축 자체는 걸 수 있으므로 탭을
 * 지우지 않고 수 자리만 바꾼다.
 */
function countText(count: number | null): string {
  return count === null ? '셀 수 없음' : `${count}건`;
}

/**
 * 탭 하나다. 주소가 바뀌므로 `button`이 아니라 `a`이고, 켜진 자리는 색만이 아니라 `aria-current`로도
 * 말한다. 이름은 `오늘 마감 5건`처럼 라벨과 수를 함께 가져 링크만 읽어도 무엇을 고르는지 안다.
 */
function Tab({
  tab,
  href
}: {
  readonly tab: TabPresentation;
  readonly href: ReturnType<typeof buildTodayFilterRoute>;
}) {
  /*
    0건인 탭을 감추지 않는다. 탭 수가 날마다 달라지면 사용자가 자리를 외우지 못하고, 무엇보다 "오늘은
    없다"와 "그런 축이 없다"가 같은 화면이 된다 — 0이 보이지 않으면 화면이 깨진 것처럼 읽힌다(시안
    Q1-Tabs의 `.tab.z`). 그래서 자리를 지킨 채 누를 수 있게 남긴다.
  */
  return (
    // `relative`가 없으면 2px 밑줄의 아래 한 줄이 줄 전체의 1px 구분선에 덮여 1px로 칠해진다.
    // `getComputedStyle`은 그때도 2px이라고 답하므로 계산값만 보고는 못 잡는다(심사가 픽셀로 잡았다).
    <Link
      href={href}
      aria-current={tab.active ? 'page' : undefined}
      aria-label={`${tab.label} ${countText(tab.count)}`}
      /*
        `aria-current:`는 Tailwind에서 `[aria-current="true"]`로 컴파일된다. 탐색 링크가 쓰는 올바른 값은
        `page`이므로 그 변형으로는 규칙이 하나도 걸리지 않는다 — 밑줄도 굵기도 죽은 채로 배포될 뻔했다
        (2026-09-20 디자인 심사가 픽셀로 잡았다). 값을 명시한 변형을 쓴다.
      */
      className='relative -mb-px flex shrink-0 items-baseline gap-1.5 border-b-2 border-transparent px-3.5 pt-2.5 pb-2.5 text-sm whitespace-nowrap text-muted-foreground aria-[current=page]:border-primary aria-[current=page]:font-semibold aria-[current=page]:text-foreground'
    >
      <span>{tab.label}</span>
      {/*
        0건 탭을 흐리게 하지 않는다. 시안은 흐리게 두지만(`.tab.z`) 실측해 보니 그 농도가 대비 2.6~3.2:1로
        WCAG AA(4.5:1) 아래이고, 12px 본문이라 large-text 예외도 못 받는다(2026-09-20 디자인 심사).
        **0이라는 사실은 수 자체가 말한다** — 읽을 수 없게 만들면서까지 흐리게 할 이유가 없다.
        자리를 지키는 것이 이 처리의 목적이었고 그것은 그대로다.
      */}
      <span className={`text-xs font-medium tabular-nums ${tab.active ? 'text-primary' : 'text-muted-foreground'}`}>
        {countText(tab.count)}
      </span>
    </Link>
  );
}

/**
 * 머리의 날짜 축 줄이다. 이전에는 한 문장(`진행중 62건, 오늘 마감 5건이에요`)이 같은 수를 말했다.
 * 탭으로 바꾼 이유는 둘이다 — 사장님 지시이고, 문장에는 **0이 설 자리가 없어서** 조건에 걸리는 것이
 * 없는 날이 화면이 깨진 것처럼 보였다. 탭은 `달라진 공고 0`을 자리에 세워 없는 것과 깨진 것을 가른다.
 *
 * 이 줄이 이 화면의 숫자 hero다(screen-system §9.1). 목록 안의 날짜 묶음 머리가 같은 수를 다시 말하는
 * 자리가 있지만(`오늘 8건`) 그것은 묶음의 수이지 축의 총계가 아니다 — 축을 세는 자리는 여기 하나다.
 */
/**
 * 요약을 묻고도 못 받았을 때 탭 자리에 서는 말이다. 자리를 그냥 비우면 사용자는 **화면이 사라졌다**고
 * 읽는다 — 2026-09-20 운영에서 마감 달력이 말없이 없어졌고 사장님이 먼저 발견했다. 목록은 살아 있으므로
 * 그 사실도 함께 적어 "지금 보고 있는 것이 무엇인지"를 남긴다.
 *
 * 조건을 고치라고 하지 않는다. 사용자가 고른 조건에는 잘못이 없고 할 수 있는 일은 다시 여는 것뿐이다.
 */
export function TodaySummaryUnavailable({ asOfText }: { readonly asOfText: string | null }) {
  return (
    <div data-slot='today-summary-unavailable' className='grid min-w-0 gap-1 border-b border-border pb-2.5'>
      <p className='text-sm font-semibold text-foreground'>건수와 마감 달력을 지금은 셀 수 없어요</p>
      <p className='text-[13px] font-medium text-muted-foreground'>
        {/* 없어진 것은 숫자만이 아니다. 날짜 축을 바꾸는 수단 자체가 사라지므로 그것도 말한다. */}
        날짜로 나눠 보기도 잠시 쉬어요. 아래 공고 목록은 그대로이고, 잠시 뒤 다시 열면 돌아와요.
        {/* 시각은 한 덩어리다. 하이픈에서 끊기면 `(09-` / `24 04:36 기준)`이 된다(390px 실측). */}
        {asOfText === null ? null : <span className='whitespace-nowrap'> ({asOfText} 기준)</span>}
      </p>
    </div>
  );
}

export function TodayTabs({
  summary,
  search,
  today,
  asOfText
}: {
  readonly summary: OpenSummaryPresentation;
  readonly search: TodaySearch;
  /** KST 오늘이다. 링크가 넣을 날짜라 컴포넌트가 스스로 시계를 읽지 않는다(AGENTS 15). */
  readonly today: string;
  readonly asOfText: string | null;
}) {
  if (summary.tabs.length === 0) return null;
  return (
    <div className='grid min-w-0 gap-2'>
      {/* 좁은 폭에서 탭이 줄바꿈되면 자리가 날마다 달라진다. 가로로 흐르게 두어 순서를 지킨다. */}
      {/*
        줄을 당기지 않는다. 기준선에 붙는 것은 **글자가 아니라 밑줄 상자**다(시안 Q1-Tabs: 선 x240,
        라벨 x254로 좌우 각 14px 대칭). 라벨을 기준선에 맞추려고 줄을 당기면 구분선이 열 바깥으로
        14px 나가고, 첫 탭 여백만 지우면 밑줄이 오른쪽으로만 길어진다 — 셋 다 재 보고 시안을 따른다.

        `overflow-x-auto`를 두지 않는다. 스크롤 컨테이너가 되면 `-mb-px`로 padding box 밖에 내민 1px을
        **잘라내** 2px 밑줄이 1px로 칠해진다. 클리핑이라 `position`으로는 못 살리고, 박스는 2px이라
        `getComputedStyle`도 2px이라고 답한다(2026-09-20 디자인 심사가 픽셀로 잡았다). 탭 셋은 390px에서도
        열 우끝 안에서 끝나 넘치지 않는다.
      */}
      <nav aria-label='날짜 축' className='flex gap-0.5 border-b border-border'>
        {summary.tabs.map((tab) => (
          <Tab key={tab.id} tab={tab} href={tabRoute(search, tab, today)} />
        ))}
      </nav>
      {/*
        `/70`을 쓰지 않는다. 대비가 3.15:1로 AA 아래인데 이 줄은 "게시일이 관측되지 않은 공고가 N건"
        이라는 실제 사실을 싣는다. 0건 탭의 흐림을 같은 이유로 걷어 놓고 여기만 흐리면 한 컴포넌트가
        두 기준으로 말하게 된다(2026-09-20 디자인 심사).
      */}
      <p className='text-[13px] font-medium text-muted-foreground'>
        {asOfText === null ? null : `${asOfText} 기준`}
        {/* 게시일을 못 센 수는 `오늘 열린`이 왜 셀 수 없는지를 말한다. 0이면 적지 않는다. */}
        {summary.announcedUnobservedCount > 0
          ? `${asOfText === null ? '' : ' · '}게시일이 관측되지 않은 공고가 ${summary.announcedUnobservedCount}건 있어요`
          : null}
      </p>
    </div>
  );
}
