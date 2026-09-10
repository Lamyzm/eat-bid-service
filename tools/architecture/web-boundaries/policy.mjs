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
  FEATURE_LIB_REACT: "feature-lib-react",
  FEATURE_MODEL_JSX: "feature-model-jsx",
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
  UI_NON_RENDER_MODULE: "ui-non-render-module",
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
// segment 슬라이스 세 규칙도 같은 기준이다. ADR 0044-5가 기존 화면을 전면 이동이 아니라 건드리는 변경에서
// 옮긴다고 정했으므로, 아직 옮기지 않은 화면의 `_ui`를 지금 실패로 만들지 않고 손대는 순간 판정한다.
// 나머지 규칙은 파일이 언제 생겼든 예외 없이 판정한다.
export const CHANGE_SCOPED_RULES = Object.freeze(
  new Set([
    WEB_BOUNDARY_RULES.LEGACY_IMPORT,
    WEB_BOUNDARY_RULES.LEGACY_HOOKS_DIRECTORY,
    WEB_BOUNDARY_RULES.LEGACY_LIB_DIRECTORY,
    WEB_BOUNDARY_RULES.FEATURE_LIB_REACT,
    WEB_BOUNDARY_RULES.FEATURE_MODEL_JSX,
    WEB_BOUNDARY_RULES.UI_NON_RENDER_MODULE,
  ]),
);

export const MAX_SOURCE_LINES = 300;
export const MIN_DUPLICATE_NONBLANK_LINES = 10;
export const MIN_DUPLICATE_BYTES = 200;

// legacy는 폴더를 옮기지 않고 import 방향으로만 격리한다. 신규 층이 스타터 수평 폴더를 다시 참조하면
// 폴더 이동만으로 target-compliant처럼 보이는 상태가 되므로 여기서 역참조를 끊는다.
// legacy route-private module(dashboard·welcome·s)도 canonical 층이 끌어다 쓰면 같은 역참조다.
const CANONICAL_LAYER_PATH = /^apps\/web\/src\/(?:app\/\((?:workspace|auth)\)|shell|capabilities|entities|api|shared|routing)\//;
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

// ADR 0044는 route segment 안을 파일 유형이 아니라 변경 단위로 나눈다. 세 자리의 역할이 다르므로 경로로
// 판정한다. lib은 React를 모르는 순수 함수, model은 JSX를 만들지 않는 상태·표시 변환, ui는 렌더링이다.
// 이 규칙이 없으면 계산 모듈이 다시 표현 폴더에 쌓이고(ADR 0044 Context) 슬라이스 경계가 이름만 남는다.
const SEGMENT_FEATURE_LIB_PATH = /^apps\/web\/src\/app\/.+\/_features\/[^/]+\/lib\//;
const SEGMENT_FEATURE_MODEL_PATH = /^apps\/web\/src\/app\/.+\/_features\/[^/]+\/model\//;
const SEGMENT_RENDER_PATH = /^apps\/web\/src\/app\/.+\/(?:_ui|_features\/[^/]+\/ui)\//;
// React runtime과 그 하위 entry를 함께 막는다. 순수 함수 자리에는 hook도 type도 들어오지 않는다.
const REACT_MODULE_SPECIFIER = /^react(?:-dom)?(?:\/|$)/;

export function isSegmentFeatureLibPath(displayPath) {
  return SEGMENT_FEATURE_LIB_PATH.test(displayPath);
}

export function isSegmentFeatureModelPath(displayPath) {
  return SEGMENT_FEATURE_MODEL_PATH.test(displayPath);
}

export function isSegmentRenderPath(displayPath) {
  return SEGMENT_RENDER_PATH.test(displayPath);
}

export function isReactModuleSpecifier(specifier) {
  return REACT_MODULE_SPECIFIER.test(specifier.replaceAll("\\", "/"));
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
