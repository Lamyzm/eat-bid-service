/**
 * @module 책임: 사용자 화면 글에 두지 않는 우리 연구·코드 말(금지 말 사전)과 질문형 문구 규칙, 옛 위반 목록의 자리를 소유한다.
 *
 * 사전의 권위는 `docs/product/ui-words.md` "쓰지 않는 말" 표다. 표에 줄을 더하면 여기에도 더한다. 규칙은 렌더된 문장이 아니라
 * 소스의 문자열·JSX 글을 보므로 주석은 대상이 아니다 — 주석은 왜 금지인지 말하려고 그 낱말을 쓸 수 있다.
 */
export const COPY_BASELINE_PATH = "tools/architecture/web-copy/baseline.json";

export const COPY_RULES = Object.freeze({
  FORBIDDEN_WORD: "copy-forbidden-word",
  QUESTION: "copy-question",
  SCREEN_WORD: "copy-screen-word",
});

/**
 * 한 화면에만 두지 않는 말이다. 넣을 공고는 값만 보인다 — 사장님이 사업장마다 eaT에 직접 넣으므로 복사·넘겨주기와 넣었다는
 * 완료 표시가 할 일이 없다(#241, PDR-0011 결정 4를 대체한 결정). 다른 화면(공고 상세의 복사 등)은 이 규칙의 대상이 아니다.
 * 옛 위반이 없는 규칙이라 기준 목록에 올리지 않는다.
 */
export const SCREEN_FORBIDDEN_WORDS = Object.freeze([
  Object.freeze({
    prefix: "apps/web/src/app/(workspace)/work/",
    words: Object.freeze(["복사", "넘겨", "완료", "넣었어요", "넣음"]),
    reason: "넣을 공고는 값만 보입니다. 복사·넘겨주기·완료 표시를 두지 않습니다(#241).",
  }),
]);

/** 그 화면 경로에서 쓰면 안 되는 말을 찾는다. 경로는 저장소 기준 `/` 구분자다. */
export function screenForbiddenWord(displayPath, text) {
  for (const scope of SCREEN_FORBIDDEN_WORDS) {
    if (!displayPath.startsWith(scope.prefix)) continue;
    const word = scope.words.find((candidate) => text.includes(candidate));
    if (word !== undefined) return { word, reason: scope.reason };
  }
  return undefined;
}

/** `ui-words.md` "쓰지 않는 말"의 낱말이다. 대신 쓸 말은 그 표가 소유한다. */
export const FORBIDDEN_WORDS = Object.freeze([
  "회차",
  "사정률",
  "맞춤",
  "표본",
  "무작위",
  "아침 갱신",
  "전국 공식",
  "참고로만",
  "운영자 전용",
  "검증",
  "기대 낙찰",
  "추천가",
  "추천 금액",
  "놓친 공고",
  "놓친 기회",
  "보장",
  "반드시",
]);

const FORBIDDEN_PATTERN = new RegExp(FORBIDDEN_WORDS.map((word) => word.replace(/\s+/gu, "\\s*")).join("|"), "u");
// 한글 문장 뒤의 물음표만 질문형으로 본다. 주소의 `?q=`나 코드 기호는 한글 뒤에 오지 않는다.
const QUESTION_PATTERN = /[가-힣][)"'」]?\s*[?？]/u;

export function forbiddenWord(text) {
  return FORBIDDEN_PATTERN.exec(text)?.[0];
}

export function isQuestion(text) {
  return QUESTION_PATTERN.test(text);
}
