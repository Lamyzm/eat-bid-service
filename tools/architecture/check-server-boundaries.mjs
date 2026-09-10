/** @module 책임: 서버 모듈의 application 계층이 공개 wire 타입을 import하지 않는지 검사해 ADR 0045의 presenter 이음매를 CLI 실패로 지킨다. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = process.env.SERVER_BOUNDARIES_ROOT
  ? path.resolve(process.env.SERVER_BOUNDARIES_ROOT)
  : fileURLToPath(new URL("../../", import.meta.url));

/**
 * 공개 wire 이름 규약이다. `*V1Response`·`*V1`·`*Wire`는 Zod에서 추론한 wire 타입이고 `*Schema`는 그 schema
 * 값이다. `MartCoverage`처럼 접미사가 없는 enum 어휘는 application 입력의 낱말이라 막지 않는다.
 */
const WIRE_EXPORT = /(?:V1Response|V1|Wire|Schema)$/u;
const CONTRACTS_PACKAGE = /^@eatbid\/contracts(?:\/|$)/u;
const APPLICATION_SOURCE = /^[^/]+\/application\/.+\.[cm]?ts$/u;
const TEST_FILE = /\.(?:test|spec)\.[cm]?tsx?$/u;
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function sourceFiles(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { recursive: true });
  } catch {
    return [];
  }
  return entries
    .map((entry) => entry.toString().replaceAll("\\", "/"))
    .filter((entry) => APPLICATION_SOURCE.test(entry) && !TEST_FILE.test(entry))
    .filter((entry) => statSync(path.join(directory, entry)).isFile())
    .sort(compare);
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function contractsImports(sourceFile) {
  const imports = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (!CONTRACTS_PACKAGE.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      imports.push({ kind: "namespace", name: bindings.name.text, line: lineOf(sourceFile, bindings) });
      continue;
    }
    for (const element of bindings.elements) {
      // alias(`as`)로 이름을 바꿔도 계약이 내보낸 원래 이름으로 판정한다.
      const name = element.propertyName?.text ?? element.name.text;
      imports.push({ kind: "named", name, line: lineOf(sourceFile, element) });
    }
  }
  return imports;
}

/**
 * `sourceRoot` 아래 `<module>/application/**`의 production 파일만 본다. presenter가 사는 `presentation/http`와
 * 테스트는 wire 타입을 당연히 import하므로 대상이 아니다.
 */
export function inspectServerBoundaries({ repoRoot: root, sourceRoot = "apps/server/src/modules" }) {
  const directory = path.join(path.resolve(root), sourceRoot);
  const files = sourceFiles(directory);
  const findings = [];
  for (const file of files) {
    const repositoryPath = `${sourceRoot}/${file}`;
    const source = readFileSync(path.join(directory, file), "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const item of contractsImports(sourceFile)) {
      if (item.kind === "namespace") {
        findings.push({
          path: repositoryPath,
          line: item.line,
          rule: "application-imports-wire-type",
          reason: `application이 @eatbid/contracts 전체를 namespace로 import한다. wire 타입이 숨어 들어오므로 필요한 어휘만 이름으로 import한다(ADR 0045 결정 1).`,
        });
      } else if (WIRE_EXPORT.test(item.name)) {
        findings.push({
          path: repositoryPath,
          line: item.line,
          rule: "application-imports-wire-type",
          reason: `application이 공개 wire ${item.name}을(를) import한다. 직렬화는 presentation/http의 presenter가 맡고 use case는 내부 record만 돌려준다(ADR 0045 결정 1).`,
        });
      }
    }
  }
  return { inspectedCount: files.length, findings };
}

function main() {
  const report = inspectServerBoundaries({ repoRoot });
  if (report.findings.length) {
    console.error("Server module 경계 검사가 실패했습니다:");
    for (const item of report.findings) console.error(`- ${item.path}:${item.line} [${item.rule}] ${item.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Server module 경계 검사가 통과했습니다. application 모듈 ${report.inspectedCount}개`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
