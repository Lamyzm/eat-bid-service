import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { OUTPUT, buildIndex, generate } from "./generate-source-field-index.mjs";
import {
  CENSUS_DETAIL,
  CENSUS_LIST,
  JUDGEMENT_DOCUMENT,
  headingAnchor,
  isNamePairOf,
  parseCensusKeys,
  parseContractDatasets,
  parseTraps,
} from "./source-field-index/sources.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n");

const censusFixture = `# census: files=7 bad=0

## 1. 데이터셋 (선언 = ColumnInfo 존재 / 행보유 = Row 1개 이상)

dataset                                     선언     선언%       행보유     행보유%          총행      평균행
ds_info                                      7  100.0%         7  100.00%           7     1.00

## 2. 키별 상세

채움% = 그 키가 존재하는 행 중 값이 비어있지 않은 비율

### ds_info

key                                     행     채움%       고유     순번%    우리  값 예시
SIGUNGU_CD                             7  100.0%      198      -     .  '714'×3 | '653'×2
SGG_CD                                 7   50.0%   12000+    0.0%     O  '080'×2

## 3. 코드 → 이름 함수성 (같은 데이터셋 안 접두어 쌍)

dataset.code → name                                                 코드수      이름다중      비율  예
ds_info.SGG_CD → SGG_NM                                              33        15   45.5%  010→['노원', '도봉']
`;

const ledgerFixture = `n=204,830

## 1. 코드 → 이름 / 이름 → 코드 (양방향)

블록.코드 → 이름                                                    코드수    fwd다중      이름수    rev다중    fwd정규    rev정규
ds_info.SGG_CD → SGG_NM                                        33       15      171        7       15        7
ds_info.SIGUNGU_CD → PURR_NM                                  198      198    7,233      383      198      383

### 역방향 충돌 예 (이름 하나에 코드 여럿) — 상위 6쌍

  ds_info.SGG_NM → SGG_CD: 이름 171개 중 7개가 코드 2개 이상
`;

const judgementFixture = `# 사전

## 1. 같은 이름 다른 어휘

### T3. \`SGG_CD\`는 세 곳에서 값 공간이 다르다

- 걸린 자리: \`ds_info.SGG_CD\`, \`ds_info.SIGUNGU_CD\`
- 근거: §8.4

본문에서 \`ds_other.FOO\`를 말해도 걸린 자리는 아니다.

## 2. 다음 절
`;

const contractFixture = `_COLUMNS = (
    "BID_CNT",
    "SGG_CD",
)

_DETAIL = ReviewedSchemaContract(
    datasets=MappingProxyType(
        {
            "ds_info": (
                *_COLUMNS,
                "SIGUNGU_CD",
            ),
        }
    ),
)
`;

test("census 키 표를 (dataset, 필드) 행으로 빠짐없이 읽는다", () => {
  const { rows, skipped } = parseCensusKeys(censusFixture);
  assert.equal(skipped.length, 0);
  assert.deepEqual(
    rows.map((row) => `${row.dataset}.${row.field}`),
    ["ds_info.SIGUNGU_CD", "ds_info.SGG_CD"],
  );
  assert.equal(rows[1].filledPercent, "50.0%");
  assert.equal(rows[1].distinct, "12000+");
  assert.equal(rows[0].sample, "'714'×3 | '653'×2");
});

test("실제 census 생성물의 키 줄을 하나도 못 읽고 넘기지 않는다", () => {
  for (const file of [CENSUS_DETAIL, CENSUS_LIST]) {
    const { rows, skipped } = parseCensusKeys(read(file));
    assert.equal(skipped.length, 0, `${file}에서 읽지 못한 줄이 있다`);
    assert.ok(rows.length > 0);
  }
});

test("검토된 응답 계약에서 dataset별 선언 column을 tuple 상수까지 펼쳐 읽는다", () => {
  const datasets = parseContractDatasets(contractFixture);
  assert.deepEqual([...datasets.get("ds_info")].sort(), ["BID_CNT", "SGG_CD", "SIGUNGU_CD"]);
});

test("이름 짝은 토큰이 겹칠 때만 인정하고 대조군 쌍은 거른다", () => {
  assert.equal(isNamePairOf("SGG_CD", "SGG_NM"), true);
  assert.equal(isNamePairOf("SPLR_CNPT_CD", "CNPT_NM"), true);
  assert.equal(isNamePairOf("SIGUNGU_CD", "PURR_NM"), false);
  assert.equal(isNamePairOf("SHIPPER_CD", "BIZ_NO"), false);
});

test("판정 문서의 함정 선언만 읽고 본문의 필드 이름은 걸린 자리로 보지 않는다", () => {
  const traps = parseTraps(judgementFixture);
  assert.equal(traps.length, 1);
  assert.equal(traps[0].id, "T3");
  assert.deepEqual(traps[0].targets, ["ds_info.SGG_CD", "ds_info.SIGUNGU_CD"]);
});

test("함정 링크 앵커는 밑줄을 남겨 GitHub heading 앵커와 같다", () => {
  assert.equal(headingAnchor("T3. `SGG_CD`는 세 곳"), "t3-sgg_cd는-세-곳");
});

test("색인은 필드 이름 순으로 나오고 코드 판정·파서 소비·함정을 함께 싣는다", () => {
  const { text, rowCount, skipped } = buildIndex({
    censusDetail: censusFixture,
    censusList: "# census: files=0 bad=0\n",
    keysLedger: ledgerFixture,
    judgement: judgementFixture,
    contractSource: contractFixture,
    parserSources: ['optional_text(row, "SIGUNGU_CD")'],
  });
  assert.equal(rowCount, 2);
  assert.equal(skipped.length, 0);
  const sgg = text.split("\n").find((line) => line.startsWith("| `SGG_CD` |"));
  const sigungu = text.split("\n").find((line) => line.startsWith("| `SIGUNGU_CD` |"));
  assert.ok(text.indexOf(sgg) < text.indexOf(sigungu), "필드 이름 알파벳순이어야 한다");
  assert.match(sgg, /이름다중 15\/33/u);
  assert.match(sgg, /계약/u, "계약에만 있고 파서가 안 읽는 column이다");
  assert.match(sigungu, /읽음/u, "파서가 문자열로 읽는 column이다");
  assert.match(sgg, /T3/u);
  assert.doesNotMatch(sigungu, /PURR_NM/u, "대조군 쌍은 색인에 싣지 않는다");
});

test("판정 문서가 선언한 함정은 전부 색인의 함정 대장에 옮겨진다", () => {
  const traps = parseTraps(read(JUDGEMENT_DOCUMENT));
  assert.ok(traps.length > 0, "판정 문서에 함정이 하나도 없다");
  const generated = read(OUTPUT);
  for (const trap of traps) {
    assert.ok(generated.includes(`#${trap.anchor}`), `${trap.id}의 앵커가 색인에 없다`);
  }
});

test("생성기를 두 번 돌려도 같은 결과를 낸다", () => {
  const first = generate({ write: false });
  const second = generate({ write: false });
  assert.equal(first.text, second.text);
  assert.equal(
    first.text,
    read(OUTPUT),
    "추적된 색인이 현재 입력과 어긋난다. `pnpm source-fields:write`로 다시 만들어라",
  );
});
