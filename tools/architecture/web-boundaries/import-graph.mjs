/**
 * @module 책임: Web production import 그래프에서 다른 화면 사사 파일 import(`route-private`), ADR 0023 층 방향(`layer-direction`),
 * entity 사이 import(`entity-cross-import`), 화면 일 폴더 순환(`feature-cycle`)과 여러 화면이 쓰는 층의 조각 순환(`slice-cycle`)을 찾는다(ADR 0075).
 */
import { LEGACY_PRIVATE } from "./folder-layout.mjs";

const APP = "apps/web/src/app/";
const NEXT_ENTRY = /\/(?:page|layout|loading|error|global-error|not-found|global-not-found|forbidden|unauthorized|template|default|route|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(?:ts|tsx|js|jsx)$/u;
const WORK = /^_[a-z0-9][a-z0-9-]*$/u;
const KIND_FOLDER = /^_?(?:components|hooks|remotes|utils)$/u;

// ADR 0023 "실제 내부 의존 방향"을 층마다 부를 수 있는 층으로 옮긴 표다. app은 모든 층을 부른다.
// 이미 다른 규칙이 잡는 짝(shell→api·capabilities는 `shell-boundary-import`, routing→app은 `legacy-identity-route`)은
// 같은 edge를 두 번 보고하지 않도록 `COVERED_ELSEWHERE`로 뺀다. 같은 층 안의 조각 경계(api resource끼리, capability 내부,
// entity끼리)는 층 방향이 아니라 각 조각 규칙이 본다.
export const LAYER_TARGETS = Object.freeze({
  app: new Set(["app", "shell", "capabilities", "api", "routing", "entities", "shared"]),
  shell: new Set(["shell", "shared", "routing"]),
  capabilities: new Set(["capabilities", "api", "entities", "shared", "routing"]),
  entities: new Set(["entities", "shared"]),
  api: new Set(["api", "shared"]),
  routing: new Set(["routing"]),
  shared: new Set(["shared"]),
});
const COVERED_ELSEWHERE = Object.freeze({ shell: new Set(["api", "capabilities"]), routing: new Set(["app"]) });

/** `apps/web/src/<층>/…`의 층 이름. 일곱 층 밖(styles·types·루트 파일)이면 undefined. */
export function layerOf(displayPath) {
  const match = displayPath.match(/^apps\/web\/src\/([^/]+)\//u);
  return match && Object.hasOwn(LAYER_TARGETS, match[1]) ? match[1] : undefined;
}

const appFolders = (displayPath) => displayPath.slice(APP.length).split("/").slice(0, -1);
const routePath = (folders) => `${APP}${folders.join("/")}`.replace(/\/$/u, "");

/**
 * 화면 사사 파일의 주인 route 폴더. 사사 폴더(`_`로 시작하는 폴더·`__fixtures__`) 안이면 그 폴더의 부모, 주소 폴더 바로 아래의
 * Next 파일이 아닌 파일(로더 등)이면 그 폴더다. Next 파일은 Next가 부르는 입구라 사사 파일이 아니다.
 */
export function privateOwner(displayPath) {
  if (!displayPath.startsWith(APP)) return undefined;
  const folders = appFolders(displayPath);
  const index = folders.findIndex((segment) => segment.startsWith("_"));
  if (index !== -1) return { owner: routePath(folders.slice(0, index)), folder: routePath(folders.slice(0, index + 1)) };
  if (NEXT_ENTRY.test(displayPath)) return undefined;
  return { owner: routePath(folders), folder: undefined };
}

/** 파일이 속한 route 폴더(사사 파일이면 그 주인). */
function routeOf(displayPath) {
  return privateOwner(displayPath)?.owner ?? routePath(appFolders(displayPath));
}

/** 화면의 일 단위: 새 꼴 `_<일>/`, 옛 꼴 `_features/<일>/`. 종류 폴더·옛 화면 공용 폴더는 일이 아니다. */
export function workUnitOf(displayPath) {
  if (!displayPath.startsWith(APP)) return undefined;
  const folders = appFolders(displayPath);
  const index = folders.findIndex((segment) => segment.startsWith("_"));
  if (index === -1) return undefined;
  const head = folders[index];
  if (head === "_features" && folders[index + 1]) return routePath(folders.slice(0, index + 2));
  if (LEGACY_PRIVATE.has(head) || KIND_FOLDER.test(head) || !WORK.test(head)) return undefined;
  return routePath(folders.slice(0, index + 1));
}

/** 여러 화면이 쓰는 층의 조각: `capabilities/<c>`·`entities/<e>`·`shared/<칸>`. 바로 아래 파일은 조각이 아니다. */
export function sliceUnitOf(displayPath) {
  const match = displayPath.match(/^apps\/web\/src\/(capabilities|entities|shared)\/([^/]+)\/[^/]/u);
  return match ? `apps/web/src/${match[1]}/${match[2]}` : undefined;
}

/** 강하게 이어진 덩이(둘 이상)를 찾는다(Tarjan). 결과는 덩이마다 정렬한 구성원이다. */
export function stronglyConnected(edges) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const order = new Map();
  const low = new Map();
  const groups = [];
  const visit = (node) => {
    order.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!order.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (onStack.has(next)) low.set(node, Math.min(low.get(node), order.get(next)));
    }
    if (low.get(node) !== order.get(node)) return;
    const group = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      group.push(member);
    } while (member !== node);
    if (group.length > 1) groups.push(group.sort());
  };
  for (const node of [...edges.keys()].sort()) if (!order.has(node)) visit(node);
  return groups.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
}

const short = (displayPath) => displayPath.replace(/^apps\/web\/src\//u, "");

function addEdge(map, from, to) {
  const set = map.get(from) ?? new Set();
  set.add(to);
  map.set(from, set);
}

/**
 * @param {{ from: string, to: string }[]} edges production source 사이 import(type import와 다시 내보내기 포함)
 * @param {Iterable<string>} files Web source 전체(시험 포함) — 화면(`page.*`가 있는 폴더)을 가르는 데만 쓴다
 * @returns {{ rule: string, path: string, key: string, reason: string }[]}
 */
export function importGraphFindings(edges, files) {
  const screens = new Set([...files].filter((file) => file.startsWith(APP) && /\/page\.(?:tsx|ts|jsx|js)$/u.test(file)).map((file) => file.slice(0, file.lastIndexOf("/"))));
  const findings = [];
  const workEdges = new Map();
  const sliceEdges = new Map();
  const seen = new Set();
  for (const { from, to } of edges) {
    const key = `${from} -> ${to}`;
    if (from === to || seen.has(key)) continue;
    seen.add(key);
    const target = privateOwner(to);
    if (target && from.startsWith(APP)) {
      if (!from.startsWith(`${target.owner}/`) && target.owner !== routeOf(from)) {
        findings.push({ rule: "route-private", path: from, key, reason: `다른 화면의 사사 파일(${short(to)})을 부릅니다. 두 화면 이상이 쓰면 도메인을 아는 표시 조각은 entities/<e>/, 독립 사용자 흐름은 capabilities/<c>/, 도메인을 모르면 shared/로 올립니다(ADR 0075).` });
      } else if (routeOf(from) !== target.owner && !screens.has(target.owner) && !(target.folder && from.startsWith(`${target.folder}/`))) {
        findings.push({ rule: "route-private", path: from, key, reason: `윗 route(${short(target.owner)})의 사사 파일(${short(to)})을 부릅니다. 그 route는 화면이 아니라 layout 자리라 사사 파일은 그 layout만 씁니다. 모든 화면의 머리·틀이면 shell/, 여러 화면이 쓰는 도메인 표시면 entities/<e>/로 옮깁니다(ADR 0075).` });
      }
    }
    const fromLayer = layerOf(from);
    const toLayer = layerOf(to);
    if (fromLayer && toLayer && !LAYER_TARGETS[fromLayer].has(toLayer) && !COVERED_ELSEWHERE[fromLayer]?.has(toLayer)) {
      findings.push({ rule: "layer-direction", path: from, key, reason: `${fromLayer} 층은 ${toLayer} 층(${short(to)})을 부를 수 없습니다. 부를 수 있는 다른 층: ${[...LAYER_TARGETS[fromLayer]].filter((layer) => layer !== fromLayer).join("·") || "없음"}(ADR 0023 의존 방향, ADR 0075).` });
    }
    const fromSlice = sliceUnitOf(from);
    const toSlice = sliceUnitOf(to);
    if (fromLayer === "entities" && toLayer === "entities" && fromSlice !== toSlice) {
      findings.push({ rule: "entity-cross-import", path: from, key, reason: `entity끼리는 서로 부르지 않습니다(${short(to)}). 같이 쓰는 값은 shared/나 packages/domain으로 내리거나 두 entity를 하나로 합칩니다(ADR 0023, ADR 0075).` });
    }
    if (fromSlice && toSlice && fromSlice !== toSlice) addEdge(sliceEdges, fromSlice, toSlice);
    const fromWork = workUnitOf(from);
    const toWork = workUnitOf(to);
    if (fromWork && toWork && fromWork !== toWork) addEdge(workEdges, fromWork, toWork);
  }
  for (const group of stronglyConnected(workEdges)) {
    findings.push({ rule: "feature-cycle", path: group[0], key: group.join(" <-> "), reason: `화면의 일 폴더가 서로 부릅니다: ${group.map(short).join(" ↔ ")}. 같이 쓰는 부분을 화면 바로 아래 _utils/·_components/로 빼거나 일을 합칩니다(ADR 0075).` });
  }
  for (const group of stronglyConnected(sliceEdges)) {
    findings.push({ rule: "slice-cycle", path: group[0], key: group.join(" <-> "), reason: `여러 화면이 쓰는 조각이 서로 부릅니다: ${group.map(short).join(" ↔ ")}. 한 방향만 남기고 같이 쓰는 몫은 아래 조각(shared 등)으로 내립니다(ADR 0075).` });
  }
  return findings;
}
