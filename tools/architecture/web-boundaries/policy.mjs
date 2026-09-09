/** @module 책임: Web boundary rule ID·허용 경로·변경 범위에서만 판정하는 legacy 규칙 집합의 정책을 선언한다. */
import path from "node:path";

export const WEB_BOUNDARY_RULES = Object.freeze({
  API_ENDPOINT_LITERAL: "api-endpoint-literal",
  API_RESOURCE_CROSS_IMPORT: "api-resource-cross-import",
  CAPABILITY_INTERNAL_IMPORT: "capability-internal-import",
  CLIENT_VALUE_EXPORT_IMPORT: "client-value-export-import",
  LEGACY_HOOKS_DIRECTORY: "legacy-hooks-directory",
  LEGACY_IDENTITY_ROUTE: "legacy-identity-route",
  LEGACY_LIB_DIRECTORY: "legacy-lib-directory",
  LEGACY_IMPORT: "legacy-import",
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
  USE_CACHE_PLACEMENT: "use-cache-placement",
  USE_CACHE_USER_DATA: "use-cache-user-data",
  UNCHECKED_RESPONSE_BODY: "unchecked-response-body",
  UNCHECKED_RESPONSE_JSON: "unchecked-response-json",
  RESOURCE_TRANSPORT_IMPORT: "resource-transport-import",
  ROUTE_LOADING_BOUNDARY: "route-loading-boundary",
  WEB_API_DEEP_IMPORT: "web-api-deep-import",
});

// legacy 위치·역참조 규칙은 "신규 파일을 받지 않고 새 edge를 만들지 않는다"는 규칙이므로 merge-base 이후
// 변경된 파일에만 판정한다. 건드리지 않은 스타터 잔재는 보고하지 않고, 수정하는 순간 옮겨야 한다(ADR 0042).
// 나머지 규칙은 파일이 언제 생겼든 예외 없이 판정한다.
export const CHANGE_SCOPED_RULES = Object.freeze(
  new Set([
    WEB_BOUNDARY_RULES.LEGACY_IMPORT,
    WEB_BOUNDARY_RULES.LEGACY_HOOKS_DIRECTORY,
    WEB_BOUNDARY_RULES.LEGACY_LIB_DIRECTORY,
  ]),
);

export const MAX_SOURCE_LINES = 300;
export const MIN_DUPLICATE_NONBLANK_LINES = 10;
export const MIN_DUPLICATE_BYTES = 200;

// legacy는 폴더를 옮기지 않고 import 방향으로만 격리한다. 신규 층이 스타터 수평 폴더를 다시 참조하면
// 폴더 이동만으로 target-compliant처럼 보이는 상태가 되므로 여기서 역참조를 끊는다.
// legacy route-private module(dashboard·welcome·s)도 canonical 층이 끌어다 쓰면 같은 역참조다.
const CANONICAL_LAYER_PATH = /^apps\/web\/src\/(?:app\/\((?:workspace|auth)\)|shell|capabilities|api|shared|routing)\//;
const LEGACY_DIRECTORY_SPECIFIER = /^@\/(?:components|hooks|lib|config|types|app\/(?:dashboard|welcome|s))(?:\/|$)/;
const LEGACY_DIRECTORY_PATH = /^apps\/web\/src\/(?:components|hooks|lib|config|types|app\/(?:dashboard|welcome|s))\//;

export function isCanonicalLayerPath(displayPath) {
  return CANONICAL_LAYER_PATH.test(displayPath);
}

export function isLegacyDirectoryReference(specifier, targetDisplayPath) {
  return LEGACY_DIRECTORY_SPECIFIER.test(specifier.replaceAll("\\", "/"))
    || (targetDisplayPath !== undefined && LEGACY_DIRECTORY_PATH.test(targetDisplayPath));
}

// generic hook의 목적지는 shared/lib/hooks, generic helper는 shared/lib, 그 외는 소비하는 route/capability 내부다.
// 스타터 잔재 hooks/·lib/ 디렉터리는 새 파일을 받지 않으며, 기존 파일도 수정하는 변경에서 함께 옮긴다.
const LEGACY_HOOKS_PATH = /^apps\/web\/src\/hooks\//;
const LEGACY_LIB_PATH = /^apps\/web\/src\/lib\//;
// routing 층은 canonical decimal ID route만 만든다. 복합 문자열 identity를 쓰는 legacy dashboard route
// builder는 canonical 층에 들어올 수 없다.
const LEGACY_IDENTITY_SCOPE = /^apps\/web\/src\/(?:routing\/|app\/(?:.+\/)?_lib\/)/;
const LEGACY_ROUTE_PREFIX = /^\/dashboard(?:\/|$)/;

export function isLegacyHooksPath(displayPath) {
  return LEGACY_HOOKS_PATH.test(displayPath);
}

export function isLegacyLibPath(displayPath) {
  return LEGACY_LIB_PATH.test(displayPath);
}

export function isLegacyIdentityScope(displayPath) {
  return LEGACY_IDENTITY_SCOPE.test(displayPath);
}

export function isLegacyRouteLiteral(text) {
  return LEGACY_ROUTE_PREFIX.test(text);
}

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

// ADR 0028-4는 `use cache`를 api resource의 server entry read 함수에만 허용한다. 태그를 만들고
// 지우는 소유자가 그 파일이므로 다른 층이 캐시 경계를 열면 태그 어휘가 흩어진다.
const CACHE_OWNER_PATH = /^apps\/web\/src\/api\/[^/]+\/server\.[cm]?tsx?$/;

export function isCacheOwnerPath(displayPath) {
  return CACHE_OWNER_PATH.test(displayPath);
}

export function isEndpointAuthorityPath(repoRoot, sourcePath) {
  return normalizedPath(repoRoot, sourcePath).startsWith("packages/contracts/src/api/");
}
