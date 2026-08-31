import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { hasSensitiveContent } from "./sensitive-content.mjs";

const sourcePattern = /\.[cm]?[jt]sx?$/i;
const generatedSegments = new Set([".next", "__generated__", "build", "coverage", "dist", "gen", "generated", "node_modules"]);
const lockfiles = new Set(["bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const defaultPerFileByteCap = 16 * 1024;
const defaultTotalSourceByteCap = 48 * 1024;
const defaultDeclarationByteCap = 16 * 1024;

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const normalizeSource = (value) => value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function relativePath(root, file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function absolutePath(root, input) {
  const candidate = path.isAbsolute(input) ? path.resolve(input) : path.resolve(root, input.replaceAll("/", path.sep));
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative) ? candidate : undefined;
}

function denialReason(relative) {
  const normalized = relative.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const basename = segments.at(-1)?.toLowerCase() ?? "";
  if (lockfiles.has(basename)) return "lockfile";
  if (segments.slice(0, -1).some((segment) => generatedSegments.has(segment.toLowerCase())) || /(?:^|[._-])(?:__generated__|generated|gen)(?:\.d)?\.[cm]?[jt]sx?$/i.test(basename)) return "generated-output";
  if (segments.some((segment) => /^\.env(?:\.|$)/i.test(segment)) || /(?:credential|private[-_.]?key|secrets?)(?:\.|$)/i.test(basename) || /\.(?:key|p12|pem)$/i.test(basename)) return "secret-path";
  return undefined;
}

function walkSourceFiles(root) {
  const files = [];
  const visit = (entry) => {
    if (!existsSync(entry)) return;
    const stat = statSync(entry);
    if (stat.isDirectory()) {
      if (generatedSegments.has(path.basename(entry).toLowerCase())) return;
      for (const child of readdirSync(entry).sort(compare)) visit(path.join(entry, child));
    } else if (sourcePattern.test(entry) && denialReason(path.basename(entry)) !== "generated-output") files.push(path.resolve(entry));
  };
  visit(root);
  return files.sort(compare);
}

function catalogCandidates(root, changedPaths, exclusions) {
  const candidates = new Set();
  const roots = ["apps/web/src/hooks", "apps/web/src/shared"];
  for (const relative of roots) for (const file of walkSourceFiles(path.join(root, relative))) candidates.add(file);
  const compatibility = path.join(root, "apps", "web", "src", "lib", "utils.ts");
  if (existsSync(compatibility)) candidates.add(path.resolve(compatibility));
  for (const changed of changedPaths) {
    const file = absolutePath(root, changed);
    const relative = file ? relativePath(root, file) : String(changed).replaceAll("\\", "/");
    const denied = denialReason(relative);
    if (denied) exclusions.push({ path: relative, reason: denied });
    else if (!file || !existsSync(file)) exclusions.push({ path: relative, reason: "missing-file" });
    else if (!relative.startsWith("apps/web/") || !sourcePattern.test(relative)) exclusions.push({ path: relative, reason: "out-of-scope" });
    else candidates.add(file);
  }
  return candidates;
}

function moduleReferences(sourceFile) {
  const references = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) references.push(node.moduleSpecifier.text);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) references.push(node.moduleReference.expression.text);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) references.push(node.argument.literal.text);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) references.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function parseSourceFile(file) {
  const extension = path.extname(file).toLowerCase();
  const scriptKind = extension === ".tsx" ? ts.ScriptKind.TSX : extension === ".jsx" ? ts.ScriptKind.JSX : extension === ".js" || extension === ".mjs" || extension === ".cjs" ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true, scriptKind);
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function bindingNames(name, names) {
  if (ts.isIdentifier(name)) names.add(name.text);
  else for (const element of name.elements) if (ts.isBindingElement(element)) bindingNames(element.name, names);
}

function exportedNames(file, options, webRoot, sourceCache, exportCache) {
  const absolute = path.resolve(file);
  if (exportCache.has(absolute)) return exportCache.get(absolute);
  const names = new Set();
  exportCache.set(absolute, names);
  const sourceFile = sourceCache.get(absolute) ?? parseSourceFile(absolute);
  sourceCache.set(absolute, sourceFile);
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) names.add("default");
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const element of statement.exportClause.elements) names.add(element.name.text);
      else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) names.add(statement.exportClause.name.text);
      else if (!statement.exportClause && statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)) {
        const target = ts.resolveModuleName(statement.moduleSpecifier.text, absolute, options, ts.sys).resolvedModule?.resolvedFileName;
        if (target && path.resolve(target).startsWith(`${webRoot}${path.sep}`)) for (const name of exportedNames(target, options, webRoot, sourceCache, exportCache)) if (name !== "default") names.add(name);
      }
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) names.add("default");
    else if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, names);
    else if ("name" in statement && statement.name && ts.isIdentifier(statement.name)) names.add(statement.name.text);
  }
  return names;
}

function readJson(file) {
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; }
}

function directDependency(root) {
  for (const manifestPath of ["apps/web/package.json", "package.json"]) {
    const manifest = readJson(path.join(root, manifestPath));
    for (const field of dependencyFields) if (typeof manifest[field]?.["es-toolkit"] === "string") return { declared: true, version: manifest[field]["es-toolkit"], manifestPath, field };
  }
  return { declared: false };
}

function toolkitEvidence(root, declarationByteCap) {
  const direct = directDependency(root);
  const candidates = [
    "node_modules/.pnpm/node_modules/es-toolkit",
    "node_modules/es-toolkit",
    "apps/web/node_modules/es-toolkit",
  ];
  const installedPath = candidates.map((item) => path.join(root, item)).find((item) => existsSync(path.join(item, "package.json")));
  if (!installedPath) return {
    installed: false,
    directDeclared: direct.declared,
    ...(direct.version ? { declaredVersion: direct.version, declaredIn: direct.manifestPath, declaredField: direct.field } : {}),
    productionImportPolicy: direct.declared ? "direct-dependency-reviewed" : "transitive-only",
    warning: "es-toolkit declaration evidence is unavailable; do not recommend a production import.",
  };
  const exactPath = realpathSync(installedPath);
  const version = readJson(path.join(exactPath, "package.json")).version;
  const declarationPath = path.join(exactPath, "dist", "index.d.ts");
  const declaration = existsSync(declarationPath) ? normalizeSource(readFileSync(declarationPath, "utf8")) : undefined;
  const fits = declaration !== undefined && Buffer.byteLength(declaration, "utf8") <= declarationByteCap;
  const transitive = !direct.declared;
  return {
    installed: true,
    version,
    directDeclared: direct.declared,
    ...(direct.version ? { declaredVersion: direct.version, declaredIn: direct.manifestPath, declaredField: direct.field } : {}),
    productionImportPolicy: transitive ? "transitive-only" : "direct-dependency-reviewed",
    warning: transitive
      ? "Transitive-only evidence: direct production imports are forbidden until a reviewed exact direct dependency and repeated use case are added."
      : "A direct declaration exists, but recommendations still require repository evidence and a demonstrated repeated use case.",
    declarationPath: "dist/index.d.ts",
    ...(fits ? { declaration } : { declarationExcludedReason: declaration === undefined ? "missing-declaration" : "declaration-byte-cap" }),
  };
}

export async function buildReuseCatalog({
  repoRoot,
  changedPaths = [],
  perFileByteCap = defaultPerFileByteCap,
  totalSourceByteCap = defaultTotalSourceByteCap,
  esToolkitDeclarationByteCap = defaultDeclarationByteCap,
}) {
  const root = path.resolve(repoRoot);
  const normalizedChanged = [...new Set(changedPaths.map((item) => String(item).replaceAll("\\", "/")))].sort(compare);
  const changedSet = new Set(normalizedChanged);
  const exclusions = [];
  const candidates = catalogCandidates(root, normalizedChanged, exclusions);
  const webRoot = path.join(root, "apps", "web");
  const allSources = walkSourceFiles(webRoot);
  const options = { allowJs: true, baseUrl: path.join(webRoot, "src"), checkJs: false, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, paths: { "@/*": ["*"] }, target: ts.ScriptTarget.ESNext };
  const sourceCache = new Map();
  const exportCache = new Map();
  const candidateByPath = new Map([...candidates].map((file) => [path.resolve(file), relativePath(root, file)]));
  const consumers = new Map([...candidates].map((file) => [path.resolve(file), new Set()]));
  for (const consumerFile of allSources) {
    const sourceFile = sourceCache.get(consumerFile) ?? parseSourceFile(consumerFile);
    sourceCache.set(consumerFile, sourceFile);
    const consumerPath = relativePath(root, consumerFile);
    for (const specifier of moduleReferences(sourceFile)) {
      const resolved = ts.resolveModuleName(specifier, sourceFile.fileName, options, ts.sys).resolvedModule?.resolvedFileName;
      const target = resolved ? path.resolve(resolved) : undefined;
      if (target && target !== path.resolve(sourceFile.fileName) && candidateByPath.has(target)) consumers.get(target).add(consumerPath);
    }
  }
  const contents = new Map();
  const modules = [...candidates].map((file) => {
    const absolute = path.resolve(file);
    const modulePath = relativePath(root, absolute);
    const source = normalizeSource(readFileSync(absolute, "utf8"));
    contents.set(absolute, source);
    const exports = [...exportedNames(absolute, options, webRoot, sourceCache, exportCache)].sort(compare);
    const directConsumers = [...(consumers.get(absolute) ?? [])].sort(compare);
    return { path: modulePath, changed: changedSet.has(modulePath), exports, directConsumers, consumerCount: directConsumers.length, reviewStatus: directConsumers.length ? "used" : "candidate", sourceBytes: Buffer.byteLength(source, "utf8") };
  }).sort((left, right) => Number(right.changed) - Number(left.changed) || compare(left.path, right.path));
  let sourceByteTotal = 0;
  for (const module of modules) {
    const absolute = absolutePath(root, module.path);
    const source = contents.get(absolute);
    if (hasSensitiveContent(source, module.path)) exclusions.push({ path: module.path, reason: "sensitive-content" });
    else if (module.sourceBytes > perFileByteCap) exclusions.push({ path: module.path, reason: "per-file-byte-cap" });
    else if (sourceByteTotal + module.sourceBytes > totalSourceByteCap) exclusions.push({ path: module.path, reason: "total-source-byte-cap" });
    else {
      module.source = source;
      sourceByteTotal += module.sourceBytes;
    }
  }
  const duplicateMap = new Map();
  for (const [file, source] of contents) {
    if (hasSensitiveContent(source, file)) continue;
    const fingerprint = sha256(source);
    const members = duplicateMap.get(fingerprint) ?? [];
    members.push(relativePath(root, file));
    duplicateMap.set(fingerprint, members);
  }
  const duplicateGroups = [...duplicateMap].filter(([, members]) => members.length > 1).map(([contentSha256, members]) => ({ contentSha256, members: members.sort(compare) })).sort((left, right) => compare(left.members[0], right.members[0]));
  const uniqueExclusions = [...new Map(exclusions.map((item) => [`${item.path}\0${item.reason}`, item])).values()].sort((left, right) => compare(`${left.path}\0${left.reason}`, `${right.path}\0${right.reason}`));
  return { version: "eatbid.reuse-catalog/v1", modules, duplicateGroups, esToolkit: toolkitEvidence(root, esToolkitDeclarationByteCap), exclusions: uniqueExclusions, sourceByteTotal, blockingFindings: [] };
}
