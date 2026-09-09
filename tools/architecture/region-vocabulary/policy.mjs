/** @module 책임: 지역 어휘 재선언 규칙의 판정 기준과 선언 권위 읽기를 소유하며 예외 목록은 두지 않는다. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// 규칙은 지역 이름 목록이 아니라 **구조**를 본다. 이 파일이 시도·시군구 이름을 들고 있으면 그 자체가
// 어휘의 재선언이고, 정부 코드가 개편될 때마다 린트를 고쳐야 한다(설계 §5-D11).
export const REGION_VOCABULARY_RULES = {
  NAME_COMPOSED_KEY: "name-composed-key",
  SCHEME_LITERAL_REDECLARED: "scheme-literal-redeclared",
  REGION_NAME_COMPARISON: "region-name-comparison",
  COORDINATE_TABLE_REDECLARED: "coordinate-table-redeclared",
  CROSS_SCHEME_JOIN: "cross-scheme-join",
};

// 식별자 이름 규약이다. 이 규약을 피해 이름을 지으면 규칙이 보지 못한다는 사실은 설계 §8-5가 적었다.
export const REGION_IDENTIFIER_PATTERN = /sido|sigungu|region/i;

// 체계 이름과 코드 식별자를 가리키는 이름은 지역 **이름**이 아니다. 두 축을 섞으면
// `regionScheme === ...`이나 `regionCodeValueId === ...` 같은 정당한 비교가 이름 비교로 잘못 잡히고,
// 규칙이 권장하는 바로 그 형태를 규칙이 막게 된다.
const CODE_IDENTITY_PATTERN = /scheme|code|id$/i;

// 좌표표로 판정하는 최소 항목 수다. 이보다 적은 목록은 표가 아니라 개별 상수일 수 있다.
export const MIN_COORDINATE_TABLE_ENTRIES = 8;

const COORDINATE_KEY_GROUPS = [
  ["latitude", "longitude"],
  ["lat", "lng"],
  ["lat", "lon"],
];

export function codePointCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizedPath(root, file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

export function isTypeScriptSource(file) {
  return /\.(?:ts|tsx|mts|cts)$/.test(file) && !file.endsWith(".d.ts");
}

export function isTestOrFixture(file) {
  const normalized = file.replaceAll("\\", "/");
  return /\.(?:test|spec)\.[cm]?tsx?$/.test(normalized)
    || /(?:^|\/)(?:__fixtures__|__tests__|__mocks__|e2e|tests?)\//.test(normalized)
    || /(?:^|\/)[^/]*\.fixture\.[cm]?tsx?$/.test(normalized);
}

/**
 * 체계 이름의 권위는 `packages/db/src/seeds/code-schemes.ts` 하나다. 린트가 목록을 따로 들면 선언이
 * 둘이 되므로 권위 파일에서 읽어 온다. 읽지 못하면 목록을 지어내지 않고 빈 집합으로 실패를 드러낸다.
 */
export function readDeclaredSchemeNames(repoRoot) {
  const authority = path.join(repoRoot, "packages", "db", "src", "seeds", "code-schemes.ts");
  if (!existsSync(authority)) return { schemes: new Set(), failures: ["code scheme seed authority is missing"] };
  const source = readFileSync(authority, "utf8");
  const schemes = new Set();
  for (const match of source.matchAll(/namespace:\s*"([^"\\]+)"/g)) schemes.add(match[1]);
  return {
    schemes,
    failures: schemes.size ? [] : ["code scheme seed authority declares no namespace"],
  };
}

/**
 * 체계 이름을 선언해도 되는 곳이다. 권위 seed와 계약 atom, 그리고 그 둘의 동치를 고정하는 검사 도구뿐이며
 * 화면·서버·어댑터는 참조만 한다(PDR-0001 "선언은 한 곳이고 나머지는 전부 참조").
 */
const SCHEME_SEED_PATH = "packages/db/src/seeds/code-schemes.ts";
const SCHEME_ATOM_PATH = "packages/contracts/src/atoms/code-scheme-names.ts";
const SCHEME_DECLARATION_PATHS = new Set([SCHEME_SEED_PATH, SCHEME_ATOM_PATH]);

export function isSchemeDeclarationPath(relativePath) {
  return SCHEME_DECLARATION_PATHS.has(relativePath);
}

/**
 * 계약 atom은 seed가 선언한 이름만 열 수 있다. 두 선언이 갈라지면 화면은 존재하지 않는 체계를 참조하고
 * 그 사실이 실행 전까지 드러나지 않으므로, 여기서 이름 집합의 포함 관계를 고정한다.
 */
export function schemeAtomFailures(repoRoot, schemes) {
  const atom = path.join(repoRoot, ...SCHEME_ATOM_PATH.split("/"));
  if (!existsSync(atom)) return [];
  const failures = [];
  for (const match of readFileSync(atom, "utf8").matchAll(/"([a-z0-9-]+:[a-z0-9-]+)"/g)) {
    if (!schemes.has(match[1])) failures.push(`contract atom declares a code scheme the seed does not: ${match[1]}`);
  }
  return failures;
}

export function isRegionIdentifierName(name) {
  return typeof name === "string"
    && REGION_IDENTIFIER_PATTERN.test(name)
    && !CODE_IDENTITY_PATTERN.test(name);
}

export function isObservedNameMember(name) {
  return name === "name" || name === "label";
}

export function coordinateKeysOf(keys) {
  const lowered = new Set([...keys].map((key) => key.toLowerCase()));
  return COORDINATE_KEY_GROUPS.some((group) => group.every((key) => lowered.has(key)));
}
