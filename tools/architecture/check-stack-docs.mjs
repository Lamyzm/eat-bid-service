import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
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

function checkDecisionTable(file, markdown) {
  const decision = section(markdown, "Decision table");
  if (decision === undefined) return;
  const lines = decision.split(/\r?\n/).filter((line) => line.trim());
  const tableLines = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line));
  if (tableLines.length < 3) {
    failures.push(`Decision table in ${display(file)} must contain a header, separator, and at least one row`);
    return;
  }
  const header = tableLines[0].split("|").map((cell) => cell.trim());
  const dispositionColumn = header.findIndex((cell) => cell === "Disposition");
  if (dispositionColumn < 0) {
    failures.push(`Decision table in ${display(file)} must have a Disposition column`);
    return;
  }
  for (const row of tableLines.slice(2)) {
    const cells = row.split("|").map((cell) => cell.trim());
    const disposition = cells[dispositionColumn];
    if (!dispositions.has(disposition)) {
      failures.push(`Invalid disposition in ${display(file)}: ${disposition || "(empty)"}`);
    }
  }
}

if (requireFile(index)) {
  const indexMarkdown = readFileSync(index, "utf8");
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
}

if (failures.length) {
  console.error("Architecture stack documentation check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Architecture stack documentation check passed.");
}
