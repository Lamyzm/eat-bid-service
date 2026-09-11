/** @module 책임: 읽어 들인 감사 자료와 파서 소비를 (dataset, 필드) 색인 문서 한 장으로 배치하고 추적 생성물에 쓴다. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CENSUS_DETAIL,
  CENSUS_LIST,
  JUDGEMENT_DOCUMENT,
  KEYS_LEDGER,
  PARSER_DIRECTORY,
  SCHEMA_CONTRACT_FILE,
  collectParserUsage,
  isNamePairOf,
  parseBidirectional,
  parseCensusDatasets,
  parseCensusKeys,
  parseCensusScale,
  parseCodeNamePairs,
  parseLedgerScale,
  parseTraps,
} from "./source-field-index/sources.mjs";

const root = process.env.SOURCE_FIELD_INDEX_ROOT
  ? path.resolve(process.env.SOURCE_FIELD_INDEX_ROOT)
  : fileURLToPath(new URL("../../", import.meta.url));

export const OUTPUT = "docs/audit-source/generated/source-field-index.md";

const readText = (file) => readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n");
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/** 표 칸에 그대로 실을 수 없는 문자만 막는다. 값 예시의 `|`는 census가 예시 구분자로 쓰는 문자다. */
function cell(text) {
  return text.replaceAll("|", "\\|").trim();
}

function usageMark({ dataset, field, declared, read }) {
  if (!declared.get(dataset)?.has(field)) return "·";
  return read.has(field) ? "읽음" : "계약";
}

/** 코드 판정 칸은 census §3과 keys-ledger §1이 잰 수치만 옮긴다. 코드인지 아닌지는 판정 문서가 가른다. */
function codeVerdict({ dataset, field, pairs, bidirectional }) {
  const forward = pairs.filter(
    (pair) => pair.dataset === dataset && pair.field === field && isNamePairOf(field, pair.nameField),
  );
  const reverse = bidirectional.filter(
    (row) => row.dataset === dataset && row.field === field && isNamePairOf(field, row.nameField),
  );
  const names = [...new Set([...forward, ...reverse].map((item) => item.nameField))].sort(compare);
  const parts = [];
  for (const name of names) {
    const pair = forward.find((item) => item.nameField === name);
    const row = reverse.find((item) => item.nameField === name);
    const measures = [];
    if (pair) measures.push(`이름다중 ${pair.multiNameCount}/${pair.codeCount}`);
    else if (row) measures.push(`이름다중 ${row.forwardMulti}/${row.codeCount}`);
    if (row && row.forwardNormalized !== row.forwardMulti) measures.push(`정규화 ${row.forwardNormalized}`);
    if (row) measures.push(`역 ${row.reverseMulti}/${row.nameCount}`);
    parts.push(`→\`${name}\` ${measures.join(" · ")}`);
  }
  return parts.join(" · ");
}

function header({ censusDetail, censusList, keysLedger }) {
  return [
    "<!-- 생성물이다. 직접 편집하지 않고 `pnpm source-fields:write`로 다시 만든다. -->",
    "# 소스 필드 색인 (생성물)",
    "",
    "필드 이름 하나로 그 필드가 어느 dataset에 있고 얼마나 채워지며 코드로 써도 되는지, 우리가 읽는지를 찾는 표다.",
    "**판단은 여기 없다.** 같은 이름 다른 어휘 같은 함정은 [`docs/audit-source/SOURCE-FIELDS.md`](../SOURCE-FIELDS.md)가 소유하고,",
    "이 표의 `함정` 칸이 그 항목을 가리킨다. 이 파일의 숫자는 전부 기계 생성물에서 옮겨진 것이라 손으로 고치면 다음 실행에서 사라진다.",
    "",
    "| 무엇 | 어디서 | 규모 |",
    "|---|---|---|",
    `| 상세 응답 키 | \`${CENSUS_DETAIL}\` | 상세 ${parseCensusScale(censusDetail)}건 전수 |`,
    `| 목록 응답 키 | \`${CENSUS_LIST}\` | 목록 응답 ${parseCensusScale(censusList)}건 |`,
    `| 양방향 함수성 | \`${KEYS_LEDGER}\` | n=${parseLedgerScale(keysLedger)} |`,
    `| 파서 소비 | \`${PARSER_DIRECTORY}\` | 현재 코드 |`,
    "",
    "읽는 법.",
    "",
    "- `행`·`채움%`·`고유`·`값 예시`는 census가 센 값이다. `고유`의 `+`는 추적 상한에 닿았다는 뜻이라 그 이상은 모른다.",
    "- `코드 판정` 칸은 같은 dataset 안 접두어 짝이 함수인지를 **잰 수치**다. `이름다중 N/M`은 코드 M개 중 N개가 이름을 2개 이상 갖는다는 뜻이고, `역`은 그 반대 방향이다. `정규화`는 공백·시군구 접미어를 지우고 다시 센 값이다. **0이 아니라고 곧바로 코드가 아닌 것은 아니다** — 표기 변이인지 어휘가 깨진 것인지는 판정 문서가 가른다. 짝이 아닌 대조군 쌍은 여기 싣지 않는다.",
    "- `파서`의 `읽음`은 검토된 응답 계약이 그 dataset에 선언한 column이면서 파서 모듈이 그 이름을 문자열로 읽는다는 뜻이고, `계약`은 계약에만 있고 값을 해석하지 않는다는 뜻이다. 같은 이름이 여러 dataset에 선언되면 전부 `읽음`으로 찍히므로 dataset 단위 정확도는 계약 선언까지가 근거다.",
    "- census 표의 `우리` 열은 census를 만들던 2026-08-28 당시 파서 기준이라 이 표의 `파서` 칸과 다를 수 있다. **다르면 이 표가 현재다.**",
    "- 빈 `코드 판정`은 짝이 되는 이름 필드가 없어 재지 못했다는 뜻이지 코드가 아니라는 뜻이 아니다.",
    "- **여기 없는 이름이 응답에 없다는 뜻은 아니다.** census 표는 값이 한 번이라도 온 키만 싣는다. 선언은 되는데 전 코퍼스에서 한 번도 안 채워지는 키(`CANCEL_REASON`이 그렇다)는 이 색인에 나타나지 않는다 — 그 목록은 `AUDIT-SOURCE.md` §3.1이 소유하고 [T12](../SOURCE-FIELDS.md)가 가리킨다.",
  ];
}

export function buildIndex({
  censusDetail,
  censusList,
  keysLedger,
  judgement,
  contractSource,
  parserSources,
}) {
  const detail = parseCensusKeys(censusDetail);
  const list = parseCensusKeys(censusList);
  const rows = [...detail.rows, ...list.rows];
  const skipped = [...detail.skipped, ...list.skipped];
  const datasets = [...parseCensusDatasets(censusDetail), ...parseCensusDatasets(censusList)];
  const pairs = parseCodeNamePairs(censusDetail);
  const bidirectional = parseBidirectional(keysLedger);
  const traps = parseTraps(judgement);
  const { declared, read } = collectParserUsage({ contractSource, parserSources });

  const trapsByTarget = new Map();
  for (const trap of traps) {
    for (const target of trap.targets) {
      if (!trapsByTarget.has(target)) trapsByTarget.set(target, []);
      trapsByTarget.get(target).push(trap);
    }
  }
  const trapMark = (key) =>
    (trapsByTarget.get(key) ?? [])
      .map((trap) => `[${trap.id}](../SOURCE-FIELDS.md#${trap.anchor})`)
      .join(" ");

  rows.sort(
    (left, right) => compare(left.field, right.field) || compare(left.dataset, right.dataset),
  );

  const lines = [
    ...header({ censusDetail, censusList, keysLedger }),
    "",
    "## 함정 대장",
    "",
    "판정 문서가 선언한 함정이다. 제목과 걸린 자리는 그 문서가 소유하고 여기로 옮겨진다.",
    "",
    "| 함정 | 무엇 | 걸린 자리 |",
    "|---|---|---|",
    ...traps.map(
      (trap) =>
        `| [${trap.id}](../SOURCE-FIELDS.md#${trap.anchor}) | ${cell(trap.title)} | ${trap.targets.map((target) => `\`${target}\``).join(" ")} |`,
    ),
    "",
    "## dataset 대장",
    "",
    "`선언`은 ColumnInfo가 온 응답 수, `행보유`는 행이 1개 이상인 응답 수다. 둘을 섞으면 채움률이 뒤집힌다.",
    "",
    "| dataset | 선언 | 선언% | 행보유 | 행보유% | 총행 | 평균행 | 함정 |",
    "|---|---|---|---|---|---|---|---|",
    ...datasets.map(
      (dataset) =>
        `| \`${dataset.dataset}\` | ${dataset.declared} | ${dataset.declaredPercent} | ${dataset.withRows} | ${dataset.withRowsPercent} | ${dataset.totalRows} | ${dataset.averageRows} | ${trapMark(dataset.dataset)} |`,
    ),
    "",
    "## 필드 색인",
    "",
    `(dataset, 필드) ${rows.length}조합. 필드 이름 알파벳순이고 같은 이름이 여러 dataset에 있으면 붙어 나온다 — **그 줄들이 같은 값 공간이라는 뜻은 아니다.**`,
    "",
    "| 필드 | dataset | 행 | 채움% | 고유 | 코드 판정 | 파서 | 함정 | 값 예시 |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((row) => {
      const columns = [
        `\`${row.field}\``,
        `\`${row.dataset}\``,
        row.rowCount,
        row.filledPercent,
        row.distinct,
        cell(codeVerdict({ dataset: row.dataset, field: row.field, pairs, bidirectional })),
        usageMark({ dataset: row.dataset, field: row.field, declared, read }),
        trapMark(`${row.dataset}.${row.field}`),
        cell(row.sample),
      ];
      return `| ${columns.join(" | ")} |`;
    }),
  ];

  const indexed = new Set([
    ...rows.map((row) => `${row.dataset}.${row.field}`),
    ...datasets.map((dataset) => dataset.dataset),
  ]);
  const unmatched = [...trapsByTarget.keys()].filter((target) => !indexed.has(target)).sort(compare);

  lines.push(
    "",
    "## 색인에 줄이 없는 걸린 자리",
    "",
    "판정 문서가 함정으로 지목했는데 위 표에 줄이 없는 자리다. **오타일 수도 있고 census가 싣지 않는 키일 수도 있다.**",
    "선언만 되고 값이 한 번도 안 온 키와 우리가 부르지 않는 엔드포인트의 column이 여기 남는다.",
    "",
  );
  if (unmatched.length === 0) lines.push("없다.");
  else for (const target of unmatched) lines.push(`- \`${target}\``);

  lines.push("", "## 읽지 못한 줄", "");
  if (skipped.length === 0) {
    lines.push("없다. census 표의 모든 키 줄이 이 색인에 들어왔다.");
  } else {
    for (const item of skipped) lines.push(`- \`${item.dataset}\`: \`${item.line.trim()}\``);
  }
  lines.push("");
  return { text: lines.join("\n"), rowCount: rows.length, skipped };
}

export function generate({ write }) {
  const parserDirectory = path.join(root, PARSER_DIRECTORY);
  const parserSources = readdirSync(parserDirectory)
    .filter((file) => file.endsWith(".py") && file !== SCHEMA_CONTRACT_FILE)
    .sort(compare)
    .map((file) => readFileSync(path.join(parserDirectory, file), "utf8"));
  const result = buildIndex({
    censusDetail: readText(CENSUS_DETAIL),
    censusList: readText(CENSUS_LIST),
    keysLedger: readText(KEYS_LEDGER),
    judgement: readText(JUDGEMENT_DOCUMENT),
    contractSource: readText(path.posix.join(PARSER_DIRECTORY, SCHEMA_CONTRACT_FILE)),
    parserSources,
  });
  if (write) {
    const output = path.join(root, OUTPUT);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, result.text, "utf8");
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = generate({ write: true });
  process.stdout.write(
    `${OUTPUT}: (dataset, 필드) ${result.rowCount}조합 · 읽지 못한 줄 ${result.skipped.length}\n`,
  );
}
