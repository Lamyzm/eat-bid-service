import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.STACK_DOCS_ROOT
  ? path.resolve(process.env.STACK_DOCS_ROOT)
  : fileURLToPath(new URL("../../", import.meta.url));
const stackDirectory = path.join(root, "docs", "architecture", "stack");
const index = path.join(stackDirectory, "README.md");
const audits = [
  "application-runtime.md",
  "contracts-and-validation.md",
  "data-platform.md",
  "delivery-and-operations.md",
];
const requiredHeadings = [
  "Current baseline",
  "Decision table",
  "Rejected or deferred",
  "Review triggers",
];
const dispositions = new Set([
  "Adopted",
  "Required before production",
  "Deferred",
  "Rejected for foundation",
]);
const requiredContractEvidence = [
  "packages/contracts",
  "Zod",
  "packages/domain",
  "packages/db",
  "source Pydantic",
  "generated normalized Pydantic",
  "AuctionRecord",
  "AuctionV1Response",
  "apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts",
  "mapAuctionRow",
  "postgresInstant",
  "packages/domain/src/time/clock.ts",
  "systemClock",
  "pnpm architecture:check",
  "pnpm contracts:check",
  "pnpm contracts:python:check",
  "tools/architecture/check-semantic-values.mjs",
  "tools/quality/check-python-semantic-values.py",
  "top-level `portableContracts`",
  "windows-latest",
  "CRLF/LF",
];
const failures = [];

function display(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function requireFile(file) {
  if (!existsSync(file)) {
    failures.push(`Missing required file: ${display(file)}`);
    return false;
  }
  return true;
}

function markdownLinks(markdown) {
  return [...markdown.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)].map((match) => match[1]);
}

function checkLocalLinks(file, markdown) {
  for (const link of markdownLinks(markdown)) {
    const target = link.replace(/^<|>$/g, "").split("#", 1)[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    if (!existsSync(resolved)) {
      failures.push(`Broken local link in ${display(file)}: ${link}`);
    }
  }
}

function section(markdown, heading) {
  const headingPattern = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*$`, "mi");
  const match = headingPattern.exec(markdown);
  if (!match) return undefined;
  const afterHeading = match.index + match[0].length;
  const nextHeading = /^#{1,6}\s+/m.exec(markdown.slice(afterHeading));
  return markdown.slice(afterHeading, nextHeading ? afterHeading + nextHeading.index : undefined);
}

function parseTableRow(line) {
  if (!/^\s*\|.*\|\s*$/.test(line)) return undefined;
  return line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
}

function separatorIsValid(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function checkDecisionTable(file, markdown) {
  const decision = section(markdown, "Decision table");
  if (decision === undefined) return;
  const lines = decision.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 3) {
    failures.push(`Decision table in ${display(file)} must contain a header, separator, and at least one row`);
    return;
  }
  const header = parseTableRow(lines[0]);
  if (!header || header.some((cell) => !cell)) {
    failures.push(`Decision table in ${display(file)} must begin with a non-empty Markdown table header`);
    return;
  }
  const separator = parseTableRow(lines[1]);
  if (!separator || separator.length !== header.length || !separatorIsValid(separator)) {
    failures.push(`Decision table in ${display(file)} must have a valid Markdown separator row`);
    return;
  }
  const dispositionColumn = header.findIndex((cell) => cell === "Disposition");
  if (dispositionColumn < 0) {
    failures.push(`Decision table in ${display(file)} must have a Disposition column`);
    return;
  }
  for (const line of lines.slice(2)) {
    const cells = parseTableRow(line);
    if (!cells) {
      failures.push(`Decision table row in ${display(file)} must use Markdown table syntax: ${line}`);
      continue;
    }
    if (cells.length !== header.length) {
      failures.push(`Decision table row in ${display(file)} has ${cells.length} cells; expected ${header.length}`);
      continue;
    }
    const disposition = cells[dispositionColumn];
    if (!dispositions.has(disposition)) {
      failures.push(`Invalid disposition in ${display(file)}: ${disposition || "(empty)"}`);
    }
  }
}

if (requireFile(index)) {
  const indexMarkdown = readFileSync(index, "utf8");
  if (/\b(?:TBD|TODO)\b/i.test(indexMarkdown)) {
    failures.push(`Placeholder found in ${display(index)}`);
  }
  checkLocalLinks(index, indexMarkdown);
  const indexLinks = new Set(markdownLinks(indexMarkdown));
  for (const audit of audits) {
    if (!indexLinks.has(`./${audit}`) && !indexLinks.has(audit)) {
      failures.push(`Index does not link to ${audit}`);
    }
  }
}

for (const audit of audits) {
  const file = path.join(stackDirectory, audit);
  if (!requireFile(file)) continue;
  const markdown = readFileSync(file, "utf8");
  if (/\b(?:TBD|TODO)\b/i.test(markdown)) {
    failures.push(`Placeholder found in ${display(file)}`);
  }
  for (const heading of requiredHeadings) {
    if (section(markdown, heading) === undefined) {
      failures.push(`Missing heading in ${display(file)}: ${heading}`);
    }
  }
  checkDecisionTable(file, markdown);
  checkLocalLinks(file, markdown);
  if (audit === "contracts-and-validation.md") {
    for (const evidence of requiredContractEvidence) {
      if (!markdown.includes(evidence)) {
        failures.push(`Missing enforced contract evidence in ${display(file)}: ${evidence}`);
      }
    }
  }
}

if (failures.length) {
  console.error("Architecture stack documentation check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Architecture stack documentation check passed.");
}
