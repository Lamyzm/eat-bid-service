/**
 * 결정 화면 문구가 판단을 대신하거나 NeaT 입력을 시키는지 문장 단위로 검사하는 테스트 도우미다.
 *
 * 단어 하나로 판정하면 두 방향으로 틀린다. "NeaT에 넣는 투찰률과 분모가 다릅니다"처럼 잘못된 숫자를 옮겨 적지
 * 말라는 경고(PDR-0004)를 잡고, "이 값으로 넣으세요"처럼 단어를 피한 유도는 놓친다. 그래서 금지 대상은 단어가
 * 아니라 행위를 유도하거나 판단을 대신하는 문형이다(AGENTS 8, EAT-156).
 */

export type BannedCopyRule = {
  readonly name: string;
  readonly pattern: RegExp;
};

export type BannedCopyMatch = {
  readonly rule: string;
  readonly phrase: string;
  /** 잡힌 문형의 앞뒤 문맥. 실패 출력에서 어느 문장인지 바로 보이게 한다. */
  readonly context: string;
};

// 명령·의무·조건형 어미. 관형형(넣는·넣을)과 과거 가정(넣었다면)은 사실 서술이라 여기 없다.
const DIRECTIVE_ENDING = String.raw`(?:으세요|세요|으십시오|십시오|시면|셔야|어야|아야|해야|으면|면|어라|아라|해라|어\s*두|어\s*주|해\s*두|해\s*주|어도|아도|해도)`;
// 값을 어딘가에 넣는 동사의 어간. 하다 동사는 어미가 붙는 두 어간을 모두 둔다.
const ENTRY_VERB = String.raw`(?:넣|입력하|입력해|옮기|옮겨|적|쓰|써|내|제출하|제출해|투찰하|투찰해)`;
// 화면이 가리킬 수 있는 값의 이름.
const VALUE_NOUN = String.raw`(?:값|율|투찰률|투찰가|금액|가격|숫자|수치)`;
// 값 이름에 자리를 더한 것. "추천 구간"처럼 값 대신 자리를 권하는 문형도 같은 판단 대행이다.
const VALUE_OR_ZONE_NOUN = String.raw`(?:값|율|투찰률|투찰가|금액|가격|숫자|수치|구간|자리|칸|범위)`;

const rule = (name: string, source: string): BannedCopyRule => ({
  name,
  pattern: new RegExp(source, 'gu')
});

export const BANNED_COPY_RULES: readonly BannedCopyRule[] = [
  // NeaT에 넣으라고 시키는 문형. 화면이 NeaT 입력을 대신하는 것으로 읽힌다(AGENTS 8, apps/web/AGENTS.md 제품 경계).
  // 관형형 "NeaT에 넣는 투찰률"은 무엇이 다른지 말하는 경고라 통과한다.
  rule(
    'NeaT 입력 지시',
    String.raw`NeaT\s*(?:에|에서|으로|로)\s*(?:그대로\s*)?(?:옮겨\s*)?${ENTRY_VERB}${DIRECTIVE_ENDING}`
  ),
  // "NeaT 입력값"처럼 NeaT에 넣을 값을 화면이 이름 붙여 제시하는 문형. 값을 보이는 순간 그것이 입력값이 된다.
  rule('NeaT 입력값 제시', String.raw`NeaT\s*(?:에\s*)?(?:넣을|입력할|입력)\s*${VALUE_NOUN}`),
  // 특정 값을 가리키며 그 값으로 넣으라·투찰하라·쓰라고 시키는 문형. 어느 값인지 화면이 정한 것이다.
  // "이 값이면"은 손잡이 값을 가리키는 제목이라 통과한다. 사용자 값이 주어인 과거 가정("썼다면")은 아래 규칙이 잡는다.
  rule(
    '값 지목 지시',
    String.raw`(?:이|그|저|해당)\s*${VALUE_NOUN}\s*(?:으로|로|을|를|대로)\s*(?:그대로\s*)?(?:옮겨\s*)?${ENTRY_VERB}${DIRECTIVE_ENDING}`
  ),
  // 추천·권장·적정·최적은 판단 대행 어휘다. "추천값"·"추천합니다"와 제목·칩에 홀로 선 "추천"(다음 글자가 한글
  // 음절이 아닐 때)은 잡고, "추천하지 않습니다"처럼 어미가 이어지는 부정문은 통과한다.
  rule(
    '추천 어휘',
    String.raw`(?:추천|권장)(?![가-힣])|(?:추천|권장)(?:합니다|해요|드립니다|드려요)|(?:추천|권장|적정|최적)(?:하는|할|된|되는)?\s*(?:가(?!능)|${VALUE_OR_ZONE_NOUN})`
  ),
  // 어떤 값·자리가 안전하다·무난하다·유리하다는 단정. 예측 없이는 할 수 없는 말이다(AGENTS 8).
  rule(
    '안전 단정',
    String.raw`안전\s*(?:구간|권|선|지대|영역|범위)|(?:안전|무난|유리)(?:합니다|해요|하다|한|함|해서|하니|하므로|할)`
  ),
  // 탈락선·탈락 구간과 "탈락합니다" 같은 현재·미래 단정. 소스 판정 코드에 없는 판정어를 화면이 만드는 것이다(PDR-0002).
  rule(
    '탈락 예측',
    String.raw`탈락\s*(?:선|권|구간|지대|영역)|탈락(?:합니다|됩니다|입니다|할\s*(?:것|겁니다)|될\s*(?:것|겁니다))`
  ),
  // "밀림"·"밀립니다"는 이 값이면 밀려난다는 예측이다.
  rule(
    '밀림 예측',
    String.raw`밀림|밀린다|밀립니다|밀려난다|밀려납니다|밀릴\s*(?:것|겁니다|수)|밀려날\s*(?:것|겁니다|수)`
  ),
  // "여기가 안전합니다"·"이 근처면 됩니다"처럼 자리를 가리켜 충분하다고 단정하는 문형. PDR-0004가 기각한
  // "이 근처면 된다"는 추천 그 자체다. 낙찰은 확정형("낙찰됩니다"·"낙찰될 것")만 잡는다. 예측 승률은 판단
  // 재료로 경계 안에 있으므로(ADR 0027) "낙찰될 확률"은 통과한다.
  rule(
    '자리 단정',
    String.raw`(?:여기|이\s*근처|그\s*근처|이\s*부근|이\s*정도|이쯤|여기쯤|이\s*자리|이\s*칸|이\s*값|그\s*값)\s*(?:가|이|는|은|면|이면|라면|정도면|쯤이면)\s*(?:됩니다|된다|돼요|충분|넉넉|안전|무난|유리|낙찰됩니다|낙찰된다|낙찰될\s*(?:것|겁니다))`
  ),
  // 사용자 값이 주어인 반사실 서술. "이 값을 그때 썼다면 N회 낙찰"은 내가 들어가 명단이 달라진 세계를 센 수인데
  // 그 세계는 관측한 적이 없다(단독입찰 허용안함 29/30, AGENTS 3, EAT-236). 주어는 과거 회차여야 한다
  // ("낙찰값이 이 값 이상이었던 회차").
  rule('반사실 주어', String.raw`(?:썼|냈|넣었|했)다면|(?:였|았|었)을\s*(?:회차|경우|때)|기대\s*낙찰`)
];

const CONTEXT_RADIUS = 24;

/**
 * 태그를 공백 하나로 바꾼 본문. 강조 태그로 쪼개진 문장(`<b>NeaT</b>에 넣으세요`)도 한 문장으로 보되, 블록 경계는
 * 공백으로 남겨 다른 문단의 끝과 시작이 한 문장으로 붙지 않게 한다.
 */
function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/gu, ' ');
}

/**
 * 보이는 markup에서 금지 문형을 모두 찾는다. 빈 배열이면 통과다. 숨긴 본문(`hidden`)을 걷어내는 일은 호출자의
 * 몫이다. 태그로 쪼개진 문장은 본문 텍스트에서, placeholder·aria-label 같은 속성 문구는 markup 원문에서 잡는다.
 */
export function findBannedCopy(markup: string): readonly BannedCopyMatch[] {
  const matches: BannedCopyMatch[] = [];
  const seen = new Set<string>();
  // 본문 텍스트를 먼저 봐야 같은 문구의 문맥이 태그 없이 남는다.
  for (const source of [textOf(markup), markup]) {
    for (const { name, pattern } of BANNED_COPY_RULES) {
      for (const found of source.matchAll(pattern)) {
        const phrase = found[0];
        const key = `${name}::${phrase}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const start = found.index ?? 0;
        matches.push({
          rule: name,
          phrase,
          context: source
            .slice(Math.max(0, start - CONTEXT_RADIUS), start + phrase.length + CONTEXT_RADIUS)
            .trim()
        });
      }
    }
  }
  return matches;
}
