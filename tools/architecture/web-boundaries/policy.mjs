/** @module 책임: Web boundary rule ID·허용 경로·legacy waiver metadata 정책을 선언한다. */
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
  MOTION_DURATION_LITERAL: "motion-duration-literal",
  MOTION_LOCAL_PRESS: "motion-local-press",
  MOTION_TRANSITION_ALL: "motion-transition-all",
  PAGE_CONTAINER_LOADING_STATE: "page-container-loading-state",
  RAW_FETCH: "raw-fetch",
  ROUTE_CLIENT_COMPONENT: "route-client-component",
  SHELL_BOUNDARY_IMPORT: "shell-boundary-import",
  SHARED_CONTROL_RESPONSIBILITY: "shared-control-responsibility",
  SOURCE_FILE_SIZE: "source-file-size",
  TRANSPORT_RUNTIME_CROSS_IMPORT: "transport-runtime-cross-import",
  UNCHECKED_JSON_CAST: "unchecked-json-cast",
  UNCHECKED_RESPONSE_BODY: "unchecked-response-body",
  UNCHECKED_RESPONSE_JSON: "unchecked-response-json",
  RESOURCE_TRANSPORT_IMPORT: "resource-transport-import",
  ROUTE_LOADING_BOUNDARY: "route-loading-boundary",
  WEB_API_DEEP_IMPORT: "web-api-deep-import",
});

export const MAX_SOURCE_LINES = 300;
export const MIN_DUPLICATE_NONBLANK_LINES = 10;
export const MIN_DUPLICATE_BYTES = 200;

export function normalizeBytes(contents) {
  return contents.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function codePointCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function physicalLineCount(contents) {
  const normalized = normalizeBytes(contents);
  return normalized ? normalized.replace(/\n$/, "").split("\n").length : 0;
}

export function normalizedPath(repoRoot, filename) {
  return path.relative(repoRoot, filename).replaceAll("\\", "/");
}

export function isTestOrFixture(file) {
  const normalized = file.replaceAll("\\", "/");
  return /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)__(?:tests?|fixtures?)__(?:\/|$)|(?:^|\/)fixtures?(?:\/|$))/i.test(normalized);
}

export function isTypeScriptSource(file) {
  return /\.[cm]?tsx?$/i.test(file) && !/\.d\.ts$/i.test(file);
}

export function sourceLayer(sourcePath) {
  const raw = sourcePath.replaceAll("\\", "/");
  const normalized = raw.endsWith("/") ? raw : `${raw}/`;
  // contracts나 다른 package의 src/api를 Web resource로 분류하지 않도록 Web root를 함께 고정한다.
  const match = normalized.match(/(?:^|\/)apps\/web\/src\/(shell|capabilities|api)(?:\/([^/]+))?\//);
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

export function isEndpointAuthorityPath(repoRoot, sourcePath) {
  return normalizedPath(repoRoot, sourcePath).startsWith("packages/contracts/src/api/");
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
      if (entry.contentSha256 && !/^sha256:[a-f0-9]{64}$/.test(entry.contentSha256)) baselineFailures.push(`legacy baseline entry ${index} has an invalid duplicate content fingerprint`);
    }
    return { baseline, baselineFailures };
  } catch (error) {
    return { baseline: { version: 1, entries: [] }, baselineFailures: [`cannot read legacy baseline: ${error.message}`] };
  }
}

export function applyLegacyBaseline(findings, baseline) {
  const baselineFailures = [];
  const entriesByKey = new Map();
  const availableExact = new Map();
  for (const entry of baseline.entries) {
    const key = baselineKey(entry);
    const entries = entriesByKey.get(key) ?? [];
    entries.push(entry);
    entriesByKey.set(key, entries);
    const exactKey = `${key}\u0000${entry.sha256}\u0000${JSON.stringify(entry.members ?? [])}`;
    const exactEntries = availableExact.get(exactKey) ?? [];
    exactEntries.push(entry);
    availableExact.set(exactKey, exactEntries);
  }
  const unmatchedFindings = [];
  const consumedDuplicateEntries = new Set();
  for (const item of findings) {
    if (item.rule === WEB_BOUNDARY_RULES.DUPLICATE_SOURCE_GROUP) {
      const candidates = baseline.entries.filter((entry) => entry.rule === item.rule && entry.contentSha256 === item.contentSha256 && !consumedDuplicateEntries.has(entry));
      const matching = candidates.find((entry) => item.members.every((member) => entry.members?.includes(member)));
      if (matching) {
        consumedDuplicateEntries.add(matching);
        continue;
      }
      const sameContent = baseline.entries.some((entry) => entry.rule === item.rule && entry.contentSha256 === item.contentSha256);
      baselineFailures.push(`${sameContent ? "legacy duplicate membership increase" : "legacy fingerprint drift"}: ${item.path} [${item.rule}] ${item.kind}`);
      unmatchedFindings.push(item);
      continue;
    }
    const entries = entriesByKey.get(baselineKey(item)) ?? [];
    const exactKey = `${baselineKey(item)}\u0000${item.sha256}\u0000${JSON.stringify(item.members ?? [])}`;
    const matching = availableExact.get(exactKey)?.shift();
    if (matching) continue;
    if (entries.some((entry) => entry.sha256 === item.sha256 && JSON.stringify(entry.members ?? []) === JSON.stringify(item.members ?? []))) {
      baselineFailures.push(`legacy fingerprint multiplicity increase: ${item.path} [${item.rule}] ${item.kind}`);
      unmatchedFindings.push(item);
    } else if (entries.length) baselineFailures.push(`legacy fingerprint drift: ${item.path} [${item.rule}] ${item.kind}`);
    else {
      baselineFailures.push(`new legacy finding: ${item.path} [${item.rule}] ${item.kind}`);
      unmatchedFindings.push(item);
    }
  }
  return { unmatchedFindings, baselineFailures };
}

export function reviewedBaselineMetadata(item) {
  if (item.rule === WEB_BOUNDARY_RULES.ROUTE_CLIENT_COMPONENT) {
    if (item.path.includes("/app/welcome/")) return ["기존 welcome page는 interactive legacy 안내 화면으로 client component를 사용합니다.", "다음 welcome interaction 변경에서 client leaf와 Server Component route로 분리할 때"];
    if (item.path.includes("/app/dashboard/")) return ["기존 dashboard page는 data/state와 presentation을 함께 가진 client route입니다.", "해당 dashboard route를 RSC model과 interactive client leaf로 전환할 때"];
  }
  if (item.rule === WEB_BOUNDARY_RULES.SOURCE_FILE_SIZE) {
    if (item.path.endsWith("/lib/region-coords.ts")) return ["기존 지역 좌표 lookup은 생성·보정된 지리 데이터 목록이며 dashboard presentation이 아닙니다.", "좌표 source/provenance contract 또는 generated lookup pipeline을 도입해 데이터를 분리할 때"];
    if (item.path.includes("/components/ui/")) return ["기존 UI composite primitive는 vendor-style presentation과 compatibility surface를 함께 포함합니다.", "다음 primitive behavior 변경에서 focused UI modules로 분리할 때"];
    if (item.path.includes("/app/dashboard/")) return ["기존 dashboard route는 data preparation과 presentation을 함께 가진 legacy 화면입니다.", "해당 route를 RSC model과 route-private UI leaf로 전환할 때"];
    if (item.path.includes("/app/welcome/")) return ["기존 welcome route는 안내 presentation을 한 파일에 보유한 legacy 화면입니다.", "다음 welcome content 또는 interaction 변경에서 section UI로 분리할 때"];
  }
  return {
    [WEB_BOUNDARY_RULES.DUPLICATE_SOURCE_GROUP]: ["기존 mobile viewport helper 두 파일은 동일한 legacy 구현이며 EAT-9 canonical shared extraction 전까지 동결합니다.", "mobile viewport helper를 하나의 shared module로 통합할 때"],
    [WEB_BOUNDARY_RULES.ID_NUMBER_CONVERSION]: ["기존 dashboard와 table filter의 numeric URL/filter 처리 부채는 canonical decimal ID route 전환 전까지 동결합니다.", "해당 화면이 contract-backed decimal identifier를 소비하도록 전환할 때"],
    [WEB_BOUNDARY_RULES.PAGE_CONTAINER_LOADING_STATE]: ["기존 PageContainer는 범용 loading UI를 소유한 legacy 화면 container이며 신규 route로 전파하지 않습니다.", "각 legacy 화면을 route 소유 ScreenSkeleton과 loading.tsx 경계로 전환할 때"],
    [WEB_BOUNDARY_RULES.RAW_FETCH]: ["기존 Web 화면·component·hook의 직접 network 호출은 legacy product surface이며 EAT-9 transport 전환 전까지 동결합니다.", "해당 endpoint consumer를 api/_transport와 resource adapter로 이전할 때"],
    [WEB_BOUNDARY_RULES.ROUTE_CLIENT_COMPONENT]: ["기존 Web route의 client component 경계는 EAT-9 이전 legacy presentation입니다.", "route lifecycle과 interactive leaf를 분리해 page/layout을 Server Component로 바꿀 때"],
    [WEB_BOUNDARY_RULES.SOURCE_FILE_SIZE]: ["기존 dashboard presentation file은 300줄을 넘는 legacy 책임 혼합이며 기능 전환과 함께 분리합니다.", "다음 기능 변경이 route model, UI leaf 또는 data adapter 책임을 함께 건드릴 때"],
    [WEB_BOUNDARY_RULES.UNCHECKED_JSON_CAST]: ["기존 Web response type assertion은 legacy wire 처리이며 contract runtime parsing 도입 전까지 동결합니다.", "해당 response를 operation schema가 parse하는 api resource로 이전할 때"],
    [WEB_BOUNDARY_RULES.UNCHECKED_RESPONSE_JSON]: ["기존 Web response body decode는 legacy network boundary이며 EAT-9 transport 전환 전까지 동결합니다.", "해당 response decode를 api/_transport의 validated request path로 이전할 때"],
  }[item.rule] ?? ["EAT-9 이전 Web boundary 부채를 canonical slice 전환까지 동결합니다.", "해당 legacy module을 canonical Web boundary로 전환할 때"];
}
