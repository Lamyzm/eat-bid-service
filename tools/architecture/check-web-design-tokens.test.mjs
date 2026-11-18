import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DESIGN_TOKEN_RULES, designTokenFindings } from "./web-boundaries/design-tokens.mjs";
import { inspectWebBoundaries } from "./web-boundaries/inspect.mjs";

const THEME = "apps/web/src/styles/themes/eatbid.css";
const themeFile = ":root { --eb-brand: #3182f6; }\n.dark { --eb-brand: #4c97ff; }\n";

function withTree(files, run) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-design-tokens-"));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const target = path.join(root, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents, "utf8");
    }
    return run(root, path.join(root, "apps", "web", "src"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const rulesOf = (findings, filePath) => findings.filter((item) => item.path === filePath).map((item) => item.rule).sort();

test("초록 계열 클래스는 어느 접두(bg·text·outline·dark:)로 써도 잡는다", () => {
  withTree(
    {
      [THEME]: themeFile,
      "apps/web/src/app/a.tsx": "export const A = () => <span className='dark:bg-emerald-400/20 text-teal-700'>x</span>;\n",
      "apps/web/src/app/b.tsx": "export const B = `outline-lime-500 ${'x'}`;\n",
      "apps/web/src/app/c.tsx": "export const C = 'bg-primary text-green';\n",
    },
    (root, sourceRoot) => {
      const findings = designTokenFindings(root, sourceRoot);
      assert.deepEqual(rulesOf(findings, "apps/web/src/app/a.tsx"), [DESIGN_TOKEN_RULES.GREEN_CLASS]);
      assert.deepEqual(rulesOf(findings, "apps/web/src/app/b.tsx"), [DESIGN_TOKEN_RULES.GREEN_CLASS]);
      assert.deepEqual(rulesOf(findings, "apps/web/src/app/c.tsx"), []);
    },
  );
});

test("색 글자값은 테마 파일과 meta 거울 밖에서 잡고, 주석의 이슈 번호와 이름 조각은 색으로 읽지 않는다", () => {
  withTree(
    {
      [THEME]: themeFile,
      "apps/web/src/shell/theme/meta-theme-color.ts": "export const C = { light: '#f9fafb' };\n",
      "apps/web/src/app/hex.tsx": "export const X = <p style={{ color: '#6b7280' }}>x</p>;\n",
      "apps/web/src/app/fn.ts": "export const X = 'oklch(0.43 0.085 158)';\n",
      "apps/web/src/app/comment.ts": "// 이슈 #228에서 정했다 /* #abc */\nexport const X = '/setup#region-preference';\nexport const Y = '#add-button';\n",
      "apps/web/src/styles/globals.css": "/* #000 */ .a { mask: linear-gradient(black, transparent); }\n",
      "apps/web/src/styles/bad.css": ".a { color: rgb(0 0 0 / 0.5); }\n",
    },
    (root, sourceRoot) => {
      const findings = designTokenFindings(root, sourceRoot);
      const literal = findings.filter((item) => item.rule === DESIGN_TOKEN_RULES.COLOR_LITERAL).map((item) => item.path).sort();
      assert.deepEqual(literal, ["apps/web/src/app/fn.ts", "apps/web/src/app/hex.tsx", "apps/web/src/styles/bad.css"]);
    },
  );
});

test("테마 파일이 둘이면 실패하고 하나면 통과한다", () => {
  withTree({ [THEME]: themeFile, "apps/web/src/styles/themes/light-green.css": themeFile }, (root, sourceRoot) => {
    const findings = designTokenFindings(root, sourceRoot);
    assert.equal(findings.filter((item) => item.rule === DESIGN_TOKEN_RULES.THEME_FILE_COUNT).length, 1);
  });
  withTree({ [THEME]: themeFile }, (root, sourceRoot) => {
    assert.deepEqual(designTokenFindings(root, sourceRoot), []);
  });
});

test("임의 글자 크기·임의 폭·손으로 지은 화면 틀을 잡고 이름 붙은 값은 통과시킨다", () => {
  withTree(
    {
      [THEME]: themeFile,
      "apps/web/src/app/size.tsx": "export const A = <p className='text-[15px] font-bold'>x</p>;\n",
      "apps/web/src/app/width.tsx": "export const A = <col className='w-[250px]' />;\n",
      "apps/web/src/app/frame.tsx": "export const A = <section className='mx-auto w-full max-w-[1180px] px-4'>x</section>;\n",
      "apps/web/src/app/ok.tsx": "export const A = <section className='max-w-page text-body w-62'>x</section>;\n",
    },
    (root, sourceRoot) => {
      const findings = designTokenFindings(root, sourceRoot);
      assert.deepEqual(rulesOf(findings, "apps/web/src/app/size.tsx"), [DESIGN_TOKEN_RULES.TEXT_ARBITRARY_SIZE]);
      assert.deepEqual(rulesOf(findings, "apps/web/src/app/width.tsx"), [DESIGN_TOKEN_RULES.ARBITRARY_WIDTH]);
      assert.deepEqual(rulesOf(findings, "apps/web/src/app/frame.tsx"), [DESIGN_TOKEN_RULES.ARBITRARY_WIDTH, DESIGN_TOKEN_RULES.FRAME_BYPASS]);
      assert.deepEqual(rulesOf(findings, "apps/web/src/app/ok.tsx"), []);
    },
  );
});

test("토스트와 숫자 표기는 주인 파일 밖에서 쓰면 잡는다", () => {
  withTree(
    {
      [THEME]: themeFile,
      "apps/web/src/shared/ui/notify.ts": "import { toast } from 'sonner';\nvoid toast;\n",
      "apps/web/src/shared/lib/number-format.ts": "export const f = (n: number) => n.toLocaleString('ko-KR');\n",
      "apps/web/src/capabilities/x/components/hub.tsx": "import { toast } from 'sonner';\nvoid toast;\n",
      "apps/web/src/entities/y/utils/count.ts": "export const c = (n: number) => new Intl.NumberFormat('ko-KR').format(n);\n",
      "apps/web/src/entities/y/utils/count.test.ts": "export const c = (n: number) => n.toLocaleString();\n",
    },
    (root, sourceRoot) => {
      const findings = designTokenFindings(root, sourceRoot);
      assert.deepEqual(findings.map((item) => `${item.rule} ${item.path}`).sort(), [
        `${DESIGN_TOKEN_RULES.NUMBER_FORMAT_OWNER} apps/web/src/entities/y/utils/count.ts`,
        `${DESIGN_TOKEN_RULES.TOAST_OWNER} apps/web/src/capabilities/x/components/hub.tsx`,
      ]);
    },
  );
});

test("옛 위반은 기준 목록으로 넘어가고, 목록에 없는 새 위반과 주인 규칙 위반은 보고한다", async () => {
  await withTree(
    {
      [THEME]: themeFile,
      "apps/web/src/app/(workspace)/review/old.tsx": "export const A = <i className='bg-emerald-600'>x</i>;\n",
      "apps/web/src/app/(workspace)/work/new.tsx": "export const A = <i className='bg-teal-600'>x</i>;\n",
      "apps/web/src/app/(workspace)/work/toast.tsx": "import { toast } from 'sonner';\nvoid toast;\n",
    },
    async (root, sourceRoot) => {
      const baseline = new Map([[DESIGN_TOKEN_RULES.GREEN_CLASS, new Set(["apps/web/src/app/(workspace)/review/old.tsx"])]]);
      const report = await inspectWebBoundaries({ repoRoot: root, sourceRoot, baseline });
      const reported = report.findings.filter((item) => Object.values(DESIGN_TOKEN_RULES).includes(item.rule)).map((item) => `${item.rule} ${item.path}`).sort();
      assert.deepEqual(reported, [
        `${DESIGN_TOKEN_RULES.GREEN_CLASS} apps/web/src/app/(workspace)/work/new.tsx`,
        `${DESIGN_TOKEN_RULES.TOAST_OWNER} apps/web/src/app/(workspace)/work/toast.tsx`,
      ]);
      assert.deepEqual(report.baselined.map((item) => item.path), ["apps/web/src/app/(workspace)/review/old.tsx"]);
    },
  );
});
