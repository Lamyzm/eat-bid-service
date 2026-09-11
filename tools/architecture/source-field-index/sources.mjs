/** @module 책임: eaT 감사 기계 생성물·판정 문서·dataplane 파서 코드의 텍스트 모양을 읽어 색인 생성기가 쓰는 자료 구조로만 바꾼다. */

export const CENSUS_DETAIL = "docs/audit-source/census-detail.txt";
export const CENSUS_LIST = "docs/audit-source/census-list.txt";
export const KEYS_LEDGER = "docs/audit-source/keys-ledger.txt";
export const JUDGEMENT_DOCUMENT = "docs/audit-source/SOURCE-FIELDS.md";
export const PARSER_DIRECTORY = "apps/dataplane/src/eatbid/source/eat";
// 검토된 응답 계약이 (dataset, column)을 선언하는 유일한 파일이다. 나머지 파서 모듈과 달리 여기 적힌
// column은 "소스가 준다고 관측했다"는 뜻이지 "파서가 읽는다"는 뜻이 아니라서 읽기 판정에서 제외한다.
export const SCHEMA_CONTRACT_FILE = "schema_contract.py";

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

/** census `## 3. 코드 → 이름 함수성`. 이름다중이 0이 아니면 그 dataset 안에서 코드가 이름을 결정하지 못한다. */
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
      current = {
        id: heading[1],
        title: heading[2],
        targets: [],
        anchor: headingAnchor(line.slice(4).trim()),
      };
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
    for (const reference of body.matchAll(/\*(_[A-Z0-9_]+)/gu)) {
      add(dataset, constants.get(reference[1]) ?? []);
    }
    add(dataset, [...body.matchAll(/"([A-Z][A-Z0-9_]*)"/gu)].map((item) => item[1]));
  }
  return datasets;
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
