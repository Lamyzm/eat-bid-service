import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const WEB_BOUNDARY_RULES = Object.freeze({
  API_ENDPOINT_LITERAL: "api-endpoint-literal",
  API_RESOURCE_CROSS_IMPORT: "api-resource-cross-import",
  CAPABILITY_INTERNAL_IMPORT: "capability-internal-import",
  DUPLICATE_SOURCE_GROUP: "duplicate-source-group",
  FRONTEND_ENDPOINTS_MIRROR: "frontend-endpoints-mirror",
  ID_NUMBER_CONVERSION: "id-number-conversion",
  MANUAL_API_RESPONSE: "manual-api-response",
  RAW_FETCH: "raw-fetch",
  ROUTE_CLIENT_COMPONENT: "route-client-component",
  SHELL_BOUNDARY_IMPORT: "shell-boundary-import",
  SOURCE_FILE_SIZE: "source-file-size",
  UNCHECKED_JSON_CAST: "unchecked-json-cast",
  UNCHECKED_RESPONSE_JSON: "unchecked-response-json",
  WEB_API_DEEP_IMPORT: "web-api-deep-import",
});

export const MAX_SOURCE_LINES = 300;
export const MIN_DUPLICATE_NONBLANK_LINES = 10;
export const MIN_DUPLICATE_BYTES = 200;

export function normalizeBytes(contents) {
  return contents.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function normalizedPath(repoRoot, filename) {
  return path.relative(repoRoot, filename).replaceAll("\\", "/");
}

export function isTestOrFixture(file) {
  return /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)__(?:tests?|fixtures?)__(?:\/|$)|(?:^|\/)fixtures?(?:\/|$))/i.test(file);
}

export function isTypeScriptSource(file) {
  return /\.[cm]?tsx?$/i.test(file) && !/\.d\.ts$/i.test(file);
}

export function sourceLayer(sourcePath) {
  const raw = sourcePath.replaceAll("\\", "/");
  const normalized = raw.endsWith("/") ? raw : `${raw}/`;
  const match = normalized.match(/\/src\/(shell|capabilities|api)(?:\/([^/]+))?\//);
  if (!match) return undefined;
  return { layer: match[1], slice: match[2] };
}

export function isTransportPath(sourcePath) {
  return /\/src\/api\/_transport\//.test(sourcePath.replaceAll("\\", "/"));
}

export function isPublicApiEntry(targetPath) {
  const normalized = targetPath.replaceAll("\\", "/").replace(/\/$/, "");
  return /\/api\/[^/]+$/.test(normalized)
    || /\/api\/[^/]+\/(?:index|server)$/.test(normalized)
    || /\/api\/[^/]+\/(?:index|server)\.[cm]?tsx?$/.test(normalized);
}

function baselineKey(entry) {
  return `${entry.rule}\u0000${entry.path}\u0000${entry.kind}`;
}

export function readLegacyBaseline(baselinePath) {
  if (!existsSync(baselinePath)) return { baseline: { version: 1, entries: [] }, baselineFailures: [] };
  try {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    if (baseline.version !== 1 || !Array.isArray(baseline.entries)) {
      return { baseline: { version: 1, entries: [] }, baselineFailures: ["legacy baseline must have version 1 and an entries array"] };
    }
    const required = ["rule", "path", "kind", "sha256", "reason", "owner", "splitTrigger"];
    const baselineFailures = [];
    for (const [index, entry] of baseline.entries.entries()) {
      for (const key of required) if (typeof entry[key] !== "string" || !entry[key].trim()) baselineFailures.push(`legacy baseline entry ${index} must contain ${key}`);
      if (!/^sha256:[a-f0-9]{64}$/.test(entry.sha256 ?? "")) baselineFailures.push(`legacy baseline entry ${index} has an invalid sha256 fingerprint`);
      if (entry.members && (!Array.isArray(entry.members) || entry.members.some((member) => typeof member !== "string"))) baselineFailures.push(`legacy baseline entry ${index} has invalid duplicate members`);
    }
    return { baseline, baselineFailures };
  } catch (error) {
    return { baseline: { version: 1, entries: [] }, baselineFailures: [`cannot read legacy baseline: ${error.message}`] };
  }
}

export function applyLegacyBaseline(findings, baseline) {
  const baselineFailures = [];
  const entriesByKey = new Map();
  for (const entry of baseline.entries) {
    const key = baselineKey(entry);
    const entries = entriesByKey.get(key) ?? [];
    entries.push(entry);
    entriesByKey.set(key, entries);
  }
  const unmatchedFindings = [];
  for (const item of findings) {
    const entries = entriesByKey.get(baselineKey(item)) ?? [];
    const matching = entries.find((entry) => entry.sha256 === item.sha256 && JSON.stringify(entry.members ?? []) === JSON.stringify(item.members ?? []));
    if (matching) continue;
    if (entries.length) baselineFailures.push(`legacy fingerprint drift: ${item.path} [${item.rule}] ${item.kind}`);
    else {
      baselineFailures.push(`new legacy finding: ${item.path} [${item.rule}] ${item.kind}`);
      unmatchedFindings.push(item);
    }
  }
  return { unmatchedFindings, baselineFailures };
}

export function reviewedBaselineMetadata(rule) {
  return {
    [WEB_BOUNDARY_RULES.DUPLICATE_SOURCE_GROUP]: ["기존 mobile viewport helper 두 파일은 동일한 legacy 구현이며 EAT-9 canonical shared extraction 전까지 동결합니다.", "mobile viewport helper를 하나의 shared module로 통합할 때"],
    [WEB_BOUNDARY_RULES.ID_NUMBER_CONVERSION]: ["기존 dashboard와 table filter의 numeric URL/filter 처리 부채는 canonical decimal ID route 전환 전까지 동결합니다.", "해당 화면이 contract-backed decimal identifier를 소비하도록 전환할 때"],
    [WEB_BOUNDARY_RULES.RAW_FETCH]: ["기존 Web 화면과 hook의 직접 network 호출은 legacy product surface이며 EAT-9 transport 전환 전까지 동결합니다.", "해당 endpoint consumer를 api/_transport와 resource adapter로 이전할 때"],
    [WEB_BOUNDARY_RULES.ROUTE_CLIENT_COMPONENT]: ["기존 dashboard route의 client page는 legacy presentation이며 RSC route decomposition 전까지 동결합니다.", "route lifecycle과 interactive leaf를 분리해 page/layout을 Server Component로 바꿀 때"],
    [WEB_BOUNDARY_RULES.SOURCE_FILE_SIZE]: ["기존 dashboard presentation file은 300줄을 넘는 legacy 책임 혼합이며 기능 전환과 함께 분리합니다.", "다음 기능 변경이 route model, UI leaf 또는 data adapter 책임을 함께 건드릴 때"],
    [WEB_BOUNDARY_RULES.UNCHECKED_JSON_CAST]: ["기존 Web response type assertion은 legacy wire 처리이며 contract runtime parsing 도입 전까지 동결합니다.", "해당 response를 operation schema가 parse하는 api resource로 이전할 때"],
    [WEB_BOUNDARY_RULES.UNCHECKED_RESPONSE_JSON]: ["기존 Web response body decode는 legacy network boundary이며 EAT-9 transport 전환 전까지 동결합니다.", "해당 response decode를 api/_transport의 validated request path로 이전할 때"],
  }[rule] ?? ["EAT-9 이전 Web boundary 부채를 canonical slice 전환까지 동결합니다.", "해당 legacy module을 canonical Web boundary로 전환할 때"];
}
