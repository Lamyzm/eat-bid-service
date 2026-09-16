/**
 * @module 책임: 여러 모듈의 질의가 공유하는 PostgreSQL 파라미터 표현 규칙을 소유한다.
 *
 * 모듈끼리 내부 계층을 import하지 않는다는 정책은 그대로이며 이 파일은 모듈이 아니라 platform이라
 * 어느 모듈의 어댑터든 쓴다(`platform/http/wire.ts`와 같은 자리).
 */

/**
 * bigint 목록을 PostgreSQL 배열 파라미터 하나로 옮긴다.
 *
 * driver가 JS 배열을 값 하나로 접어 `malformed array literal`로 죽기 때문에 배열 리터럴을 직접 만든다.
 * 원소가 십진 bigint의 `toString(10)`뿐이라 이 조립에는 주입 표면이 없다. 빈 목록은 `{}`이고 그 배열과는
 * 어떤 행도 매칭되지 않는다 — 그것이 "고른 것이 없다"의 올바른 결과이지 오류가 아니다.
 */
export function bigintArrayLiteral(values: readonly bigint[]): string {
  return `{${values.map((value) => value.toString(10)).join(",")}}`;
}

/**
 * 문자열 목록을 PostgreSQL 배열 파라미터 하나로 옮긴다.
 *
 * bigint와 달리 원소가 사용자 입력이라 배열 리터럴을 손으로 이어 붙이면 `,`·`"`·`\`·`{`가 구분자로
 * 읽혀 원소 경계가 밀린다. 그래서 원소마다 큰따옴표로 감싸고 `\`와 `"`만 escape한다 — PostgreSQL
 * 배열 리터럴이 요구하는 것이 그 둘뿐이다. 빈 목록은 `{}`이고 어떤 행과도 매칭되지 않는다.
 */
export function textArrayLiteral(values: readonly string[]): string {
  const quoted = values.map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`);
  return `{${quoted.join(",")}}`;
}
