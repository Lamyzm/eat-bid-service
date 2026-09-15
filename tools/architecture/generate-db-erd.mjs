/** @module 책임: 최신 Drizzle 마이그레이션 snapshot에서 스키마별 mermaid ERD 생성물을 내고 추적 생성물의 drift를 검사한다. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.DB_ERD_ROOT
  ? path.resolve(process.env.DB_ERD_ROOT)
  : fileURLToPath(new URL("../../", import.meta.url));
const migrationsDirectory = path.join(root, "packages", "db", "drizzle");
const outputDirectory = path.join(root, "docs", "architecture", "generated");

export const SCHEMAS = Object.freeze(["ingest", "core", "mart", "app", "monitoring"]);

// mermaid erDiagram의 attribute type은 공백·괄호를 받지 않는다. 자주 나오는 PostgreSQL 타입은 읽기 쉬운
// 별칭으로 바꾸고 나머지는 식별자 문자만 남긴다.
const TYPE_ALIASES = [
  [/^timestamp(?:\s*\(\d+\))? with time zone$/u, "timestamptz"],
  [/^timestamp(?:\s*\(\d+\))? without time zone$/u, "timestamp"],
  [/^character varying(?:\((\d+)\))?$/u, (match) => (match[1] ? `varchar_${match[1]}` : "varchar")],
  [/^character(?:\((\d+)\))?$/u, (match) => (match[1] ? `char_${match[1]}` : "char")],
  [/^double precision$/u, "float8"],
  [/^bit varying$/u, "varbit"],
];

export function mermaidType(type, dimensions = 0) {
  let value = String(type ?? "").trim().toLowerCase();
  for (const [pattern, alias] of TYPE_ALIASES) {
    const match = value.match(pattern);
    if (match) {
      value = typeof alias === "function" ? alias(match) : alias;
      break;
    }
  }
  const arraySuffixes = (value.match(/\[\]/gu) ?? []).length + Math.max(0, Number(dimensions) || 0);
  value = value
    .replaceAll("[]", "")
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return `${value || "unknown"}${"_array".repeat(arraySuffixes)}`;
}

/** snapshot 디렉터리 이름은 timestamp 접두사라 사전순 마지막이 최신 마이그레이션이다. */
export function latestSnapshot(directory = migrationsDirectory) {
  const folders = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(directory, entry.name, "snapshot.json")))
    .map((entry) => entry.name)
    .sort();
  if (folders.length === 0) throw new Error(`Drizzle snapshot을 찾지 못했습니다: ${directory}`);
  const folder = folders.at(-1);
  return { folder, snapshot: JSON.parse(readFileSync(path.join(directory, folder, "snapshot.json"), "utf8")) };
}

function byTable(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const key = `${entry.schema}.${entry.table}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }
  return grouped;
}

function keyMarkers({ column, pkColumns, fkColumns, ukColumns }) {
  const markers = [];
  if (pkColumns.has(column)) markers.push("PK");
  if (fkColumns.has(column)) markers.push("FK");
  if (ukColumns.has(column)) markers.push("UK");
  return markers.join(", ");
}

/**
 * 한 스키마의 ERD를 낸다. 다른 스키마의 표는 관계선에만 `schema__table`로 나타난다. 그래야 core가 어느
 * ingest 표를 가리키는지가 core 그림 안에서 보이면서도 그림 하나가 전체 스키마를 다 담지 않는다.
 */
export function renderSchemaErd(snapshot, schemaName, { folder }) {
  const ddl = Array.isArray(snapshot?.ddl) ? snapshot.ddl : [];
  const tables = ddl
    .filter((entry) => entry.entityType === "tables" && entry.schema === schemaName)
    .map((entry) => entry.name)
    .sort();
  const columns = byTable(ddl.filter((entry) => entry.entityType === "columns"));
  const pks = byTable(ddl.filter((entry) => entry.entityType === "pks"));
  const uniques = byTable(ddl.filter((entry) => entry.entityType === "uniques"));
  const fks = ddl.filter((entry) => entry.entityType === "fks");
  const fksByChild = byTable(fks);

  const lines = ["erDiagram"];
  for (const table of tables) {
    const key = `${schemaName}.${table}`;
    const pkColumns = new Set((pks.get(key) ?? []).flatMap((entry) => entry.columns));
    const fkColumns = new Set((fksByChild.get(key) ?? []).flatMap((entry) => entry.columns));
    const ukColumns = new Set((uniques.get(key) ?? []).flatMap((entry) => entry.columns));
    lines.push(`    ${table} {`);
    for (const column of columns.get(key) ?? []) {
      const markers = keyMarkers({ column: column.name, pkColumns, fkColumns, ukColumns });
      lines.push(`        ${mermaidType(column.type, column.dimensions)} ${column.name}${markers ? ` ${markers}` : ""}`);
    }
    lines.push("    }");
  }

  const entityName = (schema, table) => (schema === schemaName ? table : `${schema}__${table}`);
  const relationships = fks
    .filter((entry) => entry.schema === schemaName || entry.schemaTo === schemaName)
    .map((entry) => ({
      child: entityName(entry.schema, entry.table),
      label: entry.columns.join(", "),
      parent: entityName(entry.schemaTo, entry.tableTo),
    }))
    .sort((left, right) =>
      `${left.parent} ${left.child} ${left.label}`.localeCompare(`${right.parent} ${right.child} ${right.label}`, "en"),
    );
  for (const relationship of relationships) {
    lines.push(`    ${relationship.parent} ||--o{ ${relationship.child} : "${relationship.label}"`);
  }

  return [
    `<!-- 생성물이다. 직접 편집하지 않고 \`pnpm architecture:erd:write\`로 다시 만든다. 원천: packages/db/drizzle/${folder}/snapshot.json -->`,
    `# \`${schemaName}\` 스키마 ERD`,
    "",
    `Drizzle 마이그레이션 \`${folder}\`의 snapshot에서 만든 표·컬럼·외래키 그림이다. 표 ${tables.length}개.`,
    "다른 스키마의 표는 관계선에만 `schema__table`로 나타난다. 의미와 불변식은",
    "[domain-and-data.md](../domain-and-data.md)와 [수집 쓰기 지도](../ingestion-write-map.md)가 설명한다.",
    "",
    "```mermaid",
    ...lines,
    "```",
    "",
  ].join("\n");
}

export function erdFileName(schemaName) {
  return `erd-${schemaName}.md`;
}

export function renderAll(options = {}) {
  const { folder, snapshot } = latestSnapshot(options.migrationsDirectory ?? migrationsDirectory);
  return SCHEMAS.map((schemaName) => ({
    content: renderSchemaErd(snapshot, schemaName, { folder }),
    fileName: erdFileName(schemaName),
    schemaName,
  }));
}

const normalizeLineEndings = (text) => text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

export function writeArtifacts({ artifacts = renderAll(), directory = outputDirectory } = {}) {
  mkdirSync(directory, { recursive: true });
  const written = [];
  for (const artifact of artifacts) {
    const target = path.join(directory, artifact.fileName);
    writeFileSync(target, artifact.content, "utf8");
    written.push(target);
  }
  return written;
}

export function checkArtifacts({ artifacts = renderAll(), directory = outputDirectory } = {}) {
  const failures = [];
  const expected = new Set(artifacts.map((artifact) => artifact.fileName));
  for (const artifact of artifacts) {
    const target = path.join(directory, artifact.fileName);
    if (!existsSync(target)) {
      failures.push(`생성물이 없습니다: ${path.relative(root, target).replaceAll("\\", "/")}`);
      continue;
    }
    if (normalizeLineEndings(readFileSync(target, "utf8")) !== normalizeLineEndings(artifact.content)) {
      failures.push(`생성물이 snapshot과 다릅니다: ${path.relative(root, target).replaceAll("\\", "/")}`);
    }
  }
  if (existsSync(directory)) {
    for (const name of readdirSync(directory)) {
      if (/^erd-[a-z]+\.md$/u.test(name) && !expected.has(name)) {
        failures.push(`원천 없는 ERD 생성물이 남아 있습니다: docs/architecture/generated/${name}`);
      }
    }
  }
  return failures;
}

function main(argv) {
  const write = argv.includes("--write");
  const check = argv.includes("--check");
  if (write === check) {
    console.error("사용법: node tools/architecture/generate-db-erd.mjs --write | --check");
    process.exitCode = 2;
    return;
  }
  const artifacts = renderAll();
  if (write) {
    for (const target of writeArtifacts({ artifacts })) {
      console.log(`ERD 생성물을 썼습니다: ${path.relative(root, target).replaceAll("\\", "/")}`);
    }
    return;
  }
  const failures = checkArtifacts({ artifacts });
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    console.error("`pnpm architecture:erd:write`로 다시 만든 뒤 커밋합니다.");
    process.exitCode = 1;
    return;
  }
  console.log(`DB ERD 생성물 검사가 통과했습니다. 스키마 ${artifacts.length}개가 최신 snapshot과 같습니다.`);
}

const invokedDirectly =
  process.argv.includes("--write") ||
  process.argv.includes("--check") ||
  (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (invokedDirectly) main(process.argv);
