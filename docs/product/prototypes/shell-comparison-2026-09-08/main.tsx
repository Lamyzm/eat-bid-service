/** @module 책임: 동일한 업무 본문을 유지하며 전역 탐색 두 배치와 오른쪽 보조 공간을 전환하는 독립 검토 셸을 제공한다. */
import { useEffect, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  IconHome,
  IconSearch,
  IconChecklist,
  IconChartBar,
  IconSettings,
  IconArrowLeft,
} from "@tabler/icons-react";
import { Button, Choice } from "./controls";
import { Analysis } from "./analysis";
import { Settings, WorkSurface } from "./work-surfaces";
import { UtilityPanel, UtilityRail } from "./utility-panel";
import { type Scene, type Panel, sceneLabels } from "./review-data";

const menu = [
  { id: "home", label: "홈", icon: IconHome },
  { id: "explore", label: "탐색", icon: IconSearch },
  { id: "work", label: "내 투찰", icon: IconChecklist },
  { id: "results", label: "결과", icon: IconChartBar },
] as const;
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1199px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1199px)");
    const listener = () => setNarrow(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  return narrow;
}
function Navigation({ scene, go }: { scene: Scene; go: (scene: Scene) => void }) {
  const { setOpenMobile } = useSidebar();
  const navigate = (next: Scene) => {
    go(next);
    setOpenMobile(false);
  };
  return (
    <Sidebar collapsible="icon" className="review-sidebar">
      <SidebarHeader>
        <span className="sidebar-brand">
          eatbid<span>WORKSPACE</span>
        </span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {menu.map(({ id, label, icon: Icon }) => (
            <SidebarMenuItem key={id}>
              <SidebarMenuButton
                isActive={scene === id || (id === "work" && scene === "analysis")}
                tooltip={label}
                onClick={() => navigate(id)}
              >
                <Icon />
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={scene === "settings"}
              tooltip="설정"
              onClick={() => navigate("settings")}
            >
              <IconSettings />
              <span>설정</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
function App() {
  const [layout, setLayout] = useState<"side" | "top">("side");
  const [scene, setScene] = useState<Scene>("home");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [focus, setFocus] = useState(false);
  const [selected, setSelected] = useState("111");
  const [company, setCompany] = useState("가람푸드");
  const [theme, setTheme] = useState("Toss 기반");
  const narrow = useNarrow();
  const go = (next: Scene) => {
    setScene(next);
    setPanel(null);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    document.documentElement.dataset.theme = theme === "Toss 기반" ? "toss" : "eatbid";
  }, [theme]);
  useEffect(() => {
    document.title = `eatbid 레이아웃 비교 · ${sceneLabels[scene]}`;
  }, [scene]);
  return (
    <div className={`review layout-${layout} ${scene === "analysis" && focus ? "is-focused" : ""}`}>
      <div className="review-toolbar">
        <strong>
          레이아웃 비교 <span>· 예시 데이터</span>
        </strong>
        <div className="layout-options">
          <Button
            size="sm"
            variant={layout === "side" ? "secondary" : "ghost"}
            aria-pressed={layout === "side"}
            onClick={() => setLayout("side")}
          >
            A 왼쪽 메뉴
          </Button>
          <Button
            size="sm"
            variant={layout === "top" ? "secondary" : "ghost"}
            aria-pressed={layout === "top"}
            onClick={() => setLayout("top")}
          >
            B 상단 메뉴
          </Button>
        </div>
        <div className="review-scenarios">
          {(["home", "settings", "analysis"] as const).map((id) => (
            <Button
              key={id}
              size="sm"
              variant={scene === id ? "secondary" : "ghost"}
              onClick={() => go(id)}
            >
              {sceneLabels[id]} 시안
            </Button>
          ))}
        </div>
      </div>
      <header className="review-header">
        <div className="header-brand">eatbid</div>
        <div className="business-context">
          <span className="workspace-label">우리 업무 공간</span>
          <Choice
            label="사업자 전환"
            value={company}
            values={["가람푸드", "가람유통"]}
            onChange={setCompany}
          />
        </div>
        <nav className="top-navigation" aria-label="주 메뉴">
          {menu.map(({ id, label }) => (
            <Button
              key={id}
              variant={
                scene === id || (scene === "analysis" && id === "work") ? "secondary" : "ghost"
              }
              onClick={() => go(id)}
            >
              {label}
            </Button>
          ))}
        </nav>
        <div className="header-tools">
          <Choice
            label="시안 테마"
            value={theme}
            values={["Toss 기반", "Eatbid"]}
            onChange={setTheme}
          />
          <Button variant="ghost" size="icon" aria-label="설정 열기" onClick={() => go("settings")}>
            <IconSettings />
          </Button>
          <span className="account-avatar" aria-label="김담당 계정">
            김
          </span>
        </div>
      </header>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        className="review-frame"
        style={{ "--sidebar-width": "216px", "--sidebar-width-icon": "56px" } as CSSProperties}
      >
        <Navigation scene={scene} go={go} />
        <div className="review-workspace">
          <div className="context-line">
            <SidebarTrigger aria-label="메뉴 접기 또는 펼치기" />
            <span>
              우리 업무 공간 <span className="muted">/ {sceneLabels[scene]}</span>
            </span>
            {scene === "analysis" && (
              <Button variant="ghost" size="sm" onClick={() => go("work")}>
                <IconArrowLeft />내 투찰로
              </Button>
            )}
          </div>
          <div className="workspace-columns">
            <main id="review-main" className="review-main">
              {/* 배치·패널 변경으로 본문을 다시 마운트하지 않아 차트 확대와 표 스크롤을 유지한다. */}
              <div hidden={scene !== "analysis"} className="analysis-mount">
                <Analysis
                  focus={focus}
                  setFocus={setFocus}
                  selected={selected}
                  select={(id) => {
                    setSelected(id);
                    setPanel("record");
                  }}
                  panel={setPanel}
                />
              </div>
              <div hidden={scene !== "settings"}>
                <Settings />
              </div>
              <div hidden={scene === "analysis" || scene === "settings"}>
                <WorkSurface scene={scene} go={go} />
              </div>
            </main>
            <UtilityPanel
              panel={panel}
              selected={selected}
              close={() => setPanel(null)}
              openAnalysis={() => {
                setScene("analysis");
                setPanel(null);
              }}
              narrow={narrow}
            />
            <UtilityRail current={panel} change={setPanel} />
          </div>
        </div>
      </SidebarProvider>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
