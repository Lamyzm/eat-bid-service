/** @module 책임: 업무 홈·탐색·설정의 서로 다른 본문 폭을 공통 표와 폼으로 비교하며 예시 상태만 메모리에 보관한다. */
import { useState } from "react";
import {
  IconArrowRight,
  IconSearch,
  IconClock,
  IconStar,
  IconChecklist,
} from "@tabler/icons-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/shared/ui/table";
import { Button, Choice, Input } from "./controls";
import { notices, type Scene } from "./review-data";

function NoticeTable({ rows, open }: { rows: typeof notices; open: () => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>공고 / 기관</TableHead>
          <TableHead>지역 · 품목</TableHead>
          <TableHead>마감</TableHead>
          <TableHead className="numeric">기초금액</TableHead>
          <TableHead>내 검토</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((notice) => (
          <TableRow key={notice.id}>
            <TableCell>
              {notice.id === 1 ? (
                <Button variant="link" onClick={open} className="notice-link">
                  {notice.organization}
                </Button>
              ) : (
                <strong>{notice.organization}</strong>
              )}
              <p className="muted">9월 급식 식재료 구매</p>
            </TableCell>
            <TableCell>
              {notice.region} · {notice.item}
            </TableCell>
            <TableCell className={notice.deadline.startsWith("오늘") ? "deadline" : ""}>
              {notice.deadline}
            </TableCell>
            <TableCell className="numeric">{notice.amount}원</TableCell>
            <TableCell>
              <span className={`status ${notice.status === "변경 확인" ? "attention" : ""}`}>
                {notice.status}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function WorkSurface({ scene, go }: { scene: Scene; go: (scene: Scene) => void }) {
  const [region, setRegion] = useState("전국");
  const [item, setItem] = useState("전체 품목");
  const [query, setQuery] = useState("");
  const filtered = notices.filter(
    (notice) =>
      (region === "전국" || notice.region === region) &&
      (item === "전체 품목" || notice.item === item) &&
      notice.organization.includes(query),
  );
  const isHome = scene === "home";
  const title = isHome
    ? "오늘, 확인할 일이 있어요"
    : scene === "explore"
      ? "공고 탐색"
      : scene === "work"
        ? "내 투찰"
        : "결과 확인";
  return (
    <article className="work-page">
      <header className="page-heading">
        <div>
          <div className="eyebrow">2026년 9월 8일 화요일</div>
          <h1>{title}</h1>
          <p>
            {isHome
              ? "다가오는 마감과 검토 중인 공고를 함께 확인하세요."
              : "관심 있는 공고를 찾고 이어서 검토하세요."}
          </p>
        </div>
        {isHome && (
          <Button variant="outline" onClick={() => go("explore")}>
            다른 지역 탐색
            <IconArrowRight />
          </Button>
        )}
      </header>
      {isHome && (
        <>
          <div className="overview-grid">
            <Button variant="ghost" className="overview" onClick={() => go("work")}>
              <IconClock />
              <span>
                오늘 마감
                <strong>
                  2<small>개 공고</small>
                </strong>
              </span>
              <IconArrowRight />
            </Button>
            <Button variant="ghost" className="overview" onClick={() => go("work")}>
              <IconChecklist />
              <span>
                검토 중
                <strong>
                  1<small>개 공고</small>
                </strong>
              </span>
              <IconArrowRight />
            </Button>
            <Button variant="ghost" className="overview" onClick={() => go("explore")}>
              <IconStar />
              <span>
                관심 기관 새 공고
                <strong>
                  1<small>개 공고</small>
                </strong>
              </span>
              <IconArrowRight />
            </Button>
          </div>
          <div className="notice-alert">
            <span className="status attention">변경 확인</span>
            <div>
              <strong>다솜학교 공동구매 공고가 변경됐어요</strong>
              <p>검토를 이어가기 전에 공고 내용을 확인하세요.</p>
            </div>
            <Button variant="outline" onClick={() => go("explore")}>
              공고 목록 열기
            </Button>
          </div>
        </>
      )}
      <section className="work-list">
        <div className="section-heading">
          <h2>
            {isHome ? "마감 전 확인할 공고" : "공고 목록"} <small>{filtered.length}개</small>
          </h2>
          <span className="muted">마감 임박순</span>
        </div>
        <div className="list-filters">
          <Choice
            label="탐색 지역"
            value={region}
            values={["전국", "경남", "부산", "서울", "경북"]}
            onChange={setRegion}
          />
          <Choice
            label="탐색 품목"
            value={item}
            values={["전체 품목", "축산물", "공산품"]}
            onChange={setItem}
          />
          <div className="search-field">
            <IconSearch />
            <Input
              aria-label="기관 검색"
              placeholder="기관 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <NoticeTable rows={filtered} open={() => go("analysis")} />
        {filtered.length === 0 && (
          <p className="empty-state">선택한 조건에 해당하는 예시 공고가 없어요.</p>
        )}
      </section>
      {isHome && (
        <section className="continue-section">
          <h2>검토 이어가기</h2>
          <Button variant="ghost" className="continue-card" onClick={() => go("analysis")}>
            <div>
              <span className="eyebrow">가람고등학교 · 축산물</span>
              <strong>과거 회차를 보던 곳부터</strong>
              <p>낙찰률 추이 · 12개월</p>
            </div>
            <IconArrowRight />
          </Button>
        </section>
      )}
      <footer>
        eatbid <span>이용약관 · 개인정보 처리방침 · 고객센터</span>
      </footer>
    </article>
  );
}

export function Settings() {
  const [section, setSection] = useState("사업자 정보");
  const [name, setName] = useState("가람푸드");
  const [saved, setSaved] = useState(false);
  const [notification, setNotification] = useState("앱에서 받기");
  return (
    <article className="settings-page">
      <header className="page-heading">
        <div>
          <h1>설정</h1>
          <p>사업자와 내 계정의 기본 정보를 관리해요.</p>
        </div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="설정 메뉴">
          {["사업자 정보", "내 계정", "알림"].map((label) => (
            <Button
              key={label}
              variant={section === label ? "secondary" : "ghost"}
              onClick={() => {
                setSection(label);
                setSaved(false);
              }}
            >
              {label}
            </Button>
          ))}
        </nav>
        <section className="settings-form">
          <h2>{section}</h2>
          {section === "사업자 정보" ? (
            <>
              <p>현재 사업자에 적용되는 기본 정보예요.</p>
              <label htmlFor="company-name">사업자 표시 이름</label>
              <Input
                id="company-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
              />
              <div className="form-label">사업자등록번호</div>
              <div className="readonly-field">
                123-45-67890 <span>예시 사업자</span>
              </div>
              <div className="form-label">사업자 기준 지역</div>
              <div className="readonly-field">
                경남 <span>등록 정보</span>
              </div>
            </>
          ) : section === "내 계정" ? (
            <>
              <p>이 업무 공간에서 사용하는 내 정보예요.</p>
              <label htmlFor="user-name">이름</label>
              <Input id="user-name" defaultValue="김담당" />
              <div className="form-label">소속 사업자</div>
              <div className="readonly-field">가람푸드</div>
            </>
          ) : (
            <>
              <p>업무 중 확인할 알림을 선택해요.</p>
              <div className="form-label">공고 변경 · 마감 알림</div>
              <Choice
                label="알림 방식"
                value={notification}
                values={["앱에서 받기", "받지 않기"]}
                onChange={setNotification}
              />
            </>
          )}
          <div className="form-actions">
            <span role="status">
              {saved ? "시안에서 변경했어요. 실제 계정에는 저장되지 않아요." : ""}
            </span>
            <Button onClick={() => setSaved(true)}>변경 저장</Button>
          </div>
        </section>
      </div>
      <footer>
        eatbid <span>이용약관 · 개인정보 처리방침 · 고객센터</span>
      </footer>
    </article>
  );
}
