import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { BASELINE_PATH, formatBaseline, grownKeys, parseBaseline } from "./web-boundaries/baseline.mjs";
import { kindOfName, kindTarget } from "./web-boundaries/folder-layout.mjs";
import { stronglyConnected } from "./web-boundaries/import-graph.mjs";
import { inspectWebBoundaries } from "./web-boundaries/inspect.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const cli = path.join(repositoryRoot, "tools", "architecture", "check-web-boundaries.mjs");
const app = "apps/web/src/app/(workspace)";

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-web-folders-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }
  return { root, sourceRoot: path.join(root, "apps", "web", "src") };
}

async function inspect(files, baseline = new Map()) {
  const subject = fixture(files);
  try {
    return await inspectWebBoundaries({ repoRoot: subject.root, sourceRoot: subject.sourceRoot, baseline });
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
}

const pairs = (report, rule) => report.findings.filter((finding) => finding.rule === rule).map((finding) => finding.path).sort();
const keys = (report, rule) => report.findings.filter((finding) => finding.rule === rule).map((finding) => finding.key).sort();

test("새 꼴의 화면은 Next 파일·로더·밑줄 종류 폴더·일 폴더 종류 폴더만 두면 폴더 꼴 위반이 없다", async () => {
  const report = await inspect({
    [`${app}/work/page.tsx`]: "import { loadWork } from './load-work';\nimport { Screen } from './_components/work-screen';\nexport default function Page() { return <Screen view={loadWork()} />; }\n",
    [`${app}/work/loading.tsx`]: "import { WorkScreenSkeleton } from './_components/work-screen-skeleton';\nexport default function Loading() { return <WorkScreenSkeleton />; }\n",
    [`${app}/work/_components/work-screen-skeleton.tsx`]: "export const WorkScreenSkeleton = () => <main />;\n",
    [`${app}/work/load-work.ts`]: "import { board } from './_pass-values/utils/board';\nexport const loadWork = () => board(1);\n",
    [`${app}/work/load-work.test.ts`]: "import { loadWork } from './load-work';\nvoid loadWork;\n",
    [`${app}/work/__fixtures__/rows.ts`]: "export const rows = [1];\n",
    [`${app}/work/_components/work-screen.tsx`]: "import { Cards } from '../_pass-values/components/cards';\nexport const Screen = ({ view }: { view: number }) => <Cards count={view} />;\n",
    [`${app}/work/_components/work-layout.css`]: ".frame { display: grid; }\n",
    [`${app}/work/_pass-values/components/cards.tsx`]: "export const Cards = ({ count }: { count: number }) => <p>{count}</p>;\n",
    [`${app}/work/_pass-values/components/cards.frame.ts`]: "export const CARD_ROWS = 3;\n",
    [`${app}/work/_pass-values/hooks/use-cards.ts`]: "import { useState } from 'react';\nexport const useCards = () => useState(0);\n",
    [`${app}/work/_pass-values/utils/board.ts`]: "export const board = (value: number) => value;\n",
    [`${app}/work/_pass-values/utils/board.test.ts`]: "import { board } from './board';\nvoid board;\n",
  });

  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.failures, []);
});

test("평평하게 둔 화면 파일과 ADR 0044 옛 꼴은 kind-folder로 갈 자리를 알려 준다", async () => {
  const report = await inspect({
    [`${app}/seats/page.tsx`]: "export default function Page() { return null; }\n",
    [`${app}/seats/seats-screen.tsx`]: "export const SeatsScreen = () => <main />;\n",
    [`${app}/seats/_widgets/seats-frame.tsx`]: "export const SeatsFrame = () => <div />;\n",
    [`${app}/seats/_lib/load-seats.ts`]: "export const loadSeats = () => 1;\n",
    [`${app}/seats/_features/grant/model/present-grant.ts`]: "export const presentGrant = () => 1;\n",
    [`${app}/seats/_features/grant/model/present-grant.test.ts`]: "import { presentGrant } from './present-grant';\nvoid presentGrant;\n",
    [`${app}/seats/_features/grant/model/use-grant.ts`]: "export const useGrant = () => 1;\n",
    [`${app}/seats/_grant/grant-form.tsx`]: "export const GrantForm = () => <form />;\n",
  });

  const targets = new Map(report.findings.filter((finding) => finding.rule === "kind-folder").map((finding) => [finding.path, finding.reason.match(/자리는 (\S+) 입니다/u)?.[1]]));
  assert.deepEqual(Object.fromEntries(targets), {
    [`${app}/seats/_features/grant/model/present-grant.test.ts`]: "app/(workspace)/seats/_grant/utils/present-grant.test.ts",
    [`${app}/seats/_features/grant/model/present-grant.ts`]: "app/(workspace)/seats/_grant/utils/present-grant.ts",
    [`${app}/seats/_features/grant/model/use-grant.ts`]: "app/(workspace)/seats/_grant/hooks/use-grant.ts",
    [`${app}/seats/_grant/grant-form.tsx`]: "app/(workspace)/seats/_grant/components/grant-form.tsx",
    [`${app}/seats/_lib/load-seats.ts`]: "app/(workspace)/seats/load-seats.ts",
    [`${app}/seats/_widgets/seats-frame.tsx`]: "app/(workspace)/seats/_components/seats-frame.tsx",
    [`${app}/seats/seats-screen.tsx`]: "app/(workspace)/seats/_components/seats-screen.tsx",
  });
});

test("entity·capability 조각도 종류 폴더 한 겹이고 capability 공개 입구 index·server만 바로 아래에 둔다", async () => {
  const report = await inspect({
    "apps/web/src/entities/figure/figure.ts": "export const figure = 1;\n",
    "apps/web/src/entities/figure/utils/figure-text.ts": "export const text = 'a';\n",
    "apps/web/src/capabilities/account/index.ts": "export const account = 1;\n",
    "apps/web/src/capabilities/account/server.ts": "export const accountServer = 1;\n",
    "apps/web/src/capabilities/account/account-hub.tsx": "export const Hub = () => <nav />;\n",
    "apps/web/src/capabilities/account/hooks/use-session.ts": "export const useSession = () => 1;\n",
  });

  assert.deepEqual(pairs(report, "kind-folder"), ["apps/web/src/capabilities/account/account-hub.tsx", "apps/web/src/entities/figure/figure.ts"]);
});

test("종류 폴더의 밑줄·겹·이름 어긋남은 kind-folder-mismatch로 막는다", async () => {
  const report = await inspect({
    [`${app}/work/page.tsx`]: "export default function Page() { return null; }\n",
    [`${app}/work/components/work-screen.tsx`]: "export const Screen = () => <main />;\n",
    [`${app}/work/_pass/_components/cards.tsx`]: "export const Cards = () => <p />;\n",
    [`${app}/work/_pass/components/deep/cards.tsx`]: "export const Deep = () => <p />;\n",
    [`${app}/work/_pass/hooks/format.ts`]: "export const format = () => '';\n",
    [`${app}/work/_hooks/work-screen.tsx`]: "export const Wrong = () => <main />;\n",
    "apps/web/src/entities/figure/components/use-figure.ts": "export const useFigure = () => 1;\n",
  });

  assert.deepEqual(pairs(report, "kind-folder-mismatch"), [
    `${app}/work/_hooks/work-screen.tsx`,
    `${app}/work/_pass/_components/cards.tsx`,
    `${app}/work/_pass/components/deep/cards.tsx`,
    `${app}/work/_pass/hooks/format.ts`,
    `${app}/work/components/work-screen.tsx`,
    "apps/web/src/entities/figure/components/use-figure.ts",
  ]);
});

test("이름이 종류를 고르고 *.model.ts는 API resource를 값으로 부를 때만 remotes다", () => {
  assert.equal(kindOfName("cards.tsx"), "components");
  assert.equal(kindOfName("layout.css"), "components");
  assert.equal(kindOfName("cards.frame.ts"), "components");
  assert.equal(kindOfName("use-cards.ts"), "hooks");
  assert.equal(kindOfName("auction-queries.ts"), "remotes");
  assert.equal(kindOfName("draft.model.ts", "import { mutate } from '@/api/auctions';\n"), "remotes");
  assert.equal(kindOfName("draft.model.ts", "import type { Auction } from '@/api/auctions';\n"), "hooks");
  assert.equal(kindOfName("present-board.ts"), "utils");
  const all = new Set([`${app}/work/_pass/use-cards.ts`, `${app}/work/_pass/use-cards.test.ts`]);
  assert.equal(kindTarget(`${app}/work/_pass/use-cards.test.ts`, all), `${app}/work/_pass/hooks/use-cards.test.ts`);
});

test("다른 화면이나 화면이 아닌 윗 route의 사사 파일을 부르면 route-private로 막는다", async () => {
  const report = await inspect({
    [`${app}/layout.tsx`]: "import { gate } from './_utils/gate';\nexport default function Layout() { return gate; }\n",
    [`${app}/_utils/gate.ts`]: "export const gate = null;\n",
    [`${app}/work/page.tsx`]: "import { gate } from '../_utils/gate';\nimport { Frame } from '../seats/_components/seats-frame';\nimport { loadSeats } from '../seats/load-seats';\nexport default function Page() { return [gate, Frame, loadSeats]; }\n",
    [`${app}/seats/page.tsx`]: "import { Frame } from './_components/seats-frame';\nexport default function Page() { return Frame; }\n",
    [`${app}/seats/load-seats.ts`]: "export const loadSeats = () => 1;\n",
    [`${app}/seats/_components/seats-frame.tsx`]: "export const Frame = () => <div />;\n",
    [`${app}/seats/[seatId]/page.tsx`]: "import { Frame } from '../_components/seats-frame';\nexport default function Page() { return Frame; }\n",
  });

  assert.deepEqual(keys(report, "route-private"), [
    `${app}/work/page.tsx -> ${app}/_utils/gate.ts`,
    `${app}/work/page.tsx -> ${app}/seats/_components/seats-frame.tsx`,
    `${app}/work/page.tsx -> ${app}/seats/load-seats.ts`,
  ]);
});

test("ADR 0023 층 방향을 거스르는 import와 entity 사이 import를 막고 app은 모든 층을 부른다", async () => {
  const report = await inspect({
    "apps/web/src/shared/lib/format.ts": "import { figure } from '@/entities/figure/utils/figure';\nexport const format = figure;\n",
    "apps/web/src/entities/figure/utils/figure.ts": "import { getAuction } from '@/api/auctions';\nimport { other } from '@/entities/other/utils/other';\nexport const figure = [getAuction, other];\n",
    "apps/web/src/entities/other/utils/other.ts": "export const other = 1;\n",
    "apps/web/src/capabilities/account/index.ts": "import { Header } from '@/shell/header';\nexport const account = Header;\n",
    "apps/web/src/shell/header.tsx": "export const Header = () => <header />;\n",
    "apps/web/src/api/auctions/index.ts": "export const getAuction = () => undefined;\n",
    "apps/web/src/app/page.tsx": "import { format } from '@/shared/lib/format';\nimport { account } from '@/capabilities/account';\nimport { getAuction } from '@/api/auctions';\nimport { Header } from '@/shell/header';\nexport default function Page() { return [format, account, getAuction, Header]; }\n",
  });

  assert.deepEqual(keys(report, "layer-direction"), [
    "apps/web/src/capabilities/account/index.ts -> apps/web/src/shell/header.tsx",
    "apps/web/src/entities/figure/utils/figure.ts -> apps/web/src/api/auctions/index.ts",
    "apps/web/src/shared/lib/format.ts -> apps/web/src/entities/figure/utils/figure.ts",
  ]);
  assert.deepEqual(keys(report, "entity-cross-import"), ["apps/web/src/entities/figure/utils/figure.ts -> apps/web/src/entities/other/utils/other.ts"]);
});

test("화면 일 폴더 사이 순환은 feature-cycle, capability 조각 사이 순환은 slice-cycle로 막는다", async () => {
  const report = await inspect({
    [`${app}/work/page.tsx`]: "export default function Page() { return null; }\n",
    [`${app}/work/_alpha/utils/a.ts`]: "import { b } from '../../_beta/utils/b';\nexport const a = () => b;\n",
    [`${app}/work/_beta/utils/b.ts`]: "import { a } from '../../_alpha/utils/a';\nexport const b = () => a;\n",
    "apps/web/src/capabilities/left/index.ts": "export { leftValue } from './utils/left';\n",
    "apps/web/src/capabilities/left/utils/left.ts": "import { rightValue } from '@/capabilities/right';\nexport const leftValue = () => rightValue;\n",
    "apps/web/src/capabilities/right/index.ts": "export { rightValue } from './utils/right';\n",
    "apps/web/src/capabilities/right/utils/right.ts": "import { leftValue } from '@/capabilities/left';\nexport const rightValue = () => leftValue;\n",
  });

  assert.deepEqual(keys(report, "feature-cycle"), [`${app}/work/_alpha <-> ${app}/work/_beta`]);
  assert.deepEqual(keys(report, "slice-cycle"), ["apps/web/src/capabilities/left <-> apps/web/src/capabilities/right"]);
  assert.deepEqual(stronglyConnected(new Map([["a", new Set(["b"])], ["b", new Set(["c"])]])), []);
});

test("기준 목록의 옛 위반은 보고하지 않고 사라진 열쇠와 올릴 수 없는 규칙의 열쇠는 실패로 드러낸다", async () => {
  const files = {
    [`${app}/seats/page.tsx`]: "export default function Page() { return null; }\n",
    [`${app}/seats/_widgets/seats-frame.tsx`]: "export const SeatsFrame = () => <div />;\n",
    [`${app}/seats/components/seats-screen.tsx`]: "export const SeatsScreen = () => <main />;\n",
  };
  const baseline = new Map([
    ["kind-folder", new Set([`${app}/seats/_widgets/seats-frame.tsx`, `${app}/seats/_widgets/gone.tsx`])],
    ["kind-folder-mismatch", new Set([`${app}/seats/components/seats-screen.tsx`])],
  ]);
  const report = await inspect(files, baseline);

  assert.deepEqual(report.baselined.map((finding) => finding.key), [`${app}/seats/_widgets/seats-frame.tsx`]);
  assert.deepEqual(report.stale, [{ rule: "kind-folder", key: `${app}/seats/_widgets/gone.tsx` }]);
  assert.deepEqual(pairs(report, "kind-folder"), [`${app}/seats/components/seats-screen.tsx`]);
  assert.deepEqual(pairs(report, "kind-folder-mismatch"), [`${app}/seats/components/seats-screen.tsx`]);
  assert.equal(report.failures.length, 2);
  assert.match(report.failures.join("\n"), /더 이상 위반이 아닙니다/u);
  assert.match(report.failures.join("\n"), /kind-folder-mismatch 규칙은 기준 목록에 올릴 수 없습니다/u);
});

test("기준 목록은 기준 commit보다 늘면 그 열쇠를 돌려주고 첫 목록이면 늘었다고 보지 않는다", () => {
  const before = parseBaseline(formatBaseline(new Map([["kind-folder", new Set(["a.tsx", "b.tsx"])], ["route-private", new Set()]])));
  const now = new Map([["kind-folder", new Set(["a.tsx", "c.tsx"])], ["route-private", new Set(["x -> y"])]]);

  assert.deepEqual(grownKeys(now, before), [{ rule: "kind-folder", key: "c.tsx" }, { rule: "route-private", key: "x -> y" }]);
  assert.deepEqual(grownKeys(now, undefined), []);
  assert.match(formatBaseline(now), /"\$comment"/u);
});

test("빈 목록도 규칙 이름을 남기고, 기준 commit에 이름조차 없던 규칙은 이 변경이 들인 새 규칙의 첫 목록으로 본다", () => {
  const written = parseBaseline(formatBaseline(new Map([["slice-cycle", new Set()]])));
  assert.equal(written.has("slice-cycle"), true);

  const before = parseBaseline(formatBaseline(new Map([["kind-folder", new Set(["a.tsx"])]])));
  const now = new Map([["kind-folder", new Set(["a.tsx"])], ["color-literal", new Set(["apps/web/src/old.ts"])]]);
  assert.deepEqual(grownKeys(now, before), []);
});

test("종류 폴더의 utils React import와 components 비렌더 모듈을 거부하고 높이 상수 frame은 허용한다", async () => {
  const report = await inspect({
    [`${app}/work/page.tsx`]: "export default function Page() { return null; }\n",
    [`${app}/work/_pass/utils/board.ts`]: "import { useState } from 'react';\nexport const board = useState;\n",
    [`${app}/work/_pass/components/cards.tsx`]: "export const cards = 1;\n",
    [`${app}/work/_pass/components/cards.frame.ts`]: "export const CARD_ROWS = 3;\n",
    "apps/web/src/entities/figure/utils/figure.ts": "import { useMemo } from 'react';\nexport const figure = useMemo;\n",
  });

  assert.deepEqual(pairs(report, "feature-lib-react"), [`${app}/work/_pass/utils/board.ts`, "apps/web/src/entities/figure/utils/figure.ts"]);
  assert.deepEqual(pairs(report, "ui-non-render-module"), [`${app}/work/_pass/components/cards.tsx`]);
});

test("CLI의 --prune-baseline은 사라진 열쇠만 지우고 새 위반은 목록에 더하지 않는다", () => {
  const subject = fixture({
    [`${app}/seats/page.tsx`]: "export default function Page() { return null; }\n",
    [`${app}/seats/_widgets/seats-frame.tsx`]: "export const SeatsFrame = () => <div />;\n",
    [`${app}/seats/seats-screen.tsx`]: "export const SeatsScreen = () => <main />;\n",
    [BASELINE_PATH]: formatBaseline(new Map([["kind-folder", new Set([`${app}/seats/_widgets/seats-frame.tsx`, `${app}/seats/_widgets/gone.tsx`])]])),
  });
  try {
    const env = { ...process.env, WEB_BOUNDARIES_ROOT: subject.root };
    delete env.EATBID_CHANGED_PATHS;
    delete env.EATBID_CHANGED_BASE;
    const result = spawnSync(process.execPath, [cli, "--all", "--prune-baseline"], { cwd: repositoryRoot, encoding: "utf8", env });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /seats-screen\.tsx \[kind-folder\]/u);
    assert.doesNotMatch(result.stderr, /더 이상 위반이 아닙니다/u);
    const written = parseBaseline(readFileSync(path.join(subject.root, BASELINE_PATH), "utf8"));
    assert.deepEqual([...written.get("kind-folder")], [`${app}/seats/_widgets/seats-frame.tsx`]);
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});
