/** @module 책임: eaT 원본 감사 기계 생성물과 dataplane 파서 코드에서 (dataset, 필드) 색인 생성물을 만들어 필드 이름으로 찾을 수 있게 한다. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.SOURCE_FIELD_INDEX_ROOT
  ? path.resolve(process.env.SOURCE_FIELD_INDEX_ROOT)
  : fileURLToPath(new URL("../../", import.meta.url));

export const CENSUS_DETAIL = "docs/audit-source/census-detail.txt";
export const CENSUS_LIST = "docs/audit-source/census-list.txt";
export const KEYS_LEDGER = "docs/audit-source/keys-ledger.txt";
export const JUDGEMENT_DOCUMENT = "docs/audit-source/SOURCE-FIELDS.md";
export const PARSER_DIRECTORY = "apps/dataplane/src/eatbid/source/eat";
// 검토된 응답 계약이 (dataset, column)을 선언하는 유일한 파일이다. 나머지 파서 모듈과 달리 여기 적힌
// column은 "소스가 준다고 관측했다"는 뜻이지 "파서가 읽는다"는 뜻이 아니라서 읽기 판정에서 제외한다.
export const SCHEMA_CONTRACT_FILE = "schema_contract.py";
export const OUTPUT = "docs/audit-source/generated/source-field-index.md";

const readText = (file) => readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n");
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/** 표 칸에 그대로 실을 수 없는 문자만 막는다. 값 예시의 `|`는 census가 예시 구분자로 쓰는 문자다. */
function cell(text) {
  return text.replaceAll("|", "\\|").trim();
}

/**
 * census 파일의 `## 2. 키별 상세` 표를 (dataset, 필드) 행으로 읽는다.
 *
 * 한 줄의 마지막 칸(값 예시)만 공백을 포함하므로 앞의 여섯 칸을 고정 개수로 끊고 나머지를 예시로 둔다.
 * 파싱에 실패한 줄은 조용히 버리지 않고 부른 쪽이 세어 보고할 수 있게 따로 돌려준다.
 */
export function parseCensusKeys(text) {
  const rows = [];
  const skipped = [];
  let dataset = null;
  let inKeySection = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      inKeySection = line.includes("키별 상세");
      dataset = null;
      continue;
    }
    if (line.startsWith("### ")) {
      dataset = line.slice(4).trim();
      continue;
    }
    if (!inKeySection || dataset === null) continue;
    if (line.trim() === "" || line.startsWith("key ")) continue;
    const match = line.match(
      /^(\S+)\s+([\d,]+)\s+([\d.]+%)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/u,
    );
    if (!match) {
      skipped.push({ dataset, line });
      continue;
    }
    rows.push({
      dataset,
      field: match[1],
      rowCount: match[2],
      filledPercent: match[3],
      distinct: match[4],
      sequencePercent: match[5],
      legacyParsed: match[6],
      sample: match[7],
    });
  }
  return { rows, skipped };
}

/** census 파일의 `## 1. 데이터셋` 표다. 선언과 행보유를 섞지 않는 것이 이 표의 요점이다. */
export function parseCensusDatasets(text) {
  const rows = [];
  let inSection = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      inSection = line.includes("데이터셋");
      continue;
    }
    if (!inSection || line.trim() === "" || line.startsWith("dataset ")) continue;
    const match = line.match(
      /^(\S+)\s+([\d,]+)\s+([\d.]+%)\s+([\d,]+)\s+([\d.]+%)\s+([\d,]+)\s+([\d.]+)$/u,
    );
    if (match) {
      rows.push({
        dataset: match[1],
        declared: match[2],
        declaredPercent: match[3],
        withRows: match[4],
        withRowsPercent: match[5],
        totalRows: match[6],
        averageRows: match[7],
      });
    }
  }
  return rows;
}

/** census `## 3. 코드 → 이름 함수성`. 이름다중이 0이 아니면 그 필드는 분류 코드가 아니다. */
export function parseCodeNamePairs(text) {
  const pairs = [];
  let inSection = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      inSection = line.includes("함수성");
      continue;
    }
    if (!inSection) continue;
    const match = line.match(
      /^(\S+)\.(\S+) → (\S+)\s+([\d,]+)\s+([\d,]+)\s+([\d.]+%)\s*(.*)$/u,
    );
    if (match) {
      pairs.push({
        dataset: match[1],
        field: match[2],
        nameField: match[3],
        codeCount: match[4],
        multiNameCount: match[5],
        multiNamePercent: match[6],
      });
    }
  }
  return pairs;
}

/** keys-ledger `## 1. 양방향`. 역방향 수치가 "이름으로 세면 무엇을 잃는가"다. */
export function parseBidirectional(text) {
  const rows = [];
  let inSection = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      inSection = line.includes("양방향");
      continue;
    }
    if (line.startsWith("### ")) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    const match = line.match(
      /^(\S+)\.(\S+) → (\S+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*$/u,
    );
    if (match) {
      rows.push({
        dataset: match[1],
        field: match[2],
        nameField: match[3],
        codeCount: match[4],
        forwardMulti: match[5],
        nameCount: match[6],
        reverseMulti: match[7],
        forwardNormalized: match[8],
        reverseNormalized: match[9],
      });
    }
  }
  return rows;
}

/** census 파일 머리의 `# census: files=...`에서 측정 규모를 읽는다. */
export function parseCensusScale(text) {
  const match = text.split("\n")[0].match(/files=(\d+)/u);
  return match ? Number.parseInt(match[1], 10).toLocaleString("en-US") : "알 수 없음";
}

export function parseLedgerScale(text) {
  const match = text.match(/^n=([\d,]+)/mu);
  return match ? match[1] : "알 수 없음";
}

/**
 * 판정 문서가 선언한 함정을 읽는다. 어떤 (dataset, 필드)가 함정에 걸렸는지는 사람이 적는 판단이므로
 * 생성기가 다시 판단하지 않고 그 선언만 옮긴다. 함정 본문의 숫자는 여기서 읽지 않는다.
 */
export function parseTraps(text) {
  const traps = [];
  let current = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^###\s+(T\d+)\.?\s+(.+?)\s*$/u);
    if (heading) {
      current = { id: heading[1], title: heading[2], targets: [], anchor: headingAnchor(line.slice(4).trim()) };
      traps.push(current);
      continue;
    }
    if (line.startsWith("## ")) {
      current = null;
      continue;
    }
    const targets = current && line.match(/^-\s+걸린 자리:\s*(.+?)\s*$/u);
    if (targets) {
      for (const token of targets[1].matchAll(/`([^`]+)`/gu)) current.targets.push(token[1]);
    }
  }
  return traps;
}

/**
 * 함정 항목으로 가는 링크의 앵커를 만든다. 규칙은 GitHub의 heading 앵커와 같게 둔다 — 밑줄을 남기고
 * 나머지 문장부호만 버린다. `check-docs.mjs`의 앵커 규칙은 밑줄까지 버리지만 이 두 문서는 그 검사의
 * 대상 디렉터리 밖이고, 사람이 실제로 눌러 여는 곳은 GitHub와 편집기다. 링크가 깨지면 함정 칸이
 * 가리키는 곳에 닿지 못해 사전이 제 일을 못 한다.
 */
export function headingAnchor(text) {
  return text
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/[*~]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/gu, "-");
}

/**
 * 검토된 응답 계약이 dataset마다 선언한 column과, 파서 모듈이 문자열로 읽는 column을 각각 모은다.
 *
 * 왜 두 집합인가. 계약은 "소스가 이 column을 준다고 관측했다"까지만 주장하고 파서가 읽지 않는 column도
 * 담는다(`schema_contract.py`가 그 이유를 소유한다). 값을 실제로 해석하는지는 파서 모듈에 그 이름이
 * 나오는지로만 알 수 있다.
 */
export function collectParserUsage({ contractSource, parserSources }) {
  const declared = new Map();
  for (const [dataset, columns] of parseContractDatasets(contractSource)) {
    if (!declared.has(dataset)) declared.set(dataset, new Set());
    for (const column of columns) declared.get(dataset).add(column);
  }
  const read = new Set();
  for (const source of parserSources) {
    for (const token of source.matchAll(/"([A-Z][A-Z0-9_]{2,})"/gu)) read.add(token[1]);
  }
  return { declared, read };
}

/**
 * `schema_contract.py`의 dataset 선언을 읽는다. Python을 실행하지 않고 형태만 읽는 이유는 이 생성기가
 * node 한 프로세스에서 끝나야 하기 때문이며, 대신 dataset 키와 상수 이름 둘 다를 따라가 tuple 상수로
 * 선언된 column 목록도 펼친다.
 */
export function parseContractDatasets(source) {
  const constants = new Map();
  for (const match of source.matchAll(/^(_[A-Z0-9_]+)\s*=\s*\(\n([\s\S]*?)^\)/gmu)) {
    constants.set(match[1], [...match[2].matchAll(/"([A-Z][A-Z0-9_]*)"/gu)].map((item) => item[1]));
  }
  const datasets = new Map();
  const add = (dataset, columns) => {
    if (!datasets.has(dataset)) datasets.set(dataset, new Set());
    for (const column of columns) datasets.get(dataset).add(column);
  };
  for (const match of source.matchAll(/"(ds_[A-Za-z]+)":\s*(\([\s\S]*?\)|\*?_[A-Z0-9_]+,)/gu)) {
    const dataset = match[1];
    const body = match[2];
    const spread = body.match(/^\*?(_[A-Z0-9_]+),$/u);
    if (spread) {
      add(dataset, constants.get(spread[1]) ?? []);
      continue;
    }
    for (const reference of body.matchAll(/\*(_[A-Z0-9_]+)/gu)) add(dataset, constants.get(reference[1]) ?? []);
    add(dataset, [...body.matchAll(/"([A-Z][A-Z0-9_]*)"/gu)].map((item) => item[1]));
  }
  return datasets;
}

function usageMark({ dataset, field, declared, read }) {
  if (!declared.get(dataset)?.has(field)) return "·";
  return read.has(field) ? "읽음" : "계약";
}

/**
 * 이름 필드가 그 코드 필드의 짝인지 판정한다. `_NM`을 뗀 토큰이 코드 필드 안에 그대로 들어 있어야 한다.
 *
 * 왜 거르나. keys-ledger는 검사가 살아 있는지 보려고 `SIDO_CD → PURR_NM` 같은 **무관한 대조군 쌍**을
 * 일부러 넣었다(`AUDIT-SOURCE.md` §10.0). 그 수치를 색인에 그대로 실으면 읽는 사람이 짝이 아닌 두
 * 필드를 짝으로 읽는다.
 */
export function isNamePairOf(field, nameField) {
  if (!nameField.endsWith("_NM")) return false;
  const base = nameField.slice(0, -3).split("_");
  const tokens = field.split("_");
  return base.every((token) => tokens.includes(token));
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

  const lines = [];
  lines.push(
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
  );
  for (const dataset of datasets) {
    lines.push(
      `| \`${dataset.dataset}\` | ${dataset.declared} | ${dataset.declaredPercent} | ${dataset.withRows} | ${dataset.withRowsPercent} | ${dataset.totalRows} | ${dataset.averageRows} | ${trapMark(dataset.dataset)} |`,
    );
  }

  lines.push(
    "",
    "## 필드 색인",
    "",
    `(dataset, 필드) ${rows.length}조합. 필드 이름 알파벳순이고 같은 이름이 여러 dataset에 있으면 붙어 나온다 — **그 줄들이 같은 값 공간이라는 뜻은 아니다.**`,
    "",
    "| 필드 | dataset | 행 | 채움% | 고유 | 코드 판정 | 파서 | 함정 | 값 예시 |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const row of rows) {
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
    lines.push(`| ${columns.join(" | ")} |`);
  }

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
