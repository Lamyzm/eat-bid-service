/** @module 책임: contracts의 browser-safe export가 Node 전용 graph를 노출하지 않는지 검사한다. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const clientExports = Object.freeze([
  // 코드 체계 이름은 transport도 resource도 아니지만 화면이 참조해야 하는 어휘라서 자체 subpath를 갖는다.
  // 이 진입점이 없으면 화면이 체계 문자열을 다시 선언하게 된다(ADR 0035, `lint:region-vocabulary`).
  ["./atoms/code-scheme-names", "./src/atoms/code-scheme-names.ts"],
  // 읽기 캐시 태그는 web read 함수와 무효화 함수가 같은 생성기를 쓰게 만드는 어휘다. 진입점이 없으면
  // 태그 문자열이 계약과 화면 두 곳에 살고, 한쪽만 바뀌는 순간 무효화가 조용히 아무것도 지우지 않는다.
  ["./values/cache-tag", "./src/values/cache-tag.ts"],
  ["./api", "./src/api/index.ts"],
  ["./api/v1/auctions", "./src/api/v1/auctions/index.ts"],
  ["./api/v1/organizations", "./src/api/v1/organizations/index.ts"],
  ["./api/v1/win-rate-distribution", "./src/api/v1/win-rate-distribution/index.ts"],
]);
const forbiddenGraphPath = /\/(?:codecs|ingestion|operations)\/|\/portable-registry\.ts$|\/generate-json-schema\.ts$/;
const forbiddenBareImport = /^(?:@eatbid\/domain|next(?:\/|$)|react(?:\/|$)|server-only$|node:)/;

function normalized(root, file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function add(findings, root, file, rule, reason) {
  findings.push({ path: normalized(root, file), rule, reason });
}

function moduleSpecifiers(sourceFile) {
  const values = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      values.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      values.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

function resolveRelative(from, specifier) {
  const base = path.resolve(path.dirname(from), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(existsSync);
}

function walkClientGraph(root, entry, findings) {
  const pending = [entry];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (!file || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const sourceFile = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const specifier of moduleSpecifiers(sourceFile)) {
      if (!specifier.startsWith(".")) {
        if (forbiddenBareImport.test(specifier)) {
          add(findings, root, file, "client-export-forbidden-import", `browser-safe 계약이 ${specifier}를 참조합니다.`);
        }
        continue;
      }
      const target = resolveRelative(file, specifier);
      if (!target) continue;
      const targetPath = target.replaceAll("\\", "/");
      if (forbiddenGraphPath.test(targetPath)) {
        add(findings, root, file, "client-export-forbidden-import", `browser-safe 계약이 ${normalized(root, target)}를 참조합니다.`);
      }
      pending.push(target);
    }
  }
}

function webSourceFiles(root) {
  const sourceRoot = path.join(root, "apps/web/src");
  const files = [];
  const visit = (entry) => {
    if (!existsSync(entry)) return;
    const relative = normalized(root, entry);
    if (/(?:^|\/)(?:node_modules|\.next|fixtures?|__tests?__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative)) return;
    if (statSync(entry).isDirectory()) for (const child of readdirSync(entry)) visit(path.join(entry, child));
    else if (/\.[cm]?[jt]sx?$/.test(entry)) files.push(entry);
  };
  visit(sourceRoot);
  return files;
}

export function inspectContractClientExports({ repoRoot }) {
  const root = path.resolve(repoRoot);
  const findings = [];
  const packagePath = path.join(root, "packages/contracts/package.json");
  if (existsSync(packagePath)) {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    const sourcePackagePath = path.join(root, "packages/contracts/src/package.json");
    if (packageJson.type === "commonjs") {
      const sourcePackageJson = existsSync(sourcePackagePath)
        ? JSON.parse(readFileSync(sourcePackagePath, "utf8"))
        : undefined;
      if (sourcePackageJson?.type !== "module") {
        add(
          findings,
          root,
          sourcePackagePath,
          "client-source-module-boundary",
          "CommonJS 배포물과 분리된 source export에는 type=module 경계가 필요합니다.",
        );
      }
    }
    for (const [exportName, sourceEntry] of clientExports) {
      const published = packageJson.exports?.[exportName];
      for (const condition of ["types", "import", "default"]) {
        const target = published?.[condition];
        if (target !== sourceEntry) {
          add(findings, root, packagePath, target?.includes("dist") ? "client-export-dist-target" : "client-export-source-target", `${exportName} ${condition}은 ${sourceEntry}여야 합니다.`);
        }
      }
      const entry = path.join(root, "packages/contracts", sourceEntry.slice(2));
      walkClientGraph(root, entry, findings);
    }
  }
  const nextConfig = path.join(root, "apps/web/next.config.ts");
  if (!existsSync(nextConfig) || !readFileSync(nextConfig, "utf8").includes("'@eatbid/contracts'")) {
    add(findings, root, nextConfig, "contracts-transpile-missing", "Next transpilePackages에 @eatbid/contracts가 필요합니다.");
  }
  for (const file of webSourceFiles(root)) {
    const sourceFile = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    if (moduleSpecifiers(sourceFile).includes("@eatbid/contracts")) {
      add(findings, root, file, "web-contract-root-import", "Web은 @eatbid/contracts의 client-safe resource subpath만 import해야 합니다.");
    }
  }
  return findings.toSorted((left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule));
}

const directRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directRun) {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const findings = inspectContractClientExports({ repoRoot });
  if (findings.length) {
    console.error("계약 client export 검사가 실패했습니다.");
    for (const finding of findings) console.error(`- ${finding.path} [${finding.rule}] ${finding.reason}`);
    process.exitCode = 1;
  } else {
    console.log("계약 client export 검사가 통과했습니다.");
  }
}
