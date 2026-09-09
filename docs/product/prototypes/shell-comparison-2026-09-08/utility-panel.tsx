/** @module 책임: 관심·최근 본·내 공고와 공고 정보·선택 회차 기록을 하나의 오른쪽 공간에서 전환한다. */
import { IconStar, IconHistory, IconChecklist, IconX } from "@tabler/icons-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "./controls";
import { history, notices, type Panel } from "./review-data";
export const panelLabels = {
  saved: "관심",
  recent: "최근 본",
  mine: "내 공고",
  record: "선택 회차 기록",
  notice: "현재 공고 정보",
};
export function UtilityRail({
  current,
  change,
}: {
  current: Panel;
  change: (panel: Panel) => void;
}) {
  return (
    <nav className="utility-rail" aria-label="바로가기">
      {(
        [
          { id: "saved", label: "관심", icon: IconStar },
          { id: "recent", label: "최근 본", icon: IconHistory },
          { id: "mine", label: "내 공고", icon: IconChecklist },
        ] as const
      ).map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          variant={current === id ? "secondary" : "ghost"}
          aria-label={label}
          aria-expanded={current === id}
          className="utility-button"
          onClick={() => change(current === id ? null : id)}
        >
          <Icon />
          <span>{label}</span>
        </Button>
      ))}
    </nav>
  );
}
function PanelContent({
  panel,
  selected,
  openAnalysis,
}: {
  panel: Panel;
  selected: string;
  openAnalysis: () => void;
}) {
  if (panel === "notice")
    return (
      <div className="panel-content">
        <span className="status">진행 중</span>
        <h3>가람고등학교</h3>
        <p>9월 급식 식재료 구매 · 축산물</p>
        <dl>
          <dt>마감</dt>
          <dd>2026.09.08 14:00</dd>
          <dt>기초금액</dt>
          <dd>32,460,000원</dd>
          <dt>하한율</dt>
          <dd>88.000%</dd>
          <dt>공고 지역</dt>
          <dd>경남</dd>
        </dl>
      </div>
    );
  if (panel === "record") {
    const row = history.find((item) => item.attemptId === selected) ?? history.at(-1)!;
    return (
      <div className="panel-content">
        <div className="eyebrow">
          과거 회차 · {row.openedYear}.{row.openedText.slice(3).replace("-", ".")}
        </div>
        <h3>가람고등학교 · 축산물</h3>
        <dl>
          <dt>낙찰률</dt>
          <dd className="rate">{row.winRateText}%</dd>
          <dt>2등값</dt>
          <dd>{row.secondRateText}%</dd>
          <dt>참여 업체</dt>
          <dd>{row.listCount}개</dd>
        </dl>
        <h3 className="roster-title">참여 기록</h3>
        <p className="muted">상위 3개 예시</p>
        {[row.winRateText, row.secondRateText, "88.345"].map((value, index) => (
          <div className="roster-row" key={index}>
            <span>{index + 1}</span>
            <strong>예시 업체 {index + 1}</strong>
            <span>{value}%</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="panel-content">
      <p className="muted">
        {panel === "saved"
          ? "관심 기관"
          : panel === "recent"
            ? "최근 확인한 공고"
            : "검토 중인 공고"}
      </p>
      {notices.slice(0, panel === "mine" ? 1 : 3).map((notice) => (
        <Button
          variant="ghost"
          className="saved-item"
          key={notice.id}
          disabled={notice.id !== 1}
          onClick={openAnalysis}
        >
          <span className="saved-avatar">{notice.organization.slice(0, 1)}</span>
          <span>
            <strong>{notice.organization}</strong>
            <small>
              {notice.item} · {notice.deadline}
            </small>
          </span>
        </Button>
      ))}
    </div>
  );
}
export function UtilityPanel({
  panel,
  selected,
  close,
  openAnalysis,
  narrow,
}: {
  panel: Panel;
  selected: string;
  close: () => void;
  openAnalysis: () => void;
  narrow: boolean;
}) {
  if (narrow)
    return (
      <Sheet
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <SheetContent className="review-sheet" side="right">
          <SheetHeader>
            <SheetTitle>{panel ? panelLabels[panel] : "바로가기"}</SheetTitle>
            <SheetDescription className="sr-only">
              목록과 선택한 공고의 정보를 확인합니다.
            </SheetDescription>
          </SheetHeader>
          <PanelContent panel={panel} selected={selected} openAnalysis={openAnalysis} />
        </SheetContent>
      </Sheet>
    );
  return (
    <aside
      className="utility-panel"
      hidden={panel === null}
      aria-label={panel ? panelLabels[panel] : undefined}
    >
      <header>
        <h2>{panel ? panelLabels[panel] : ""}</h2>
        <Button variant="ghost" size="icon" aria-label="패널 닫기" onClick={close}>
          <IconX />
        </Button>
      </header>
      {(["saved", "recent", "mine", "record", "notice"] as const).map((id) => (
        <div className="panel-scroll" key={id} hidden={id !== panel}>
          <PanelContent panel={id} selected={selected} openAnalysis={openAnalysis} />
        </div>
      ))}
    </aside>
  );
}
