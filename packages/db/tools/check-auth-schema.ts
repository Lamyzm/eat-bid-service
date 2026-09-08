/**
 * @module 책임: pinned `auth` CLI generator가 같은 adapter 설정으로 만든 schema와 커밋된 Drizzle table을
 * 표·열·property key·필수·참조·index 수준에서 대조해 provider 업그레이드가 DDL을 앞지르지 못하게 막는다.
 *
 * 왜 생성 코드를 실행해서 비교하는가: byte formatting 비교는 ADR 0018이 금지하고, TypeScript 원문을
 * 정규식이나 AST로 읽으면 생성기의 서식 변화에 검사가 흔들린다. 생성 결과를 그대로 평가하면 양쪽 모두
 * 같은 `getTableConfig` 하나로 정규화되므로 비교 대상이 구조 자체가 된다. DB 연결과 비밀값은 필요 없다.
 */
import { generateDrizzleSchema } from "auth/api";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getSchema } from "better-auth/db";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authAdapterOptions, authSchemaOptions } from "../src/schema/app/auth-schema-options.js";
import { authProviderTables } from "../src/schema/app/auth.js";

export interface AuthSchemaFinding {
  readonly table: string;
  readonly rule: string;
  readonly reason: string;
}

export interface AuthSchemaInput {
  /** 대조 대상 Drizzle table. 검사 자체가 drift를 잡는지 증명하는 테스트만 다른 값을 넣는다. */
  readonly tables?: Readonly<Record<string, PgTable>>;
  readonly options?: unknown;
}

interface ColumnFacts {
  readonly column: string;
  /** Drizzle의 JavaScript 매핑이다. `PgBigInt53`과 `PgBigInt64`, 날짜와 문자열 mode를 구분한다. */
  readonly type: string;
  /** PostgreSQL 물리 타입이다. 폭이 좁아지는 변경(`integer`)을 여기서 잡는다. */
  readonly sqlType: string;
  readonly notNull: boolean;
  readonly primary: boolean;
}

/**
 * generator 결과와 다르게 두기로 한 열이다. 목록에 없는 차이는 전부 실패이고, 목록에 있는데 실제로는
 * 차이가 없어진 항목도 실패로 드러내 이 예외가 남아 썩지 않게 한다.
 */
const allowedColumnDeviations = Object.freeze([
  {
    table: "auth_rate_limit",
    property: "lastRequest",
    generatedType: "PgBigInt53",
    declaredType: "PgBigInt64",
    generatedSqlType: "bigint",
    declaredSqlType: "bigint",
    reason: "밀리초 epoch은 int4로 넘치고 저장소 전역 규칙이 JavaScript number mode bigint를 금지한다."
      + " 물리 타입은 같고 provider rate limiter가 읽어 온 bigint를 스스로 Number로 바꾼다.",
  },
  {
    table: "*",
    property: "*",
    generatedType: "PgTimestamp",
    declaredType: "PgTimestamp",
    generatedSqlType: "timestamp",
    declaredSqlType: "timestamp with time zone",
    reason: "provider는 Date를 넣고 읽는다. timezone 없는 열로 두면 세션 만료 판정이 서버 지역시간에 따라"
      + " 흔들린다. JavaScript 매핑은 같으므로 date와 string mode 구분은 그대로 남는다.",
  },
] as const);

function deviationFor(table: string, property: string, expected: ColumnFacts, declared: ColumnFacts) {
  return allowedColumnDeviations.find((entry) =>
    (entry.table === "*" || entry.table === table)
    && (entry.property === "*" || entry.property === property)
    && entry.generatedType === expected.type
    && entry.declaredType === declared.type
    && entry.generatedSqlType === expected.sqlType
    && entry.declaredSqlType === declared.sqlType);
}

interface TableFacts {
  readonly schema: string | undefined;
  readonly name: string;
  readonly columns: ReadonlyMap<string, ColumnFacts>;
  readonly indexes: ReadonlySet<string>;
  readonly foreignKeys: ReadonlySet<string>;
}

function indexSignature(columns: readonly string[], unique: boolean): string {
  return `${unique ? "unique" : "plain"}(${columns.join(",")})`;
}

/**
 * 비교에 쓰는 사실만 뽑는다. property key까지 담는 이유: adapter는 `table[columnName]`으로 열에 접근하므로
 * 물리 이름이 같아도 property 이름이 다르면 런타임 질의가 깨진다(설치본 drizzle-adapter checkMissingFields).
 */
function describe(table: PgTable): TableFacts {
  const config = getTableConfig(table);
  const columns = new Map<string, ColumnFacts>();
  for (const [propertyKey, column] of Object.entries(table as unknown as Record<string, unknown>)) {
    const found = config.columns.find((candidate) => candidate === column);
    if (!found) continue;
    columns.set(propertyKey, {
      column: found.name,
      type: found.columnType,
      sqlType: found.getSQLType(),
      notNull: found.notNull,
      primary: found.primary,
    });
  }
  return {
    schema: config.schema,
    name: config.name,
    columns,
    indexes: new Set([
      ...config.indexes.map((entry) => indexSignature(
        entry.config.columns.map((column) => ("name" in column ? String(column.name) : "?")),
        entry.config.unique === true,
      )),
      ...config.uniqueConstraints.map((entry) => indexSignature(entry.columns.map((column) => column.name), true)),
      ...config.primaryKeys.map((entry) => indexSignature(entry.columns.map((column) => column.name), true)),
      // 단일 열 PK는 제약 목록이 아니라 열 속성으로 표현되므로 같은 어휘로 옮겨 준다.
      ...config.columns.filter((column) => column.primary).map((column) => indexSignature([column.name], true)),
    ]),
    foreignKeys: new Set(config.foreignKeys.map((key) => {
      const reference = key.reference();
      const target = getTableConfig(reference.foreignTable);
      const columns = reference.columns.map((column) => column.name).join(",");
      const targets = reference.foreignColumns.map((column) => column.name).join(",");
      return `${columns}->${target.schema ?? "public"}.${target.name}(${targets}):${key.onDelete ?? "no action"}`;
    })),
  };
}

/**
 * pinned CLI generator를 실제 adapter 설정으로 offline 실행한다. adapter는 질의를 하지 않고 설정만
 * 읽히므로 연결 없는 handle로 충분하고, 그래서 이 검사는 DB도 비밀값도 요구하지 않는다.
 */
async function generatedSchemaCode(options: BetterAuthOptions): Promise<string> {
  const adapter = drizzleAdapter({} as never, {
    ...authAdapterOptions,
    schema: { ...authProviderTables },
  })(options);
  const result = await generateDrizzleSchema({ adapter, options });
  if (!result.code || result.code.trim() === "") {
    throw new Error("pinned auth CLI generator가 schema 코드를 만들지 못했습니다.");
  }
  return result.code;
}

/**
 * pinned generator는 Drizzle v0 시절의 `relations()` 헬퍼를 함께 내보내지만 이 저장소의 drizzle-orm
 * 1.0.0-rc.4 root에는 그 export가 없다. 우리는 관계 헬퍼를 선언하지 않고 adapter도 `db.query` 관계가 없으면
 * 일반 질의로 되돌아가므로, 대조를 막지 않도록 이 자리만 무해한 대역으로 채운다. 표·열·제약은 대역 없이
 * 원문 그대로 평가한다.
 */
const relationsShim = "export const relations = () => ({});\n";

/** 생성 코드는 저장소 밖 임시 파일에서 평가한다. import는 이 package가 이미 해석한 실제 경로로 고정한다. */
async function evaluateGeneratedTables(code: string): Promise<Map<string, PgTable>> {
  const directory = await mkdtemp(join(tmpdir(), "eatbid-auth-schema-"));
  try {
    await writeFile(join(directory, "drizzle-relations-shim.ts"), relationsShim, "utf8");
    const resolved = code
      .replaceAll('from "drizzle-orm"', 'from "./drizzle-relations-shim.ts"')
      .replaceAll(
        /from "(drizzle-orm\/[a-z-]+)"/g,
        (_match, specifier: string) => `from ${JSON.stringify(Bun.resolveSync(specifier, import.meta.dir))}`,
      );
    const file = join(directory, "generated-auth-schema.ts");
    await writeFile(file, resolved, "utf8");
    const module = await import(`file://${file.replaceAll("\\", "/")}`) as Record<string, unknown>;
    const tables = new Map<string, PgTable>();
    for (const value of Object.values(module)) {
      if (typeof value !== "object" || value === null) continue;
      try {
        tables.set(getTableConfig(value as PgTable).name, value as PgTable);
      } catch {
        // pgSchema 같은 비-table export는 대조 대상이 아니다.
      }
    }
    if (tables.size === 0) throw new Error("생성된 schema에서 table을 찾지 못했습니다.");
    return tables;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

type ColumnDeviation = (typeof allowedColumnDeviations)[number];

function compareTable(
  tableName: string,
  expected: TableFacts,
  declared: TableFacts,
  findings: AuthSchemaFinding[],
  usedDeviations: Set<ColumnDeviation>,
): void {
  const add = (rule: string, reason: string) => findings.push({ table: tableName, rule, reason });
  if (declared.schema !== expected.schema) {
    add("table-schema", `schema가 ${String(expected.schema)}가 아니라 ${String(declared.schema)}입니다.`);
  }
  if (declared.name !== expected.name) {
    add("table-name", `물리 table 이름이 ${expected.name}가 아니라 ${declared.name}입니다.`);
  }
  for (const [propertyKey, column] of expected.columns) {
    const found = declared.columns.get(propertyKey);
    if (!found) {
      add("missing-column", `${propertyKey} property가 없습니다. adapter는 이 이름으로 열을 찾습니다.`);
      continue;
    }
    if (found.column !== column.column) {
      add("column-name", `${propertyKey}의 물리 열이 ${column.column}가 아니라 ${found.column}입니다.`);
    }
    if (found.type !== column.type || found.sqlType !== column.sqlType) {
      const deviation = deviationFor(tableName, propertyKey, column, found);
      if (deviation) usedDeviations.add(deviation);
      else {
        add(
          "column-type",
          `${propertyKey}이 ${column.type}/${column.sqlType}가 아니라 ${found.type}/${found.sqlType}입니다.`,
        );
      }
    }
    if (found.notNull !== column.notNull) {
      add("column-nullability", `${propertyKey}은 생성 기준으로 ${column.notNull ? "필수" : "선택"}입니다.`);
    }
    if (found.primary !== column.primary) {
      add("column-primary-key", `${propertyKey}의 primary key 여부가 생성 결과와 다릅니다.`);
    }
  }
  for (const propertyKey of declared.columns.keys()) {
    if (!expected.columns.has(propertyKey)) {
      add("unexpected-column", `${propertyKey}은 pinned generator 결과에 없는 열입니다.`);
    }
  }
  for (const signature of expected.indexes) {
    if (!declared.indexes.has(signature)) add("missing-index", `${signature} 제약이 없습니다.`);
  }
  for (const reference of expected.foreignKeys) {
    if (!declared.foreignKeys.has(reference)) add("missing-reference", `${reference} 참조가 없습니다.`);
  }
  for (const reference of declared.foreignKeys) {
    if (!expected.foreignKeys.has(reference)) add("unexpected-reference", `${reference}는 생성 결과에 없습니다.`);
  }
}

export async function inspectAuthSchema(input: AuthSchemaInput = {}): Promise<AuthSchemaFinding[]> {
  const findings: AuthSchemaFinding[] = [];
  const usedDeviations = new Set<ColumnDeviation>();
  const options = (input.options ?? authSchemaOptions) as BetterAuthOptions;
  const generated = await evaluateGeneratedTables(await generatedSchemaCode(options));
  const declaredEntries = Object.entries(input.tables ?? authProviderTables) as Array<[string, PgTable]>;
  const declaredByTableName = new Map(declaredEntries.map(([, table]) => [getTableConfig(table).name, table]));

  // adapter는 `schema[modelName]`으로 표를 찾는다. key가 물리 이름과 어긋나면 질의가 표를 찾지 못한다.
  for (const [key, table] of declaredEntries) {
    const actual = getTableConfig(table).name;
    if (key !== actual) {
      findings.push({
        table: actual,
        rule: "schema-key",
        reason: `adapter lookup key가 ${actual}가 아니라 ${key}입니다.`,
      });
    }
  }

  for (const [tableName, table] of generated) {
    const declared = declaredByTableName.get(tableName);
    if (!declared) {
      findings.push({
        table: tableName,
        rule: "missing-table",
        reason: "pinned generator가 만드는 표가 Drizzle schema에 없습니다.",
      });
      continue;
    }
    compareTable(tableName, describe(table), describe(declared), findings, usedDeviations);
  }
  for (const tableName of declaredByTableName.keys()) {
    if (!generated.has(tableName)) {
      findings.push({
        table: tableName,
        rule: "unexpected-table",
        reason: "pinned generator가 만들지 않는 표를 provider 소유로 선언했습니다.",
      });
    }
  }

  // 보조 확인: runtime이 읽는 논리 schema에도 같은 표 집합이 있어야 한다. 생성기와 runtime이 갈라지면
  // 대조가 통과해도 실제 질의가 없는 표를 찾는다.
  for (const tableName of Object.keys(getSchema(options))) {
    if (!generated.has(tableName)) {
      findings.push({
        table: tableName,
        rule: "runtime-generator-drift",
        reason: "runtime 논리 schema에는 있는데 generator 결과에는 없습니다.",
      });
    }
  }

  // 기본 table 집합을 대조할 때만 예외 목록의 유효성을 함께 본다. drift 테스트가 일부러 망가뜨린 table을
  // 넣었을 때는 쓰이지 않는 예외가 정상이다.
  if (input.tables === undefined && input.options === undefined) {
    for (const deviation of allowedColumnDeviations) {
      if (usedDeviations.has(deviation)) continue;
      findings.push({
        table: deviation.table,
        rule: "unused-deviation",
        reason: `${deviation.property}의 허용 차이가 더 이상 쓰이지 않습니다. 목록에서 지우세요.`,
      });
    }
  }

  return findings.toSorted((left, right) =>
    left.table.localeCompare(right.table) || left.rule.localeCompare(right.rule));
}

if (import.meta.main) {
  if (process.argv.includes("--print")) {
    console.log(await generatedSchemaCode(authSchemaOptions as unknown as BetterAuthOptions));
  } else {
    const findings = await inspectAuthSchema();
    if (findings.length > 0) {
      console.error("Better Auth provider schema 대조가 실패했습니다.");
      for (const finding of findings) console.error(`- ${finding.table} [${finding.rule}] ${finding.reason}`);
      process.exitCode = 1;
    } else {
      console.log("Better Auth provider schema 대조가 통과했습니다.");
    }
  }
}
