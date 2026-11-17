/**
 * @module 책임: Web 화면·entity·capability 단위 안의 종류 폴더(`components`·`hooks`·`remotes`·`utils`) 자리를 파일 이름으로 판정해,
 * 평평하게 둔 옛 꼴(`kind-folder`, 기준 목록)과 종류 폴더의 자리·이름 어긋남(`kind-folder-mismatch`, 기준 목록 없음)을 낸다(ADR 0075).
 */
import path from "node:path";

// 꼴(ADR 0075 결정 2·3 — 온누리 ADR 0016 2026-11-15 개정을 eatbid 층에 맞춤): 밖은 일, 안은 종류.
// - 화면 폴더 바로 아래에는 Next 파일과 로더 `load-*.ts`(와 그 시험)·`__fixtures__/`만 둔다. 조립·틀·뼈대·여러 일 공용은
//   밑줄 붙은 `_components/`·`_hooks/`·`_remotes/`·`_utils/`다. 밑줄 없는 폴더는 Next가 주소 조각으로 읽는다.
// - 일 폴더 `_<일>/`, `entities/<e>/`, `capabilities/<c>/` 안의 파일은 종류 폴더 한 겹에 둔다. capability 바로 아래에는
//   공개 입구 `index.ts`·`server.ts`만 남는다(ADR 0023의 cross-slice 입구).
// - 이름이 종류를 고른다. 폴더는 묶기만 하고 이름이 그것을 확인한다.
export const KIND_DIRS = Object.freeze(new Set(["components", "hooks", "remotes", "utils"]));
export const SCREEN_KIND_DIRS = Object.freeze(new Set([...KIND_DIRS].map((kind) => `_${kind}`)));
export const FIXTURE_DIRS = Object.freeze(new Set(["__fixtures__"]));
// ADR 0044의 옛 꼴 폴더. 파일마다 갈 자리를 계산해 알려 준다(기준 목록에 싣고 줄어들기만 한다).
export const LEGACY_PRIVATE = Object.freeze(new Set(["_features", "_widgets", "_lib", "_ui", "_model"]));
const WORK = /^_[a-z0-9][a-z0-9-]*$/u;
const TEST = /\.(?:test|spec)\.[cm]?tsx?$/u;
const LOADER = /^load-[^/]+\.ts$/u;
const SLICE_ENTRIES = Object.freeze(new Set(["index.ts", "server.ts"]));
// Next가 직접 부르는 파일. 아무도 import하지 않아도 쓰이며 주소 폴더 바로 아래에 있어야 한다.
const NEXT_ENTRY = /^(?:page|layout|loading|error|global-error|not-found|global-not-found|forbidden|unauthorized|template|default|route|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(?:ts|tsx|js|jsx)$|^(?:favicon|icon|apple-icon|opengraph-image|twitter-image)\.[a-z0-9]+$/u;
const WEB_SOURCE = /^apps\/web\/src\//u;

const isPlacedFile = (name) => /\.(?:[cm]?tsx?|css)$/u.test(name) && !name.endsWith(".d.ts");

/**
 * 이름이 고르는 종류(밑줄 없는 이름). 그리기 `.tsx`·css·높이 상수 `*.frame.ts`는 components, 훅 `use-*.ts`는 hooks,
 * 쿼리 옵션 `*-queries.ts`는 remotes, 훅이 아닌 흐름 `*.model.ts`는 API resource를 값으로 부르면 remotes·아니면 hooks,
 * 나머지 `.ts`(셈)는 utils다. 시험은 원본을 따라가므로 여기서 고르지 않는다.
 */
export function kindOfName(name, text) {
  if (/\.(?:tsx|css)$/u.test(name) || name.endsWith(".frame.ts")) return "components";
  if (/^use-[^/]+\.ts$/u.test(name)) return "hooks";
  if (/-queries\.ts$/u.test(name)) return "remotes";
  if (/\.model\.ts$/u.test(name)) return text !== undefined && callsApiByValue(text) ? "remotes" : "hooks";
  return "utils";
}

// 타입만 부르는 import(`import type`)는 서버와 오가지 않으므로 세지 않는다.
function callsApiByValue(text) {
  return /^\s*import\s+(?!type\b)[^;]*?from\s+['"]@\/api\//mu.test(text);
}

function relativeToApp(displayPath) {
  return displayPath.startsWith("apps/web/src/app/") ? displayPath.slice("apps/web/src/app/".length) : undefined;
}

/**
 * 파일이 선 단위와 그 안의 자리. 단위 밖(shared·shell·api·routing)이면 undefined.
 * - `screen`: 화면 폴더 바로 아래(종류 폴더에 밑줄).
 * - `at`: `flat`(단위 바로 아래)·`kind`(종류 폴더 한 겹)·`fixture`·`legacy`(ADR 0044 옛 꼴)·`nested`(그 밖의 폴더).
 */
export function placeOf(displayPath) {
  const parts = displayPath.split("/");
  const name = parts.at(-1);
  const app = relativeToApp(displayPath);
  if (app !== undefined) {
    const segments = app.split("/");
    const folders = segments.slice(0, -1);
    const privateIndex = folders.findIndex((segment) => segment.startsWith("_"));
    if (privateIndex === -1) return { unit: `apps/web/src/app/${folders.join("/")}`.replace(/\/$/u, ""), screen: true, at: "flat", folders: [], name };
    const route = `apps/web/src/app/${folders.slice(0, privateIndex).join("/")}`.replace(/\/$/u, "");
    const head = folders[privateIndex];
    const rest = folders.slice(privateIndex + 1);
    if (FIXTURE_DIRS.has(head)) return { unit: route, screen: true, at: "fixture", folders: rest, name };
    if (LEGACY_PRIVATE.has(head)) return { unit: route, screen: true, at: "legacy", legacy: head, folders: rest, name };
    if (SCREEN_KIND_DIRS.has(head)) return { unit: route, screen: true, at: rest.length ? "nested" : "kind", kind: head.slice(1), folders: rest, name };
    if (!WORK.test(head)) return { unit: route, screen: true, at: "nested", folders: [head, ...rest], name };
    const unit = `${route}/${head}`;
    if (rest.length === 0) return { unit, screen: false, at: "flat", folders: [], name };
    if (FIXTURE_DIRS.has(rest[0])) return { unit, screen: false, at: "fixture", folders: rest.slice(1), name };
    if (rest.length === 1 && KIND_DIRS.has(rest[0])) return { unit, screen: false, at: "kind", kind: rest[0], folders: [], name };
    return { unit, screen: false, at: "nested", folders: rest, name };
  }
  const slice = displayPath.match(/^apps\/web\/src\/(entities|capabilities)\/([^/]+)\/(.+)$/u);
  if (!slice) return undefined;
  const unit = `apps/web/src/${slice[1]}/${slice[2]}`;
  const rest = slice[3].split("/").slice(0, -1);
  if (rest.length === 0) return { unit, screen: false, slice: slice[1], at: "flat", folders: [], name };
  if (FIXTURE_DIRS.has(rest[0])) return { unit, screen: false, slice: slice[1], at: "fixture", folders: rest.slice(1), name };
  if (rest.length === 1 && KIND_DIRS.has(rest[0])) return { unit, screen: false, slice: slice[1], at: "kind", kind: rest[0], folders: [], name };
  return { unit, screen: false, slice: slice[1], at: "nested", folders: rest, name };
}

const kindDir = (unit, screen, kind) => `${unit}/${screen ? "_" : ""}${kind}`;

/** 시험 이름에서 `.test.*`와 꼬리 조각(`.dom` 등)을 떼며 같은 폴더의 원본을 찾는다. */
function testOrigin(displayPath, all) {
  const dir = path.posix.dirname(displayPath);
  let stem = path.posix.basename(displayPath).replace(TEST, "");
  while (stem) {
    for (const extension of [".ts", ".tsx"]) if (all.has(`${dir}/${stem}${extension}`)) return `${dir}/${stem}${extension}`;
    const dot = stem.lastIndexOf(".");
    if (dot <= 0) break;
    stem = stem.slice(0, dot);
  }
  return undefined;
}

/**
 * 옛 꼴(ADR 0044) 파일이 새 꼴에서 설 자리. `_features/<f>/{ui,model,lib}/x`는 `_<f>/<종류>/x`, 화면의 `_widgets`·`_lib`·`_ui`·`_model`은
 * 화면 바로 아래 `_<종류>/x`, 로더 `load-*.ts`는 화면 바로 아래다.
 */
function legacyTarget(place, textOf, file) {
  const kind = kindOfName(place.name, textOf(file));
  if (place.legacy === "_features" && place.folders.length >= 1) return `${place.unit}/_${place.folders[0]}/${kind}/${place.name}`;
  if (LOADER.test(place.name)) return `${place.unit}/${place.name}`;
  return `${kindDir(place.unit, true, kind)}/${place.name}`;
}

/** 새 꼴에서 이 파일이 설 자리. 지금 자리가 맞으면 undefined. */
export function kindTarget(file, all, textOf = () => undefined) {
  const place = placeOf(file);
  if (!place || !isPlacedFile(place.name)) return undefined;
  if (place.at === "fixture") return undefined;
  if (TEST.test(place.name)) {
    const origin = testOrigin(file, all);
    if (!origin) return place.at === "legacy" ? `${place.unit}/${place.name}` : undefined;
    const home = path.posix.dirname(kindTarget(origin, all, textOf) ?? origin);
    return home === path.posix.dirname(file) ? undefined : `${home}/${place.name}`;
  }
  if (place.at === "legacy") return legacyTarget(place, textOf, file);
  if (place.at !== "flat") return undefined;
  if (place.screen && (NEXT_ENTRY.test(place.name) || LOADER.test(place.name))) return undefined;
  if (place.slice === "capabilities" && SLICE_ENTRIES.has(place.name)) return undefined;
  return `${kindDir(place.unit, place.screen, kindOfName(place.name, textOf(file)))}/${place.name}`;
}

/**
 * 평평하게 둔 옛 꼴(`kind-folder`). 파일마다 갈 자리를 말하고 기준 목록 열쇠는 파일 경로다(옮기면 사라진다).
 * @param {string[]} files 저장소 기준 Web source 경로(시험·css 포함)
 */
export function kindFolderFindings(files, textOf = () => undefined) {
  const all = new Set(files);
  const findings = [];
  for (const file of files) {
    if (!WEB_SOURCE.test(file) || !isPlacedFile(path.posix.basename(file))) continue;
    const target = kindTarget(file, all, textOf);
    if (!target) continue;
    const why = TEST.test(file)
      ? "시험은 원본 곁(같은 종류 폴더)에 둡니다"
      : "단위(화면의 _<일>/·entities/<e>/·capabilities/<c>/) 안은 종류 폴더 한 겹입니다. 그리기 .tsx·css·*.frame.ts는 components/, 훅 use-*.ts는 hooks/, 쿼리 *-queries.ts와 API를 부르는 *.model.ts는 remotes/, 셈 .ts는 utils/. 화면 폴더 바로 아래에는 Next 파일과 로더 load-*.ts만 남고 나머지는 _components/·_hooks/·_remotes/·_utils/";
    findings.push({ path: file, key: file, reason: `옛 꼴입니다. 이 파일의 자리는 ${target.replace(WEB_SOURCE, "")} 입니다. ${why}(ADR 0075).` });
  }
  return findings;
}

/**
 * 종류 폴더의 자리·이름 어긋남(`kind-folder-mismatch`). 새 꼴을 쓰기 시작한 자리에서 꼴을 흐리게 하는 것이라 기준 목록에 올리지 않는다.
 * 1. 화면 폴더 바로 아래 종류 폴더는 밑줄을 붙이고, 일·entity·capability 안에서는 밑줄 없이 둔다.
 * 2. 종류 폴더 안은 평평하다(한 겹).
 * 3. 종류 폴더 안의 파일 이름은 그 종류를 말한다(시험은 곁에 둘 수 있다).
 */
export function kindFolderMismatches(files, textOf = () => undefined) {
  const findings = [];
  for (const file of files) {
    if (!WEB_SOURCE.test(file) || !isPlacedFile(path.posix.basename(file))) continue;
    const place = placeOf(file);
    if (!place) continue;
    const reason = mismatchReason(file, place, textOf);
    if (reason) findings.push({ path: file, reason: `${reason}(ADR 0075).` });
  }
  return findings;
}

function mismatchReason(file, place, textOf) {
  const app = relativeToApp(file);
  if (app !== undefined) {
    const folders = app.split("/").slice(0, -1);
    const bare = folders.find((segment) => KIND_DIRS.has(segment));
    if (bare && place.at !== "kind" && !(place.at === "nested" && !place.screen)) return `화면 폴더 바로 아래 종류 폴더는 밑줄을 붙입니다(_${bare}/). 밑줄 없는 ${bare}/는 Next가 주소 조각으로 읽습니다`;
  }
  if (place.at === "nested") {
    const underscored = place.folders.find((segment) => SCREEN_KIND_DIRS.has(segment));
    if (underscored && !place.screen) return `일·entity·capability 안의 종류 폴더는 밑줄 없이 둡니다(${underscored.slice(1)}/). 밑줄은 화면 폴더 바로 아래에서만 씁니다`;
    if (place.kind) return `종류 폴더 _${place.kind}/ 안은 평평합니다. 한 겹만 둡니다`;
    if (place.folders.some((segment) => KIND_DIRS.has(segment))) return `종류 폴더 안은 평평합니다. 한 겹만 둡니다`;
    if (!place.screen) return `단위 안에는 종류 폴더 한 겹(components/·hooks/·remotes/·utils/)과 __fixtures__/만 둡니다. 일을 더 나누려면 화면 바로 아래 새 일 폴더 _<일>/로 둡니다`;
    return `화면 폴더 바로 아래 사사 폴더는 _components/·_hooks/·_remotes/·_utils/·_<일>/·__fixtures__/뿐입니다`;
  }
  if (place.at !== "kind" || TEST.test(place.name)) return undefined;
  const right = kindOfName(place.name, textOf(file));
  if (right === place.kind) return undefined;
  return `${place.screen ? "_" : ""}${place.kind}/에 이름이 다른 종류인 파일을 두지 않습니다. 이 파일의 자리는 ${kindDir(place.unit, place.screen, right).replace(WEB_SOURCE, "")}/ 입니다(이름이 종류를 말합니다)`;
}
