import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const checker = path.join(root, "tools", "architecture", "check-stack-docs.mjs");
const audits = [
  "application-runtime.md",
  "contracts-and-validation.md",
  "data-platform.md",
  "delivery-and-operations.md",
];

function audit(disposition = "Adopted", separator = "| --- | --- | --- | --- | --- |") {
  return `# Audit\n\n## Current baseline\n\nBaseline.\n\n## Decision table\n\n| Item | Evidence | Checked | Disposition | Trigger |\n${separator}\n| item | evidence | today | ${disposition} | trigger |\n\n## Rejected or deferred\n\nNone.\n\n## Review triggers\n\nA trigger.\n`;
}

function koreanAudit() {
  return `# 감사\n\n## 현재 기준선\n\n기준선.\n\n## 결정표\n\n| 항목 | 증거 | 확인일 | 결정 | 계기 |\n| --- | --- | --- | --- | --- |\n| 항목 | 증거 | 오늘 | 채택 | 계기 |\n\n## 제외 또는 연기\n\n없음.\n\n## 재검토 조건\n\n재검토 조건.\n`;
}

function contractsAudit(extra = "") {
  return `${audit()}\n## Enforced contract evidence\n\n` + [
    "packages/contracts Zod wire authority",
    "packages/domain semantic authority",
    "packages/db Drizzle DDL authority",
    "source Pydantic authority and generated normalized Pydantic",
    "AuctionRecord internal application port; AuctionV1Response public wire",
    "apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts mapAuctionRow postgresInstant",
    "packages/domain/src/time/clock.ts systemClock",
    "pnpm architecture:check",
    "pnpm contracts:check",
    "pnpm contracts:python:check",
    "tools/architecture/check-semantic-values.mjs",
    "tools/quality/check-python-semantic-values.py",
    "top-level `portableContracts`",
    "windows-latest",
    "CRLF/LF",
    extra,
  ].join("\n\n");
}

function fixture({ indexExtra = "", applicationAudit = audit() } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "eatbid-stack-check-"));
  const stack = path.join(directory, "docs", "architecture", "stack");
  mkdirSync(stack, { recursive: true });
  mkdirSync(path.join(directory, "docs", "adr"), { recursive: true });
  writeFileSync(path.join(directory, "docs", "adr", "0001.md"), "# ADR\n");
  writeFileSync(
    path.join(stack, "README.md"),
    `# Stack\n\n${audits.map((name) => `- [${name}](./${name})`).join("\n")}\n\n[index ADR](../../adr/0001.md)\n${indexExtra}`,
  );
  for (const name of audits) {
    const contents = name === audits[0]
      ? applicationAudit
      : name === "contracts-and-validation.md" ? contractsAudit() : audit();
    writeFileSync(path.join(stack, name), contents);
  }
  return directory;
}

function run(directory) {
  try {
    execFileSync(process.execPath, [checker], {
      cwd: root,
      env: { ...process.env, STACK_DOCS_ROOT: directory },
      stdio: "pipe",
      encoding: "utf8",
    });
    return "";
  } catch (error) {
    return `${error.stdout}${error.stderr}`;
  }
}

function withFixture(options, assertion) {
  const directory = fixture(options);
  try {
    assertion(run(directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("구조가 올바른 stack fixture를 허용한다", () => {
  withFixture({}, (output) => assert.equal(output, ""));
});

test("한국어 heading과 결정값으로 작성한 stack 문서를 허용한다", () => {
  withFixture({ applicationAudit: koreanAudit() }, (output) => assert.equal(output, ""));
});

test("stack index의 placeholder를 거부한다", () => {
  withFixture({ indexExtra: "\nTODO remove placeholder\n" }, (output) => {
    assert.match(output, /Placeholder found in docs\/architecture\/stack\/README\.md/);
  });
});

test("stack index의 깨진 로컬 링크를 거부한다", () => {
  withFixture({ indexExtra: "\n[missing ADR](../../adr/missing.md)\n" }, (output) => {
    assert.match(output, /Broken local link in docs\/architecture\/stack\/README\.md/);
  });
});

test("decision table의 잘못된 구분 행을 거부한다", () => {
  withFixture({ applicationAudit: audit("Adopted", "| invalid | separator |") }, (output) => {
    assert.match(output, /must have a valid Markdown separator row/);
  });
});

test("첫 decision 행의 잘못된 disposition을 거부한다", () => {
  withFixture({ applicationAudit: audit("Candidate") }, (output) => {
    assert.match(output, /Invalid disposition.*Candidate/);
  });
});

test("decision table 행의 불일치한 너비를 거부한다", () => {
  const inconsistent = audit().replace(
    "| item | evidence | today | Adopted | trigger |",
    "| item | evidence | today | Adopted |",
  );
  withFixture({ applicationAudit: inconsistent }, (output) => {
    assert.match(output, /has 4 cells; expected 5/);
  });
});

test("contract audit에서 semantic gate command가 빠지면 거부한다", () => {
  const directory = fixture();
  try {
    const file = path.join(directory, "docs", "architecture", "stack", "contracts-and-validation.md");
    writeFileSync(file, contractsAudit().replace("pnpm contracts:python:check", "python drift command removed"));
    assert.match(run(directory), /Missing enforced contract evidence.*pnpm contracts:python:check/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("contract audit에서 internal port와 public wire 구분이 빠지면 거부한다", () => {
  const directory = fixture();
  try {
    const file = path.join(directory, "docs", "architecture", "stack", "contracts-and-validation.md");
    writeFileSync(file, contractsAudit().replace("AuctionRecord internal application port; AuctionV1Response public wire", "wire types"));
    assert.match(run(directory), /Missing enforced contract evidence.*AuctionRecord/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
