import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = process.env.SEMANTIC_VALUES_ROOT
  ? path.resolve(process.env.SEMANTIC_VALUES_ROOT)
  : fileURLToPath(new URL("../../", import.meta.url));
const baselinePath = process.env.SEMANTIC_VALUES_BASELINE
  ? path.resolve(process.env.SEMANTIC_VALUES_BASELINE)
  : path.join(repositoryRoot, "tools", "architecture", "semantic-value-legacy-baseline.json");
const writeBaseline = process.argv.slice(2).includes("--write-baseline");
const allowedLegacyPrefixes = ["apps/web/src/", "packages/shared/src/"];
const forbiddenDatePackages = new Set(["dayjs", "date-fns", "moment", "luxon"]);
const canonicalFloatingColumn = /(?:^|_)(?:amount|money|price|rate|ratio|percent|percentage)(?:_|$)/i;
const durationName = /(?:timeout|interval|ttl|grace|delay|debounce|throttle)(?:ms|millis|milliseconds)?$/i;
const exactAuctionAdapter = "apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts";
const exactClockFacade = "packages/domain/src/time/clock.ts";
const sourceFilesByPath = new Map();

function normalizePath(file) {
  return path.relative(repositoryRoot, file).replaceAll("\\", "/");
}

function governedFiles() {
  const roots = [
    path.join(repositoryRoot, "apps", "server", "src"),
    path.join(repositoryRoot, "apps", "web", "src"),
  ];
  const packages = path.join(repositoryRoot, "packages");
  if (existsSync(packages)) {
    for (const entry of readdirSync(packages)) {
      const source = path.join(packages, entry, "src");
      if (existsSync(source)) roots.push(source);
    }
  }

  const files = [];
  const visit = (entry) => {
    if (!existsSync(entry)) return;
    const stats = statSync(entry);
    if (stats.isDirectory()) {
      const name = path.basename(entry);
      if (["node_modules", "dist", ".next", "coverage", "__tests__", "testing"].includes(name)) return;
      for (const child of readdirSync(entry)) visit(path.join(entry, child));
      return;
    }
    if (!/\.(?:[cm]?ts|tsx)$/.test(entry) || /\.(?:test|spec)\.[cm]?tsx?$/.test(entry)) return;
    files.push(entry);
  };
  for (const root of roots) visit(root);
  return files.sort();
}

const fileNames = governedFiles();
const governedFileKeys = new Set(fileNames.map((file) => path.resolve(file).toLowerCase()));
const program = ts.createProgram({
  rootNames: fileNames,
  options: {
    allowJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  },
});
const checker = program.getTypeChecker();
const assignedValuesBySymbol = new Map();
for (const sourceFile of program.getSourceFiles()) {
  if (!sourceFile.isDeclarationFile && governedFileKeys.has(path.resolve(sourceFile.fileName).toLowerCase())) {
    sourceFilesByPath.set(path.resolve(sourceFile.fileName), sourceFile);
  }
}

function moduleSpecifier(declaration) {
  let current = declaration;
  while (current) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) {
      return current.moduleSpecifier && ts.isStringLiteralLike(current.moduleSpecifier)
        ? current.moduleSpecifier.text
        : undefined;
    }
    current = current.parent;
  }
  return undefined;
}

function declarationName(declaration) {
  if (ts.isImportSpecifier(declaration)) return (declaration.propertyName ?? declaration.name).text;
  if (ts.isNamespaceImport(declaration)) return "*";
  if (ts.isImportClause(declaration)) return "default";
  return undefined;
}

function symbolIsRepositoryLocal(symbol) {
  return Boolean(symbol?.declarations?.some((declaration) => {
    const source = declaration.getSourceFile();
    return !source.isDeclarationFile && normalizePath(source.fileName) !== source.fileName;
  }));
}

function symbolFor(node) {
  try {
    return checker.getSymbolAtLocation(node);
  } catch {
    return undefined;
  }
}

function declarationsForSymbol(symbol) {
  if (!symbol) return [];
  let resolved = symbol;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      const target = checker.getAliasedSymbol(symbol);
      if (target && target !== symbol && target.declarations?.length) resolved = target;
    } catch {
      // Unresolved imports still retain their alias declaration below.
    }
  }
  return [...new Set([...(resolved.declarations ?? []), ...(symbol.declarations ?? [])])];
}

function collectAssignedTargets(target, value, position, properties = []) {
  const current = unwrap(target);
  if (ts.isIdentifier(current)) {
    const symbol = symbolFor(current);
    if (symbol) {
      if (!assignedValuesBySymbol.has(symbol)) assignedValuesBySymbol.set(symbol, []);
      assignedValuesBySymbol.get(symbol).push({ position, value, properties });
    }
    return;
  }
  if (ts.isObjectLiteralExpression(current)) {
    for (const property of current.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name = propertyNameText(property.name);
        if (name) collectAssignedTargets(property.initializer, value, position, [...properties, name]);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        collectAssignedTargets(property.name, value, position, [...properties, property.name.text]);
      }
    }
    return;
  }
  if (ts.isArrayLiteralExpression(current)) {
    current.elements.forEach((element, index) => {
      if (!ts.isOmittedExpression(element) && !ts.isSpreadElement(element)) {
        collectAssignedTargets(element, value, position, [...properties, String(index)]);
      }
    });
  }
}

for (const sourceFile of sourceFilesByPath.values()) {
  const collectAssignments = (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      collectAssignedTargets(node.left, node.right, node.getStart(sourceFile));
    }
    ts.forEachChild(node, collectAssignments);
  };
  collectAssignments(sourceFile);
}

function declarationsForIdentifier(node) {
  return declarationsForSymbol(symbolFor(node));
}

function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) current = current.expression;
  return current;
}

function propertyNameText(name) {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const values = constantStrings(name.expression);
    return values.size === 1 ? [...values][0] : undefined;
  }
  return undefined;
}

function origins(node, seenSymbols = new Set()) {
  const current = unwrap(node);
  if (ts.isIdentifier(current)) {
    const symbol = symbolFor(current);
    if (["Date", "setTimeout", "setInterval", "globalThis", "window", "require"].includes(current.text)
      && (!symbol || !symbolIsRepositoryLocal(symbol))) {
      return new Set([`global:${current.text}`]);
    }
    if (symbol && seenSymbols.has(symbol)) return new Set();
    const nextSeen = new Set(seenSymbols);
    if (symbol) nextSeen.add(symbol);
    const result = new Set();
    for (const declaration of declarationsForIdentifier(current)) {
      const specifier = moduleSpecifier(declaration);
      const imported = declarationName(declaration);
      if (specifier && imported) {
        result.add(`import:${specifier}:${imported}`);
        if (imported === "Temporal" && (
          specifier === "@eatbid/domain"
          || specifier === "temporal-polyfill"
          || /(?:^|\/)temporal(?:\.js)?$/.test(specifier)
        )) result.add("semantic:Temporal");
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        for (const origin of origins(declaration.initializer, nextSeen)) result.add(origin);
      }
      if (ts.isBindingElement(declaration)) {
        const bindingPattern = declaration.parent;
        const variable = bindingPattern.parent;
        if (ts.isVariableDeclaration(variable) && variable.initializer) {
          const property = propertyNameText(declaration.propertyName ?? declaration.name);
          for (const origin of origins(variable.initializer, nextSeen)) {
            result.add(property ? `${origin}.${property}` : origin);
          }
        }
      }
      if (ts.isExportSpecifier(declaration)) {
        const target = symbolFor(declaration.propertyName ?? declaration.name);
        for (const targetDeclaration of target?.declarations ?? []) {
          if (ts.isVariableDeclaration(targetDeclaration) && targetDeclaration.initializer) {
            for (const origin of origins(targetDeclaration.initializer, nextSeen)) result.add(origin);
          }
        }
      }
    }
    for (const assignment of assignedValuesBySymbol.get(symbol) ?? []) {
      if (assignment.position < current.getStart()) {
        for (const origin of origins(assignment.value, nextSeen)) {
          result.add(assignment.properties.length ? `${origin}.${assignment.properties.join(".")}` : origin);
        }
      }
    }
    return result;
  }
  if (ts.isPropertyAccessExpression(current) || ts.isPropertyAccessChain(current)) {
    return new Set([...origins(current.expression, seenSymbols)].map((origin) => `${origin}.${current.name.text}`));
  }
  if (ts.isQualifiedName(current)) {
    return new Set([...origins(current.left, seenSymbols)].map((origin) => `${origin}.${current.right.text}`));
  }
  if (ts.isElementAccessExpression(current) || ts.isElementAccessChain(current)) {
    const names = current.argumentExpression ? constantStrings(current.argumentExpression) : new Set();
    const result = new Set();
    for (const origin of origins(current.expression, seenSymbols)) {
      for (const name of names) result.add(`${origin}.${name}`);
    }
    return result;
  }
  if (ts.isConditionalExpression(current)) {
    return new Set([...origins(current.whenTrue, seenSymbols), ...origins(current.whenFalse, seenSymbols)]);
  }
  if (ts.isBinaryExpression(current) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(current.operatorToken.kind)) {
    return new Set([...origins(current.left, seenSymbols), ...origins(current.right, seenSymbols)]);
  }
  if (ts.isCallExpression(current) || ts.isNewExpression(current)) return origins(current.expression, seenSymbols);
  return new Set();
}

function constantStrings(node, seenSymbols = new Set()) {
  const current = unwrap(node);
  if (ts.isStringLiteralLike(current)) return new Set([current.text]);
  if (ts.isNoSubstitutionTemplateLiteral(current)) return new Set([current.text]);
  if (ts.isIdentifier(current)) {
    const symbol = symbolFor(current);
    if (symbol && seenSymbols.has(symbol)) return new Set();
    const nextSeen = new Set(seenSymbols);
    if (symbol) nextSeen.add(symbol);
    const result = new Set();
    for (const declaration of declarationsForIdentifier(current)) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        for (const value of constantStrings(declaration.initializer, nextSeen)) result.add(value);
      }
    }
    return result;
  }
  if (ts.isConditionalExpression(current)) {
    return new Set([...constantStrings(current.whenTrue, seenSymbols), ...constantStrings(current.whenFalse, seenSymbols)]);
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantStrings(current.left, seenSymbols);
    const right = constantStrings(current.right, seenSymbols);
    return new Set([...left].flatMap((prefix) => [...right].map((suffix) => `${prefix}${suffix}`)));
  }
  return new Set();
}

function originHas(originsSet, predicate) {
  return [...originsSet].some(predicate);
}

function isGlobalDateOrigin(origin) {
  return origin === "global:Date"
    || origin.startsWith("global:Date.")
    || origin === "global:globalThis.Date"
    || origin.startsWith("global:globalThis.Date.")
    || origin === "global:window.Date"
    || origin.startsWith("global:window.Date.");
}

function isTemporalNowOrigin(origin) {
  return origin.startsWith("semantic:Temporal.Now")
    || (/^import:(?:@eatbid\/domain|temporal-polyfill|.*(?:^|\/)temporal(?:\.js)?):(?:\*\.)?Temporal\.Now(?:\.|$)/.test(origin));
}

function isTimerOrigin(origin) {
  return /global:(?:setTimeout|setInterval)(?:\.|$)/.test(origin)
    || /^global:(?:globalThis|window)\.(?:setTimeout|setInterval)(?:\.|$)/.test(origin);
}

function isDrizzleOrigin(origin, names) {
  return [...names].some((name) => origin === `import:drizzle-orm/pg-core:${name}`
    || origin === `import:drizzle-orm/pg-core:*.${name}`
    || origin.endsWith(`:${name}`) && origin.includes("drizzle-orm/pg-core"));
}

function topLevelAncestorNamed(node, predicate, name) {
  let current = node;
  while (current) {
    if (predicate(current) && current.name && propertyNameText(current.name) === name) {
      if (ts.isVariableDeclaration(current)) {
        const statement = current.parent?.parent;
        return Boolean(statement && ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent));
      }
      return ts.isSourceFile(current.parent);
    }
    current = current.parent;
  }
  return false;
}

function dateException(node, repositoryPath) {
  return repositoryPath === exactAuctionAdapter && (
    topLevelAncestorNamed(node, ts.isTypeAliasDeclaration, "AuctionRow")
    || topLevelAncestorNamed(node, ts.isFunctionDeclaration, "postgresInstant")
  );
}

function temporalException(node, repositoryPath) {
  return repositoryPath === exactClockFacade && topLevelAncestorNamed(node, ts.isVariableDeclaration, "systemClock");
}

function typeContainsElapsedMilliseconds(node) {
  const declaration = ts.isParameter(node) || ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)
    || ts.isVariableDeclaration(node) ? node : undefined;
  if (declaration?.type && /\bElapsedMilliseconds\b/.test(declaration.type.getText())) return true;
  try {
    return /\bElapsedMilliseconds\b/.test(checker.typeToString(checker.getTypeAtLocation(node)));
  } catch {
    return false;
  }
}

function isSemanticDurationExpression(node, seenSymbols = new Set()) {
  const current = unwrap(node);
  if (ts.isCallExpression(current)) {
    const callOrigins = origins(current.expression);
    return originHas(callOrigins, (origin) => ["milliseconds", "seconds", "minutes", "hours", "toMilliseconds"]
      .some((name) => origin === `import:@eatbid/domain:${name}` || origin === `import:@eatbid/domain:*.${name}`));
  }
  if (ts.isIdentifier(current)) {
    const symbol = symbolFor(current);
    if (symbol && seenSymbols.has(symbol)) return false;
    const nextSeen = new Set(seenSymbols);
    if (symbol) nextSeen.add(symbol);
    if (typeContainsElapsedMilliseconds(current)) return true;
    return declarationsForIdentifier(current).some((declaration) =>
      ts.isVariableDeclaration(declaration) && declaration.initializer
        ? isSemanticDurationExpression(declaration.initializer, nextSeen)
        : (ts.isParameter(declaration) || ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration))
          && typeContainsElapsedMilliseconds(declaration));
  }
  return false;
}

function declarationDurationIsUntyped(node) {
  if (typeContainsElapsedMilliseconds(node)) return false;
  if (ts.isVariableDeclaration(node) && node.initializer && isSemanticDurationExpression(node.initializer)) return false;
  if ((ts.isPropertyDeclaration(node) || ts.isParameter(node)) && node.initializer && isSemanticDurationExpression(node.initializer)) return false;
  if (node.type?.kind === ts.SyntaxKind.NumberKeyword) return true;
  if (node.initializer && (
    ts.isNumericLiteral(unwrap(node.initializer))
    || ts.isBinaryExpression(unwrap(node.initializer))
    || ts.isPrefixUnaryExpression(unwrap(node.initializer))
  )) return true;
  try {
    return Boolean(checker.getTypeAtLocation(node).flags & ts.TypeFlags.NumberLike);
  } catch {
    return false;
  }
}

function modeValues(node, seenSymbols = new Set()) {
  const current = unwrap(node);
  if (ts.isObjectLiteralExpression(current)) {
    const values = new Set();
    let known = false;
    let unknown = false;
    for (const property of current.properties) {
      if (ts.isPropertyAssignment(property) && propertyNameText(property.name) === "mode") {
        known = true;
        const strings = constantStrings(property.initializer);
        if (!strings.size) unknown = true;
        for (const value of strings) values.add(value);
      } else if (ts.isShorthandPropertyAssignment(property) && property.name.text === "mode") {
        known = true;
        const strings = constantStrings(property.name);
        if (!strings.size) unknown = true;
        for (const value of strings) values.add(value);
      } else if (ts.isSpreadAssignment(property)) {
        const spread = modeValues(property.expression, seenSymbols);
        known ||= spread.known;
        unknown ||= spread.unknown;
        for (const value of spread.values) values.add(value);
      }
    }
    return { values, known, unknown };
  }
  if (ts.isConditionalExpression(current)) {
    const left = modeValues(current.whenTrue, seenSymbols);
    const right = modeValues(current.whenFalse, seenSymbols);
    return {
      values: new Set([...left.values, ...right.values]),
      known: left.known || right.known,
      unknown: left.unknown || right.unknown || !left.known || !right.known,
    };
  }
  if (ts.isIdentifier(current)) {
    const symbol = symbolFor(current);
    if (symbol && seenSymbols.has(symbol)) return { values: new Set(), known: false, unknown: true };
    const nextSeen = new Set(seenSymbols);
    if (symbol) nextSeen.add(symbol);
    for (const declaration of declarationsForIdentifier(current)) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) return modeValues(declaration.initializer, nextSeen);
    }
  }
  return { values: new Set(), known: false, unknown: true };
}

function isZodInferredType(node, seenSymbols = new Set()) {
  if (ts.isTypeReferenceNode(node)) {
    if (originHas(origins(node.typeName), (origin) => /import:zod:(?:z\.)?(?:infer|input|output)$/.test(origin))) return true;
    if (ts.isIdentifier(node.typeName)) {
      const symbol = symbolFor(node.typeName);
      if (symbol && seenSymbols.has(symbol)) return false;
      const nextSeen = new Set(seenSymbols);
      if (symbol) nextSeen.add(symbol);
      for (const declaration of declarationsForIdentifier(node.typeName)) {
        if (ts.isTypeAliasDeclaration(declaration) && isZodInferredType(declaration.type, nextSeen)) return true;
      }
    }
  }
  return false;
}

function isExportedDeclaration(node) {
  if (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) return true;
  const sourceFile = node.getSourceFile();
  const moduleSymbol = symbolFor(sourceFile);
  if (!moduleSymbol) return false;
  try {
    return checker.getExportsOfModule(moduleSymbol).some((exported) => declarationsForSymbol(exported).includes(node));
  } catch {
    return false;
  }
}

function canonicalColumnName(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function displayNode(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: position.line + 1, column: position.character + 1 };
}

const violations = [];
function report(sourceFile, node, rule, message) {
  const repositoryPath = normalizePath(sourceFile.fileName);
  const normalizedText = node.getText(sourceFile).replace(/\s+/g, " ").trim();
  const fingerprint = `sha256:${createHash("sha256").update(normalizedText).digest("hex")}`;
  const position = displayNode(sourceFile, node);
  violations.push({
    path: repositoryPath,
    rule,
    nodeKind: ts.SyntaxKind[node.kind],
    fingerprint,
    normalizedText,
    line: position.line,
    column: position.column,
    message,
  });
}

function scanSourceFile(sourceFile) {
  const repositoryPath = normalizePath(sourceFile.fileName);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const packageRoot = node.moduleSpecifier.text.split("/", node.moduleSpecifier.text.startsWith("@") ? 2 : 1).join("/");
        if (forbiddenDatePackages.has(packageRoot)) {
          report(sourceFile, node, "forbidden-date-library", `date library ${packageRoot} is forbidden; use the Temporal facade`);
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callOrigins = origins(node.expression);
      if (originHas(callOrigins, isGlobalDateOrigin) && !dateException(node, repositoryPath)) {
        report(sourceFile, node, "ambient-date", "Date must not cross governed production boundaries");
      }
      if (originHas(callOrigins, isTemporalNowOrigin) && !temporalException(node, repositoryPath)) {
        report(sourceFile, node, "ambient-temporal-now", "Temporal.Now is restricted to systemClock");
      }
      if (originHas(callOrigins, isTimerOrigin)) {
        const delay = node.arguments[1];
        if (!delay || !isSemanticDurationExpression(delay)) {
          report(sourceFile, node, "raw-timer-value", "timer delay must originate from ElapsedMilliseconds");
        }
      }
      const isRequire = originHas(callOrigins, (origin) => origin === "global:require");
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynamicImport) && node.arguments[0]) {
        const modules = constantStrings(node.arguments[0]);
        for (const moduleName of modules) {
          const packageRoot = moduleName.split("/", moduleName.startsWith("@") ? 2 : 1).join("/");
          if (forbiddenDatePackages.has(packageRoot)) {
            report(sourceFile, node, "forbidden-date-library", `dynamic date library ${packageRoot} is forbidden`);
            break;
          }
        }
      }
      if (originHas(callOrigins, (origin) => isDrizzleOrigin(origin, new Set(["real", "doublePrecision"])))) {
        const names = node.arguments[0] ? constantStrings(node.arguments[0]) : new Set();
        if (!names.size || [...names].some((name) => canonicalFloatingColumn.test(canonicalColumnName(name)))) {
          report(sourceFile, node, "floating-canonical-ddl", "canonical money and rate columns must use exact numeric DDL");
        }
      }
      if (originHas(callOrigins, (origin) => isDrizzleOrigin(origin, new Set(["bigint"])))) {
        const modeArgument = node.arguments.length === 1 ? node.arguments[0] : node.arguments[1];
        const modes = modeArgument ? modeValues(modeArgument) : { values: new Set(), known: false, unknown: true };
        if (modes.values.has("number") || modes.unknown || !modes.known) {
          report(sourceFile, node, "bigint-number-mode", "Drizzle bigint columns must not use JavaScript number mode");
        }
      }
    }

    if (ts.isNewExpression(node)) {
      const newOrigins = origins(node.expression);
      if (originHas(newOrigins, isGlobalDateOrigin) && !dateException(node, repositoryPath)) {
        report(sourceFile, node, "ambient-date", "Date construction is forbidden outside the named PostgreSQL adapter");
      }
    }

    if (ts.isTypeReferenceNode(node) && originHas(origins(node.typeName), isGlobalDateOrigin)
      && !dateException(node, repositoryPath)) {
      report(sourceFile, node, "ambient-date", "Date types are forbidden outside the named PostgreSQL adapter");
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
      && originHas(origins(node.right), isGlobalDateOrigin) && !dateException(node, repositoryPath)) {
      report(sourceFile, node, "ambient-date", "Date runtime checks are forbidden outside the named PostgreSQL adapter");
    }

    if (ts.isVariableDeclaration(node) && node.initializer) {
      const valueOrigins = origins(node.initializer);
      const unwrappedInitializer = unwrap(node.initializer);
      const aliasesValue = !ts.isCallExpression(unwrappedInitializer) && !ts.isNewExpression(unwrappedInitializer);
      if (aliasesValue && originHas(valueOrigins, isGlobalDateOrigin) && !dateException(node, repositoryPath)) {
        report(sourceFile, node, "ambient-date", "aliases of Date are forbidden outside the named PostgreSQL adapter");
      }
      if (aliasesValue && originHas(valueOrigins, isTemporalNowOrigin) && !temporalException(node, repositoryPath)) {
        report(sourceFile, node, "ambient-temporal-now", "aliases of Temporal.Now are restricted to systemClock");
      }
    }

    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) {
      const name = propertyNameText(node.name);
      if (name && durationName.test(name) && declarationDurationIsUntyped(node)) {
        report(sourceFile, node, "untyped-duration", "timeout, interval, TTL, grace, and delay fields require ElapsedMilliseconds");
      }
    }

    const inPublicContract = repositoryPath.startsWith("packages/contracts/src/api/")
      || repositoryPath.includes("/presentation/http/");
    if (inPublicContract && (
      ts.isInterfaceDeclaration(node) && isExportedDeclaration(node)
      || ts.isTypeAliasDeclaration(node) && isExportedDeclaration(node) && !isZodInferredType(node.type)
    )) {
      report(sourceFile, node, "manual-public-response", "public HTTP response types must be inferred from their Zod wire schema");
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

for (const sourceFile of sourceFilesByPath.values()) scanSourceFile(sourceFile);

function graphDeclarations(identifier) {
  return graphDeclarationsForSymbol(symbolFor(identifier));
}

function graphDeclarationsForSymbol(symbol) {
  return declarationsForSymbol(symbol).filter((declaration) => {
    const source = declaration.getSourceFile();
    return !source.isDeclarationFile && sourceFilesByPath.has(path.resolve(source.fileName));
  });
}

function typeDeclaredByZod(type, seen = new Set()) {
  if (!type || seen.has(type)) return false;
  seen.add(type);
  const symbols = [type.aliasSymbol, type.getSymbol?.()].filter(Boolean);
  if (symbols.some((symbol) => symbol.declarations?.some((declaration) =>
    declaration.getSourceFile().fileName.replaceAll("\\", "/").includes("/node_modules/zod/")))) return true;
  return (type.types ?? []).some((member) => typeDeclaredByZod(member, seen));
}

function expressionHasZodOrigin(node) {
  if (originHas(origins(node), (origin) => origin.startsWith("import:zod:"))) return true;
  if (ts.isIdentifier(node)) {
    for (const declaration of declarationsForIdentifier(node)) {
      if (declaration.type && originHas(origins(declaration.type), (origin) => origin.startsWith("import:zod:"))) {
        return true;
      }
    }
  }
  try {
    return typeDeclaredByZod(checker.getTypeAtLocation(node));
  } catch {
    return false;
  }
}

function nonportableFeature(call) {
  const features = new Set(["codec", "transform", "overwrite", "preprocess", "custom", "refine", "superRefine", "check", "instanceof", "function", "pipe"]);
  for (const origin of origins(call.expression)) {
    const feature = origin.split(".").at(-1)?.split(":").at(-1);
    if (feature && features.has(feature) && origin.startsWith("import:zod:")) return feature;
  }
  if (ts.isPropertyAccessExpression(call.expression) || ts.isElementAccessExpression(call.expression)) {
    const feature = ts.isPropertyAccessExpression(call.expression)
      ? call.expression.name.text
      : call.expression.argumentExpression && [...constantStrings(call.expression.argumentExpression)][0];
    if (feature && features.has(feature)) {
      const receiver = call.expression.expression;
      if (expressionHasZodOrigin(receiver)) return feature;
    }
  }
  return undefined;
}

const configurationFailures = [];
function scanPortableGraph() {
  const registry = [...sourceFilesByPath.values()].find((sourceFile) => normalizePath(sourceFile.fileName) === "packages/contracts/src/portable-registry.ts");
  if (!registry) {
    configurationFailures.push("portable registry packages/contracts/src/portable-registry.ts is required");
    return;
  }
  const roots = [];
  const findRoots = (node) => {
    const statement = ts.isVariableDeclaration(node) ? node.parent?.parent : undefined;
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === "portableContracts"
      && node.initializer
      && statement
      && ts.isVariableStatement(statement)
      && ts.isSourceFile(statement.parent)
      && (node.parent.flags & ts.NodeFlags.Const)
      && isExportedDeclaration(statement)) {
      roots.push(node.initializer);
    }
    ts.forEachChild(node, findRoots);
  };
  findRoots(registry);
  if (roots.length !== 1) {
    configurationFailures.push("exactly one exported const top-level portableContracts root is required");
    return;
  }

  const visitedNodes = new Set();
  const visitedDeclarations = new Set();
  const walk = (node) => {
    if (visitedNodes.has(node)) return;
    visitedNodes.add(node);
    if (ts.isCallExpression(node)) {
      const feature = nonportableFeature(node);
      if (feature) {
        report(node.getSourceFile(), node, "nonportable-schema", `portable registry schema graph uses runtime-only Zod ${feature}`);
      }
    }
    if (ts.isIdentifier(node)) {
      const declarations = graphDeclarations(node);
      if (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node) {
        try {
          declarations.push(...graphDeclarationsForSymbol(checker.getShorthandAssignmentValueSymbol(node.parent)));
        } catch {
          // An unresolved shorthand remains fail-closed through the registry root/configuration checks.
        }
      }
      for (const declaration of new Set(declarations)) {
        if (visitedDeclarations.has(declaration)) continue;
        visitedDeclarations.add(declaration);
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) walk(declaration.initializer);
        else if (ts.isFunctionDeclaration(declaration) && declaration.body) walk(declaration.body);
        else if (ts.isMethodDeclaration(declaration) && declaration.body) walk(declaration.body);
        else if (ts.isPropertyAssignment(declaration)) walk(declaration.initializer);
        else if (ts.isShorthandPropertyAssignment(declaration)) walk(declaration.name);
        else if (ts.isExportSpecifier(declaration)) walk(declaration.propertyName ?? declaration.name);
      }
    }
    ts.forEachChild(node, walk);
  };
  for (const root of roots) walk(root);
}

scanPortableGraph();

const uniqueViolations = [...new Map(violations.map((item) => [
  [item.path, item.rule, item.nodeKind, item.line, item.column, item.fingerprint].join("\0"),
  item,
])).values()].sort((left, right) =>
  left.path.localeCompare(right.path)
  || left.line - right.line
  || left.column - right.column
  || left.rule.localeCompare(right.rule));
const legacyViolations = uniqueViolations.filter((item) => allowedLegacyPrefixes.some((prefix) => item.path.startsWith(prefix)));
const strictViolations = uniqueViolations.filter((item) => !allowedLegacyPrefixes.some((prefix) => item.path.startsWith(prefix)));

function baselineEntry(item) {
  return {
    path: item.path,
    rule: item.rule,
    nodeKind: item.nodeKind,
    fingerprint: item.fingerprint,
    reason: "Pre-existing frontend/shared semantic-value debt frozen on 2026-08-30.",
    removalGate: "Delete or migrate this exact AST node; additions and replacement fingerprints are rejected.",
  };
}

function printViolations(items, heading = "TypeScript semantic-value architecture check failed:") {
  if (!items.length) return;
  console.error(heading);
  for (const item of items) {
    console.error(`- ${item.path}:${item.line}:${item.column} [${item.rule}] ${item.message}`);
  }
}

if (writeBaseline) {
  if (strictViolations.length || configurationFailures.length) {
    printViolations(strictViolations);
    for (const failure of configurationFailures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    const document = { version: 1, entries: legacyViolations.map(baselineEntry) };
    writeFileSync(baselinePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    console.log(`Wrote ${document.entries.length} exact legacy semantic-value fingerprints.`);
  }
} else {
  const baselineFailures = [];
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (error) {
    baselineFailures.push(`cannot read ${normalizePath(baselinePath)}: ${error.message}`);
    baseline = { version: undefined, entries: [] };
  }
  if (baseline.version !== 1 || !Array.isArray(baseline.entries)) {
    baselineFailures.push("legacy baseline must have version 1 and an entries array");
    baseline.entries = [];
  }
  const exactCounts = new Map();
  for (const [index, entry] of baseline.entries.entries()) {
    const expectedKeys = ["path", "rule", "nodeKind", "fingerprint", "reason", "removalGate"];
    if (!entry || typeof entry !== "object" || JSON.stringify(Object.keys(entry)) !== JSON.stringify(expectedKeys)) {
      baselineFailures.push(`legacy baseline entry ${index} must contain the exact ordered fields ${expectedKeys.join(", ")}`);
      continue;
    }
    if (!allowedLegacyPrefixes.some((prefix) => entry.path.startsWith(prefix))) {
      baselineFailures.push(`legacy baseline entry ${index} is outside apps/web or packages/shared: ${entry.path}`);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(entry.fingerprint)) {
      baselineFailures.push(`legacy baseline entry ${index} has an invalid fingerprint`);
    }
    const key = [entry.path, entry.rule, entry.nodeKind, entry.fingerprint].join("\0");
    exactCounts.set(key, (exactCounts.get(key) ?? 0) + 1);
  }
  const baselineByShape = new Map();
  for (const entry of baseline.entries) {
    const shape = [entry.path, entry.rule, entry.nodeKind].join("\0");
    if (!baselineByShape.has(shape)) baselineByShape.set(shape, []);
    baselineByShape.get(shape).push(entry);
  }
  for (const violation of legacyViolations) {
    const exact = [violation.path, violation.rule, violation.nodeKind, violation.fingerprint].join("\0");
    const remaining = exactCounts.get(exact) ?? 0;
    if (remaining > 0) {
      exactCounts.set(exact, remaining - 1);
      continue;
    }
    const shape = [violation.path, violation.rule, violation.nodeKind].join("\0");
    const shapeEntries = baselineByShape.get(shape) ?? [];
    if (shapeEntries.some((entry) => entry.fingerprint === violation.fingerprint)) {
      baselineFailures.push(`new legacy violation: ${violation.path}:${violation.line}:${violation.column} [${violation.rule}]`);
    } else if (shapeEntries.length) {
      baselineFailures.push(`legacy fingerprint drift: ${violation.path} [${violation.rule}] ${violation.nodeKind}`);
    } else {
      baselineFailures.push(`new legacy violation: ${violation.path}:${violation.line}:${violation.column} [${violation.rule}]`);
    }
  }

  if (strictViolations.length) printViolations(strictViolations);
  if (baselineFailures.length) {
    console.error("Semantic-value legacy baseline check failed:");
    for (const failure of baselineFailures) console.error(`- ${failure}`);
  }
  if (configurationFailures.length) {
    console.error("Portable registry configuration check failed:");
    for (const failure of configurationFailures) console.error(`- ${failure}`);
  }
  if (strictViolations.length || baselineFailures.length || configurationFailures.length) process.exitCode = 1;
  else console.log(`TypeScript semantic-value architecture check passed (${legacyViolations.length} frozen legacy fingerprints).`);
}
