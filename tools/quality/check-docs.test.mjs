import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectDocs } from "./check-docs.mjs";

const frontmatter = (canonicalFor, status = "active") =>
  `---\nid: ${canonicalFor.toUpperCase()}\nstatus: ${status}\ncanonical_for: ${canonicalFor}\nlast_reviewed: 2026-09-09\nreview_trigger: fixture-change\n---\n`;

const baseFiles = {
  // 뿌리 둘은 지침 파일이라 frontmatter 없이 링크만으로 지도 역할을 한다.
  "AGENTS.md": "# 계약\n\n[구조](ARCHITECTURE.md)\n",
  "ARCHITECTURE.md": "# 구조\n\n[지도](docs/README.md)\n",
  "docs/README.md": `${frontmatter("documentation-map")}# 지도\n\n[운영](operations/runbook.md) [ADR](adr/README.md) [PDR](product/decisions/README.md)\n`,
  "docs/operations/runbook.md": `${frontmatter("runbook")}# 운영\n\n## 복구 절차\n\n본문\n`,
  "docs/adr/README.md": `${frontmatter("adr-index")}# ADR\n\n[0001](0001-first.md) [0002](0002-second.md)\n`,
  "docs/adr/0001-first.md": "# 0001 — 첫 결정\n\n- Status: Superseded\n- Date: 2026-09-01\n- Supersedes: 없음\n- Superseded by: [0002](0002-second.md)\n\n## Context\n",
  "docs/adr/0002-second.md": "# 0002 — 둘째 결정\n\n- Status: Accepted\n- Date: 2026-09-02 (2026-09-09 개정)\n- Supersedes: 0001\n\n## Context\n",
  "docs/product/decisions/README.md": `${frontmatter("pdr-index")}# PDR\n\n[0001](0001-region.md)\n`,
  "docs/product/decisions/0001-region.md": "# PDR-0001 — 지역\n\n- Status: Active\n- Date: 2026-09-05\n- Supersedes: 없음\n- Superseded-by: 없음\n- Linear: EAT-1\n\n## 결정\n",
};

function writeFiles(root, files) {
  for (const [relativePath, source] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source, "utf8");
  }
}

function repository(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-docs-lint-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.name", "검증 사용자");
  git("config", "user.email", "quality@example.com");
  writeFiles(root, files);
  git("add", ".");
  git("commit", "-qm", "초기 문서 저장");
  return { root, close: () => rmSync(root, { recursive: true, force: true }) };
}

function inspect(fixture, extraFiles = {}, changedPaths = Object.keys(extraFiles)) {
  writeFiles(fixture.root, extraFiles);
  return inspectDocs({ repoRoot: fixture.root, changedPaths: new Set(changedPaths) });
}

test("frontmatter·대체 관계·지도 연결이 갖춰진 문서 집합은 변경 범위와 전체 규칙 모두 위반 없이 통과한다", () => {
  const fixture = repository(baseFiles);
  try {
    const report = inspect(fixture, {}, Object.keys(baseFiles));
    assert.deepEqual(report.headerViolations, []);
    assert.deepEqual(report.violations, []);
    assert.equal(report.inspectedCount, 9);
    assert.equal(report.headerInspectedCount, 7);
  } finally {
    fixture.close();
  }
});

test("변경 범위 안의 새 문서에 frontmatter가 없거나 필드가 비면 누락 필드를 한국어로 보고한다", () => {
  const fixture = repository(baseFiles);
  try {
    const report = inspect(fixture, {
      "docs/operations/new-runbook.md": "# 새 runbook\n\n본문\n",
      "docs/operations/partial.md": "---\nid: PARTIAL\nstatus: active\n---\n# 일부\n",
    });
    const messages = Object.fromEntries(report.headerViolations.map((item) => [item.path, item.message]));
    assert.match(messages["docs/operations/new-runbook.md"], /YAML frontmatter/u);
    assert.match(messages["docs/operations/partial.md"], /canonical_for, last_reviewed, review_trigger/u);
  } finally {
    fixture.close();
  }
});

test("변경 범위 밖의 기존 문서는 frontmatter가 없어도 묻지 않고, 수정하는 순간 요구한다", () => {
  const fixture = repository({ ...baseFiles, "docs/operations/legacy.md": "# 옛 runbook\n\n본문\n" });
  try {
    const untouched = inspectDocs({ repoRoot: fixture.root, changedPaths: new Set(["docs/operations/runbook.md"]) });
    assert.deepEqual(untouched.headerViolations, []);
    assert.equal(untouched.headerInspectedCount, 1);

    const edited = inspect(fixture, { "docs/operations/legacy.md": "# 옛 runbook\n\n고친 본문\n" });
    assert.equal(edited.headerViolations.length, 1);
    assert.equal(edited.headerViolations[0].path, "docs/operations/legacy.md");

    const audit = inspectDocs({ repoRoot: fixture.root });
    assert.equal(audit.headerViolations.length, 1);
    assert.equal(audit.headerInspectedCount, 8);
  } finally {
    fixture.close();
  }
});

test("같은 canonical_for를 두 문서가 선언하면 변경 범위와 무관하게 두 문서 모두 위반이다", () => {
  const fixture = repository(baseFiles);
  try {
    const report = inspect(fixture, { "docs/operations/second-runbook.md": `${frontmatter("runbook", "draft")}# 둘째\n` }, []);
    const paths = report.violations.map((item) => item.path);
    assert.ok(paths.includes("docs/operations/runbook.md"));
    assert.ok(paths.includes("docs/operations/second-runbook.md"));
    assert.ok(report.violations.every((item) => /canonical_for 'runbook'/u.test(item.message)));
  } finally {
    fixture.close();
  }
});

test("active 문서가 AGENTS→ARCHITECTURE→docs/README 지도에서 링크로 도달할 수 없으면 위반이다", () => {
  const fixture = repository(baseFiles);
  try {
    const report = inspect(fixture, {
      "docs/architecture/orphan.md": `${frontmatter("orphan-topic")}# 고아 문서\n`,
      "docs/architecture/draft.md": `${frontmatter("draft-topic", "draft")}# 초안\n`,
    });
    assert.deepEqual(report.violations.map((item) => item.path), ["docs/architecture/orphan.md"]);
    assert.match(report.violations[0].message, /지도에서 링크로 도달할 수 없습니다/u);
  } finally {
    fixture.close();
  }
});

test("ADR·PDR의 Supersedes와 Superseded-by는 양방향으로 일치해야 하고 부분 대체 문장은 요구하지 않는다", () => {
  const fixture = repository(baseFiles);
  try {
    const report = inspect(fixture, {
      "docs/product/decisions/README.md": `${frontmatter("pdr-index")}# PDR\n\n[0001](0001-region.md) [0002](0002-region-v2.md)\n`,
      "docs/product/decisions/0002-region-v2.md":
        "# PDR-0002 — 지역 v2\n\n- Status: Active\n- Date: 2026-09-09\n- Supersedes: 0001\n- Superseded-by: 없음\n\n## 결정\n",
      "docs/adr/README.md": `${frontmatter("adr-index")}# ADR\n\n[0001](0001-first.md) [0002](0002-second.md) [0003](0003-partial.md)\n`,
      "docs/adr/0003-partial.md":
        "# 0003 — 부분 대체\n\n- Status: Accepted\n- Date: 2026-09-09\n- Supersedes: 없음. ADR 0002의 캐시 항목만 대체한다.\n\n## Context\n",
    });
    const pdr = report.violations.filter((item) => item.path === "docs/product/decisions/0001-region.md");
    const messages = pdr.map((item) => item.message).join("\n");
    assert.equal(pdr.length, 2);
    assert.match(messages, /Status가 Superseded가 아닙니다/u);
    assert.match(messages, /'Superseded-by:'에 0002/u);
    assert.ok(!report.violations.some((item) => item.path.includes("0002-second") || item.path.includes("0003-partial")));
  } finally {
    fixture.close();
  }
});

test("존재하지 않는 파일이나 heading 앵커를 가리키는 상대 링크는 위반이고 한국어 heading 앵커는 해석된다", () => {
  const fixture = repository(baseFiles);
  try {
    const report = inspect(fixture, {
      "docs/operations/links.md": `${frontmatter("link-fixture", "draft")}# 링크\n\n[없음](missing.md) [앵커 없음](runbook.md#없는-절) [정상](runbook.md#복구-절차) [외부](https://example.com/x.md) [괄호 경로](../../apps/(group)/page.md) [꺾쇠](<../../apps/(group)/page.md>)\n`,
      "apps/(group)/page.md": "# 그룹 페이지\n",
    });
    assert.deepEqual(
      report.violations.map((item) => item.message),
      ["상대 링크 'missing.md'가 가리키는 파일이 없습니다.", "상대 링크 'runbook.md#없는-절'의 앵커가 대상 문서 heading에 없습니다."],
    );
  } finally {
    fixture.close();
  }
});
