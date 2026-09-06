/**
 * @module 책임: 고정된 legacy commit의 `app.module.ts`·`main.ts`를 git blob에서 읽어 controller와 route
 * surface를 정적으로 산출하고, 같은 입력에서 항상 byte-identical한 JSON artifact를 쓰며, 산출에 쓴
 * git 호출이 실패하면 어떤 호출이 왜 실패했는지 드러낸다.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

export const pinnedLegacyCommit = "08405942e64fc22777e64e30f8e3698627a98850";

const appModulePath = "apps/server/src/app.module.ts";
const mainPath = "apps/server/src/main.ts";

export type LegacyAuthClassification =
  | "provider-transport"
  | "session-checked-in-handler"
  | "no-auth-observed";

export interface LegacySourceIdentity {
  readonly path: string;
  readonly blobHash: string;
  readonly contentSha256: string;
}

export interface LegacyControllerInventory {
  readonly name: string;
  readonly prefix: string;
  readonly sourceCommit: string;
  readonly sourcePath: string;
  readonly sourceBlobHash: string;
  readonly sourceContentSha256: string;
  readonly sourceLine: number;
  readonly routeCount: number;
}

export interface LegacyRouteInventoryItem {
  readonly controller: string;
  readonly controllerPrefix: string;
  readonly httpMethod: string;
  readonly methodPath: string;
  readonly fullPath: string;
  readonly handler: string;
  readonly authClassification: LegacyAuthClassification;
  readonly sourceCommit: string;
  readonly sourcePath: string;
  readonly sourceBlobHash: string;
  readonly sourceContentSha256: string;
  readonly sourceLine: number;
}

export interface LegacyRouteInventory {
  readonly schemaVersion: 1;
  readonly purpose: "historical-research-only";
  readonly sourceCommit: string;
  readonly globalPrefix: string;
  readonly sources: {
    readonly appModule: LegacySourceIdentity;
    readonly main: LegacySourceIdentity;
  };
  readonly controllers: readonly LegacyControllerInventory[];
  readonly routes: readonly LegacyRouteInventoryItem[];
}

export interface GenerateLegacyRouteInventoryOptions {
  readonly repoRoot: string;
  readonly commit?: string;
}

export interface WriteLegacyRouteInventoryOptions extends GenerateLegacyRouteInventoryOptions {
  readonly outputPath: string;
}

interface GitSource {
  readonly identity: LegacySourceIdentity;
  readonly text: string;
}

function git(repoRoot: string, args: readonly string[]): Buffer {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: null,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  // 부하로 프로세스 생성 자체가 실패하면 status도 stderr도 null이다. 그때 TypeError로 죽으면
  // 어떤 git 호출이 왜 실패했는지가 사라진다.
  if (result.error) {
    throw new Error(`git ${args.join(" ")} could not start in ${repoRoot}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${repoRoot} with exit ${result.status}`
      + `${result.signal ? ` (signal ${result.signal})` : ""}: `
      + `${result.stderr?.toString("utf8").trim() ?? "<stderr 없음>"}`,
    );
  }
  return result.stdout;
}

function resolveCommit(repoRoot: string, commit: string): string {
  return git(repoRoot, ["rev-parse", "--verify", `${commit}^{commit}`]).toString("utf8").trim();
}

function readGitSource(repoRoot: string, commit: string, path: string): GitSource {
  const blobHash = git(repoRoot, ["rev-parse", `${commit}:${path}`]).toString("utf8").trim();
  const bytes = git(repoRoot, ["cat-file", "blob", blobHash]);
  return {
    identity: {
      path,
      blobHash,
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
    },
    text: bytes.toString("utf8"),
  };
}

const toolsDirectory = dirname(fileURLToPath(import.meta.url));

function decoratorsOf(node: ts.HasDecorators): readonly ts.Decorator[] {
  return ts.getDecorators(node) ?? [];
}

function decoratorCall(node: ts.Decorator): ts.CallExpression | undefined {
  return ts.isCallExpression(node.expression) ? node.expression : undefined;
}

function decoratorName(node: ts.Decorator): string | undefined {
  const call = decoratorCall(node);
  return call && ts.isIdentifier(call.expression) ? call.expression.text : undefined;
}

function literalArgument(call: ts.CallExpression | undefined): string {
  const argument = call?.arguments[0];
  return argument && ts.isStringLiteralLike(argument) ? argument.text : "";
}

function sourceLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function routePath(...segments: string[]): string {
  const parts = segments.flatMap((segment) => segment.split("/")).filter(Boolean);
  return `/${parts.join("/")}`;
}

function classifyAuth(
  controllerName: string,
  method: ts.MethodDeclaration,
  sourceFile: ts.SourceFile,
): LegacyAuthClassification {
  if (controllerName === "AuthController") return "provider-transport";
  const methodText = method.getText(sourceFile);
  if (/\bgetSessionUser\s*\(|\bthis\.uid\s*\(/.test(methodText)) {
    return "session-checked-in-handler";
  }
  return "no-auth-observed";
}

function globalPrefixFrom(sourceText: string): string {
  const sourceFile = ts.createSourceFile(mainPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let prefix: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "setGlobalPrefix"
    ) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument)) prefix = argument.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (prefix === undefined) throw new Error(`No static setGlobalPrefix call found in ${mainPath}`);
  return prefix;
}

export function generateLegacyRouteInventory(
  options: GenerateLegacyRouteInventoryOptions,
): LegacyRouteInventory {
  const repoRoot = resolve(options.repoRoot);
  const commit = resolveCommit(repoRoot, options.commit ?? pinnedLegacyCommit);
  const appModule = readGitSource(repoRoot, commit, appModulePath);
  const main = readGitSource(repoRoot, commit, mainPath);
  const globalPrefix = globalPrefixFrom(main.text);
  const sourceFile = ts.createSourceFile(
    appModulePath,
    appModule.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const controllers: LegacyControllerInventory[] = [];
  const routes: LegacyRouteInventoryItem[] = [];
  const httpDecorators = new Map([
    ["Get", "GET"],
    ["Post", "POST"],
    ["Put", "PUT"],
    ["Delete", "DELETE"],
    ["Patch", "PATCH"],
    ["Options", "OPTIONS"],
    ["Head", "HEAD"],
    ["All", "ALL"],
  ]);

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name) continue;
    const controllerDecorator = decoratorsOf(statement).find((decorator) => decoratorName(decorator) === "Controller");
    if (!controllerDecorator) continue;
    const controllerName = statement.name.text;
    const controllerPrefix = literalArgument(decoratorCall(controllerDecorator));
    const controllerRoutes: LegacyRouteInventoryItem[] = [];

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
      for (const decorator of decoratorsOf(member)) {
        const method = httpDecorators.get(decoratorName(decorator) ?? "");
        if (!method) continue;
        const methodPath = literalArgument(decoratorCall(decorator));
        controllerRoutes.push({
          controller: controllerName,
          controllerPrefix,
          httpMethod: method,
          methodPath,
          fullPath: routePath(globalPrefix, controllerPrefix, methodPath),
          handler: member.name.text,
          authClassification: classifyAuth(controllerName, member, sourceFile),
          sourceCommit: commit,
          sourcePath: appModule.identity.path,
          sourceBlobHash: appModule.identity.blobHash,
          sourceContentSha256: appModule.identity.contentSha256,
          sourceLine: sourceLine(sourceFile, decorator),
        });
      }
    }

    controllers.push({
      name: controllerName,
      prefix: controllerPrefix,
      sourceCommit: commit,
      sourcePath: appModule.identity.path,
      sourceBlobHash: appModule.identity.blobHash,
      sourceContentSha256: appModule.identity.contentSha256,
      sourceLine: sourceLine(sourceFile, controllerDecorator),
      routeCount: controllerRoutes.length,
    });
    routes.push(...controllerRoutes);
  }

  return {
    schemaVersion: 1,
    purpose: "historical-research-only",
    sourceCommit: commit,
    globalPrefix,
    sources: {
      appModule: appModule.identity,
      main: main.identity,
    },
    controllers,
    routes,
  };
}

export function serializeLegacyRouteInventory(inventory: LegacyRouteInventory): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

export function writeLegacyRouteInventory(options: WriteLegacyRouteInventoryOptions): void {
  const inventory = generateLegacyRouteInventory(options);
  mkdirSync(dirname(resolve(options.outputPath)), { recursive: true });
  writeFileSync(resolve(options.outputPath), serializeLegacyRouteInventory(inventory), "utf8");
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.main) {
  const repoRoot = resolve(argument("--repo-root") ?? resolve(toolsDirectory, "../../.."));
  const commit = argument("--commit") ?? pinnedLegacyCommit;
  const outputPath = resolve(
    argument("--output") ?? resolve(repoRoot, "docs/architecture/legacy-server-route-inventory.json"),
  );
  writeLegacyRouteInventory({ repoRoot, commit, outputPath });
  const inventory = generateLegacyRouteInventory({ repoRoot, commit });
  console.log(`Wrote ${inventory.controllers.length} controllers and ${inventory.routes.length} routes to ${outputPath}`);
}
