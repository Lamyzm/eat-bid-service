import { existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));

export type ArchitectureRule =
  | "controller-database-boundary"
  | "domain-framework-free"
  | "application-dependency-direction"
  | "effect-runner-only"
  | "non-literal-module-reference"
  | "root-module-import-only"
  | "cross-feature-internal-import"
  | "source-dependency-cycle";

export interface ArchitectureViolation {
  readonly rule: ArchitectureRule;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface CheckArchitectureOptions {
  readonly projectPath?: string;
}

interface Dependency {
  readonly specifier: string;
  readonly target?: string;
  readonly line: number;
}

interface NonLiteralModuleReference {
  readonly kind: "dynamic import" | "require";
  readonly line: number;
}

interface SourceNode {
  readonly file: ts.SourceFile;
  readonly dependencies: Dependency[];
  readonly nonLiteralModuleReferences: NonLiteralModuleReference[];
}

interface ModuleReference {
  readonly specifier?: string;
  readonly node: ts.Node;
  readonly kind: "static import" | "dynamic import" | "require";
}

interface ReachableDependency {
  readonly dependency: Dependency;
  readonly owner: string;
  readonly path: readonly string[];
}

const productionFile = (fileName: string): boolean =>
  !/\.(?:test|spec)\.tsx?$/.test(fileName) && !fileName.includes(`${sep}testing${sep}`);

const normalize = (path: string): string => resolve(path).replaceAll("\\", "/");

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function moduleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
  const references: ModuleReference[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({
        specifier: node.moduleSpecifier.text,
        node: node.moduleSpecifier,
        kind: "static import",
      });
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      references.push({
        specifier: node.moduleReference.expression.text,
        node: node.moduleReference.expression,
        kind: "static import",
      });
    } else if (ts.isCallExpression(node)) {
      const kind = node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? "dynamic import"
        : ts.isIdentifier(node.expression) && node.expression.text === "require"
          ? "require"
          : undefined;
      if (kind) {
        const [argument] = node.arguments;
        references.push({
          specifier: argument && ts.isStringLiteralLike(argument) ? argument.text : undefined,
          node: argument ?? node,
          kind,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function isPackage(specifier: string, packageName: string): boolean {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function isDatabasePackage(specifier: string): boolean {
  return ["drizzle-orm", "postgres", "@eatbid/db"].some((name) => isPackage(specifier, name));
}

function isDomainForbiddenPackage(specifier: string): boolean {
  return ["@nestjs", "effect", "drizzle-orm", "zod", "express", "@types/express"]
    .some((name) => isPackage(specifier, name))
    || ["http", "https", "node:http", "node:https"].includes(specifier);
}

function isDatabaseSchemaPath(fileName: string): boolean {
  const path = normalize(fileName).toLowerCase();
  return path.includes("/packages/db/")
    || path.includes("/database/schema/")
    || path.endsWith("/database/schema.ts")
    || path.includes("/db/schema/")
    || path.endsWith("/db/schema.ts");
}

function resolvedAlias(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  const visited = new Set<ts.Symbol>();
  let current = symbol;
  while (current && current.flags & ts.SymbolFlags.Alias && !visited.has(current)) {
    visited.add(current);
    current = checker.getAliasedSymbol(current);
  }
  return current;
}

function isNestControllerSymbol(checker: ts.TypeChecker, node: ts.Node): boolean {
  const symbol = resolvedAlias(checker, checker.getSymbolAtLocation(node));
  return symbol?.getName() === "Controller"
    && symbol.declarations?.some((declaration) =>
      normalize(declaration.getSourceFile().fileName).includes("/node_modules/@nestjs/common/")) === true;
}

function isController(sourceFile: ts.SourceFile, checker: ts.TypeChecker): boolean {
  if (/\.controller\.tsx?$/.test(sourceFile.fileName.replaceAll("\\", "/"))) return true;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || !ts.isClassDeclaration(node)) return;
    for (const decorator of ts.getDecorators(node) ?? []) {
      const expression = decorator.expression;
      const decoratorTarget = ts.isCallExpression(expression) ? expression.expression : expression;
      if (isNestControllerSymbol(checker, decoratorTarget)) {
        found = true;
      }
    }
  };
  sourceFile.forEachChild(visit);
  return found;
}

function moduleMetadata(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== "AppModule") continue;
    for (const decorator of ts.getDecorators(statement) ?? []) {
      const expression = decorator.expression;
      if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)
        || expression.expression.text !== "Module") continue;
      const [metadata] = expression.arguments;
      if (metadata && ts.isObjectLiteralExpression(metadata)) return metadata;
    }
  }
  return undefined;
}

function isImportOnlyMetadata(metadata: ts.ObjectLiteralExpression | undefined): boolean {
  if (!metadata || metadata.properties.length !== 1) return false;
  const [property] = metadata.properties;
  if (!property || !ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) {
    return false;
  }
  return (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
    && property.name.text === "imports";
}

function featureOf(fileName: string): string | undefined {
  const match = normalize(fileName).match(/\/src\/modules\/([^/]+)\//);
  return match?.[1];
}

function relativeFile(projectRoot: string, fileName: string): string {
  return relative(projectRoot, fileName).replaceAll("\\", "/");
}

export function checkArchitecture(options: CheckArchitectureOptions = {}): ArchitectureViolation[] {
  const projectPath = resolve(options.projectPath ?? resolve(toolsDirectory, "../tsconfig.json"));
  const projectRoot = dirname(projectPath);
  const configResult = ts.readConfigFile(projectPath, ts.sys.readFile);
  if (configResult.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configResult.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(configResult.config, ts.sys, projectRoot, undefined, projectPath);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();
  const sourceRoot = normalize(resolve(projectRoot, "src"));
  const sourceFiles = program.getSourceFiles().filter((file) =>
    productionFile(file.fileName) && normalize(file.fileName).startsWith(`${sourceRoot}/`));
  const nodes = new Map<string, SourceNode>();

  for (const file of sourceFiles) {
    const references = moduleReferences(file);
    const dependencies = references.flatMap(({ specifier, node }) => {
      if (specifier === undefined) return [];
      const resolvedModule = ts.resolveModuleName(
        specifier,
        file.fileName,
        parsed.options,
        ts.sys,
      ).resolvedModule;
      const candidate = resolvedModule ? normalize(resolvedModule.resolvedFileName) : undefined;
      return [{
        specifier,
        target: candidate,
        line: lineOf(file, node),
      }];
    });
    const nonLiteralModuleReferences: NonLiteralModuleReference[] = references.flatMap(
      ({ specifier, node, kind }) => specifier === undefined && kind !== "static import"
        ? [{ kind, line: lineOf(file, node) }]
        : [],
    );
    nodes.set(normalize(file.fileName), { file, dependencies, nonLiteralModuleReferences });
  }

  const violations: ArchitectureViolation[] = [];
  const add = (rule: ArchitectureRule, file: ts.SourceFile, line: number, message: string): void => {
    if (!violations.some((item) => item.rule === rule && item.file === relativeFile(projectRoot, file.fileName)
      && item.line === line && item.message === message)) {
      violations.push({ rule, file: relativeFile(projectRoot, file.fileName), line, message });
    }
  };

  const reachableDependencies = (start: string): ReachableDependency[] => {
    const found: ReachableDependency[] = [];
    const visited = new Set<string>();
    const visit = (fileName: string, path: readonly string[]): void => {
      if (visited.has(fileName)) return;
      visited.add(fileName);
      for (const dependency of nodes.get(fileName)?.dependencies ?? []) {
        found.push({ dependency, owner: fileName, path });
        if (dependency.target && nodes.has(dependency.target)) {
          visit(dependency.target, [...path, dependency.target]);
        }
      }
    };
    visit(start, [start]);
    return found;
  };

  for (const [fileName, node] of nodes) {
    for (const reference of node.nonLiteralModuleReferences) {
      add(
        "non-literal-module-reference",
        node.file,
        reference.line,
        `Non-literal ${reference.kind} module specifier cannot be proven safe.`,
      );
    }

    if (isController(node.file, checker)) {
      for (const { dependency, owner, path } of reachableDependencies(fileName)) {
        if (isDatabasePackage(dependency.specifier)
          || (dependency.target !== undefined && isDatabaseSchemaPath(dependency.target))) {
          const edgeOwner = nodes.get(owner)?.file ?? node.file;
          add(
            "controller-database-boundary",
            edgeOwner,
            dependency.line,
            `Controller path '${path.map((item) => relativeFile(projectRoot, item)).join(" -> ")}' reaches database dependency '${dependency.specifier}'.`,
          );
        }
      }
    }

    if (fileName.includes("/domain/")) {
      for (const { dependency, owner } of reachableDependencies(fileName)) {
        if (isDomainForbiddenPackage(dependency.specifier)) {
          add(
            "domain-framework-free",
            nodes.get(owner)?.file ?? node.file,
            dependency.line,
            `Domain reaches forbidden dependency '${dependency.specifier}'.`,
          );
        }
      }
    }

    if (fileName.includes("/application/")) {
      for (const { dependency, owner } of reachableDependencies(fileName)) {
        if (dependency.target && (dependency.target.includes("/presentation/")
          || dependency.target.includes("/infrastructure/"))) {
          add(
            "application-dependency-direction",
            nodes.get(owner)?.file ?? node.file,
            dependency.line,
            `Application reaches forbidden layer '${relativeFile(projectRoot, dependency.target)}'.`,
          );
        }
      }
    }

    const sourceFeature = featureOf(fileName);
    if (sourceFeature) {
      for (const dependency of node.dependencies) {
        if (!dependency.target) continue;
        const targetFeature = featureOf(dependency.target);
        if (targetFeature && targetFeature !== sourceFeature
          && (dependency.target.includes("/presentation/") || dependency.target.includes("/infrastructure/"))) {
          add(
            "cross-feature-internal-import",
            node.file,
            dependency.line,
            `Feature '${sourceFeature}' imports internal layer of feature '${targetFeature}'.`,
          );
        }
      }
    }

    if (!fileName.endsWith("/platform/effect/effect-runner.ts")) {
      const visit = (astNode: ts.Node): void => {
        if (ts.isCallExpression(astNode)) {
          const symbol = resolvedAlias(checker, checker.getSymbolAtLocation(astNode.expression));
          const symbolName = symbol?.getName();
          const declaredByEffect = symbol?.declarations?.some((declaration) => {
            const declarationPath = normalize(declaration.getSourceFile().fileName);
            return declarationPath.includes("/node_modules/effect/");
          });
          if (declaredByEffect && symbolName?.startsWith("runPromise")) {
            add(
              "effect-runner-only",
              node.file,
              lineOf(node.file, astNode),
              `Effect.${symbolName} may only be called by EffectRunner.`,
            );
          }
        }
        ts.forEachChild(astNode, visit);
      };
      visit(node.file);
    }
  }

  const rootModule = nodes.get(normalize(resolve(projectRoot, "src/app.module.ts")));
  if (rootModule) {
    const metadata = moduleMetadata(rootModule.file);
    if (!isImportOnlyMetadata(metadata)) {
      add(
        "root-module-import-only",
        rootModule.file,
        metadata ? lineOf(rootModule.file, metadata) : 1,
        "Root AppModule metadata must contain only an imports declaration.",
      );
    }
  }

  const colors = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const reportedCycles = new Set<string>();
  const visitCycle = (fileName: string): void => {
    colors.set(fileName, 1);
    stack.push(fileName);
    for (const dependency of nodes.get(fileName)?.dependencies ?? []) {
      if (!dependency.target || !nodes.has(dependency.target)) continue;
      if ((colors.get(dependency.target) ?? 0) === 0) visitCycle(dependency.target);
      else if (colors.get(dependency.target) === 1) {
        const start = stack.indexOf(dependency.target);
        const cycle = [...stack.slice(start), dependency.target];
        const key = [...new Set(cycle)].sort().join("|");
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          const source = nodes.get(fileName)!.file;
          add(
            "source-dependency-cycle",
            source,
            dependency.line,
            `Source dependency cycle: ${cycle.map((item) => relativeFile(projectRoot, item)).join(" -> ")}`,
          );
        }
      }
    }
    stack.pop();
    colors.set(fileName, 2);
  };
  for (const fileName of nodes.keys()) if ((colors.get(fileName) ?? 0) === 0) visitCycle(fileName);

  return violations.sort((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line || left.rule.localeCompare(right.rule));
}

if (import.meta.main) {
  const projectPath = process.argv[2] ? resolve(process.argv[2]) : resolve(toolsDirectory, "../tsconfig.json");
  if (!existsSync(projectPath)) throw new Error(`TypeScript project not found: ${projectPath}`);
  const violations = checkArchitecture({ projectPath });
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`);
  }
  if (violations.length > 0) process.exitCode = 1;
  else console.log("Server architecture check passed with 0 violations.");
}
