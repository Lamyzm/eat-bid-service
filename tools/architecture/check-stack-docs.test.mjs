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
  for (const name of audits) writeFileSync(path.join(stack, name), name === audits[0] ? applicationAudit : audit());
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

test("passes a structurally valid stack fixture", () => {
  withFixture({}, (output) => assert.equal(output, ""));
});

test("rejects a placeholder in the stack index", () => {
  withFixture({ indexExtra: "\nTODO remove placeholder\n" }, (output) => {
    assert.match(output, /Placeholder found in docs\/architecture\/stack\/README\.md/);
  });
});

test("rejects a broken local link in the stack index", () => {
  withFixture({ indexExtra: "\n[missing ADR](../../adr/missing.md)\n" }, (output) => {
    assert.match(output, /Broken local link in docs\/architecture\/stack\/README\.md/);
  });
});

test("rejects a malformed decision-table separator", () => {
  withFixture({ applicationAudit: audit("Adopted", "| invalid | separator |") }, (output) => {
    assert.match(output, /must have a valid Markdown separator row/);
  });
});

test("rejects a first decision row with an invalid disposition", () => {
  withFixture({ applicationAudit: audit("Candidate") }, (output) => {
    assert.match(output, /Invalid disposition.*Candidate/);
  });
});

test("rejects inconsistent decision-table row width", () => {
  const inconsistent = audit().replace(
    "| item | evidence | today | Adopted | trigger |",
    "| item | evidence | today | Adopted |",
  );
  withFixture({ applicationAudit: inconsistent }, (output) => {
    assert.match(output, /has 4 cells; expected 5/);
  });
});
