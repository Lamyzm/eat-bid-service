import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectRegionVocabulary } from "./region-vocabulary/inspect.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const cli = path.join(repositoryRoot, "tools", "architecture", "check-region-vocabulary.mjs");
const policyPath = path.join(repositoryRoot, "tools", "architecture", "region-vocabulary", "policy.mjs");

const SEED = `export const codeSchemeSeeds = [
  { namespace: "mois:administrative-region" },
  { namespace: "eat:auction-location-sido" },
  { namespace: "eat:auction-location-sigungu" },
];
`;

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-region-vocabulary-"));
  const write = (relativePath, contents) => {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  };
  write("packages/db/src/seeds/code-schemes.ts", SEED);
  for (const [relativePath, contents] of Object.entries(files)) write(relativePath, contents);
  const baselinePath = path.join(root, "baseline.json");
  writeFileSync(baselinePath, '{\n  "version": 1,\n  "entries": []\n}\n', "utf8");
  return { root, baselinePath };
}

function inspect(files, sourceRoots = ["apps/web/src", "packages/db/src", "packages/contracts/src"]) {
  const subject = fixture(files);
  try {
    return inspectRegionVocabulary({ repoRoot: subject.root, sourceRoots, baselinePath: subject.baselinePath });
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
}

function rules(report) {
  return [...new Set(report.unmatchedFindings.map((finding) => finding.rule))].sort();
}

test("지역 이름을 이어 붙인 키를 거부한다", () => {
  const report = inspect({
    "apps/web/src/map.ts": "const coords: Record<string, number> = {};\nexport const at = (sido: string, sigungu: string) => coords[`${sido}|${sigungu}`];\n",
  });
  assert.deepEqual(rules(report), ["name-composed-key"]);
});

test("코드 값 식별자로 만든 키는 통과한다", () => {
  const report = inspect({
    "apps/web/src/map.ts": "const coords: Record<string, number> = {};\nexport const at = (regionCodeValueId: string) => coords[regionCodeValueId];\n",
  });
  assert.deepEqual(rules(report), []);
});

test("선언 권위 밖에서 코드 체계 이름을 다시 선언하면 거부한다", () => {
  const report = inspect({
    "apps/web/src/scheme.ts": "export const SCHEME = 'mois:administrative-region';\n",
  });
  assert.deepEqual(rules(report), ["scheme-literal-redeclared"]);
});

test("선언 권위와 계약 atom은 체계 이름을 가질 수 있다", () => {
  const report = inspect({
    "packages/contracts/src/atoms/code-scheme-names.ts": 'export const NAMES = { region: "mois:administrative-region" } as const;\n',
    "apps/web/src/scheme.ts": "import { NAMES } from '@eatbid/contracts/atoms/code-scheme-names';\nexport const scheme = NAMES.region;\n",
  });
  assert.deepEqual(rules(report), []);
  assert.deepEqual(report.baselineFailures, []);
});

test("계약 atom이 seed에 없는 체계를 열면 실패를 보고한다", () => {
  const report = inspect({
    "packages/contracts/src/atoms/code-scheme-names.ts": 'export const NAMES = { region: "mois:unknown-region" } as const;\n',
  });
  assert.equal(report.baselineFailures.length, 1);
  assert.match(report.baselineFailures[0], /mois:unknown-region/);
});

test("지역을 이름 문자열이나 관측 라벨과 비교하면 거부한다", () => {
  const report = inspect({
    "apps/web/src/pick.ts": "export const isHome = (row: { sigungu: string; region: { label: string } }) =>"
      + " row.sigungu === '창원시' || row.sigungu === row.region.label;\n",
  });
  assert.deepEqual(rules(report), ["region-name-comparison"]);
  assert.equal(report.unmatchedFindings.length, 2);
});

test("코드 체계 이름 비교와 코드 값 식별자 비교는 이름 비교가 아니다", () => {
  const report = inspect({
    "packages/contracts/src/atoms/code-scheme-names.ts": 'export const NAMES = { region: "mois:administrative-region" } as const;\n',
    "apps/web/src/pick.ts": "import { NAMES } from '@eatbid/contracts/atoms/code-scheme-names';\n"
      + "export const isCanonical = (meta: { regionScheme: string; regionCodeValueId: string }) =>"
      + " meta.regionScheme === NAMES.region && meta.regionCodeValueId === '41';\n",
  });
  assert.deepEqual(rules(report), []);
});

test("지역 이름 목록 조회를 거부한다", () => {
  const report = inspect({
    "apps/web/src/pick.ts": "export const seen = (regions: string[], row: { name: string }) => regions.includes(row.name);\n",
  });
  assert.deepEqual(rules(report), ["region-name-comparison"]);
});

test("좌표표를 소스에 다시 선언하면 거부한다", () => {
  const entries = Array.from({ length: 8 }, (_value, index) => `  k${index}: [37.${index}, 126.${index}],`).join("\n");
  const report = inspect({ "apps/web/src/coords.ts": `export const COORDS = {\n${entries}\n};\n` });
  assert.deepEqual(rules(report), ["coordinate-table-redeclared"]);
});

test("좌표 항목이 표를 이룰 만큼 많지 않으면 통과한다", () => {
  const entries = Array.from({ length: 3 }, (_value, index) => `  k${index}: [37.${index}, 126.${index}],`).join("\n");
  const report = inspect({ "apps/web/src/coords.ts": `export const ANCHORS = {\n${entries}\n};\n` });
  assert.deepEqual(rules(report), []);
});

test("한 질의가 두 체계를 code_mapping 없이 이으면 거부한다", () => {
  const report = inspect({
    "apps/web/src/query.ts": "export const sql = `select 1 from t"
      + " where a = 'mois:administrative-region' and b = 'eat:auction-location-sido'`;\n",
  });
  assert.ok(rules(report).includes("cross-scheme-join"));
});

test("code_mapping을 거치는 질의는 두 체계를 함께 말할 수 있다", () => {
  const report = inspect({
    "apps/web/src/query.ts": "export const sql = `select 1 from core.code_mapping"
      + " where a = 'mois:administrative-region' and b = 'eat:auction-location-sido'`;\n",
  });
  assert.deepEqual(rules(report).filter((rule) => rule === "cross-scheme-join"), []);
});

test("린트 자체가 지역 이름 목록을 선언하지 않는다", () => {
  const policy = readFileSync(policyPath, "utf8");
  assert.doesNotMatch(policy, /특별시|광역시|시군구명/u);
  // 체계 이름조차 규칙 파일이 들지 않는다. 권위는 seed 하나이고 린트는 그것을 읽는다.
  assert.doesNotMatch(policy, /mois:|eat:/u);
});

test("저장소 전체에서 지역 어휘 재선언 검사가 통과한다", () => {
  const output = execFileSync(process.execPath, [cli], { cwd: repositoryRoot, encoding: "utf8" });
  assert.match(output, /통과했습니다/u);
});
