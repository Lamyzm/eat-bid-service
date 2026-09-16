/** @module 책임: 결정 화면이 화면 문자열에 두면 안 되는 판단 대행·반사실 어휘의 규칙 목록과 검사 대상 파일 판별을 소유한다. */
import path from "node:path";

/**
 * `docs/product/decision-support.md` §9 금지 목록과 EAT-236의 반사실 주어 규칙이다. 규칙은 렌더된 문장이 아니라
 * 소스의 문자열·JSX 텍스트를 보므로 주석은 대상이 아니다 — 주석은 왜 금지인지 설명하려고 그 낱말을 쓸 수 있다.
 * "이 값이면"은 손잡이 값을 가리키는 제목이라 홀로 서면 통과하고, 그 뒤에 낙찰 횟수가 붙는 문형만 잡는다.
 */
export const DECISION_VOCABULARY_RULES = Object.freeze([
  { rule: "expected-award", pattern: /기대\s*낙찰/u, reason: "`기대낙찰`은 금지 어휘다(decision-support §9)." },
  {
    rule: "counterfactual-award-count",
    pattern: /이\s*값이면\s*\d+\s*회\s*낙찰/u,
    reason: "`이 값이면 N회 낙찰`은 내가 들어가 명단이 달라진 세계를 센 수다(decision-support §9, EAT-236).",
  },
  {
    rule: "counterfactual-subject",
    pattern: /(?:썼|냈|넣었|했)다면|(?:였|았|었)을\s*(?:회차|경우|때)/u,
    reason: "사용자 값이 주어인 반사실 서술이다. 주어는 과거 회차여야 한다(EAT-236).",
  },
  {
    rule: "recommendation",
    pattern: /추천\s*(?:범위|값|가|구간)|안전\s*구간|적정\s*구간|유리한\s*구간|잘\s*나온\s*구간|AI\s*정답|낙찰\s*가능성/u,
    reason: "추천·안전·적정 구간과 낙찰 가능성은 판단 대행 어휘다(decision-support §9, AGENTS 8).",
  },
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

export function isTypeScriptSource(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath)) && !filePath.endsWith(".d.ts");
}

/** 시험과 fixture는 금지 문구를 반례로 적어야 하므로 대상이 아니다. */
export function isTestOrFixture(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return /\.(?:test|spec)\.[cm]?tsx?$/u.test(normalized) || /\/__fixtures__\//u.test(normalized) || /\/e2e\//u.test(normalized);
}

export function normalizedPath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}
