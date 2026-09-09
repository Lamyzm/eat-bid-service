/** @module 책임: 저장소 컴포넌트를 독립 시안으로 빌드하여 루프백 주소에서만 제공하며 생성물은 저장소 밖에 둔다. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative, isAbsolute, sep } from "node:path";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";

const source = dirname(fileURLToPath(import.meta.url));
const root = resolve(source, "../../../..");
const web = join(root, "apps/web");
const require = createRequire(join(web, "package.json"));
const output = resolve(process.argv[2] || join(tmpdir(), "eatbid-shell-comparison"));
const outputRelative = relative(root, output);
if (!isAbsolute(outputRelative) && outputRelative !== ".." && !outputRelative.startsWith(`..${sep}`)) {
  throw new Error("생성물 경로는 저장소 밖으로 지정하세요.");
}
await mkdir(output, { recursive: true });
// 시안용 추가 의존성을 제품에 넣지 않고 frozen install에 이미 있는 빌드 도구를 사용한다.
const packages = await readdir(join(root, "node_modules/.pnpm"));
const esbuildPackage = packages.find((name) => name.startsWith("esbuild@"));
if (!esbuildPackage) throw new Error("먼저 저장소의 frozen install을 완료하세요.");
const { build } = require(join(root, "node_modules/.pnpm", esbuildPackage, "node_modules/esbuild"));
await build({
  entryPoints: [join(source, "main.tsx")],
  outfile: join(output, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  minify: true,
  nodePaths: [join(web, "node_modules")],
  alias: { "@": join(web, "src") },
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "error",
});
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const globals = join(web, "src/styles/globals.css");
const forwardPath = (path) => path.replaceAll("\\", "/");
const css = `${await readFile(globals, "utf8")}\n@source "${forwardPath(source)}";\n@source "${forwardPath(join(web, "src"))}";\n${await readFile(join(source, "prototype.css"), "utf8")}`;
const result = await postcss([tailwind({ base: web })]).process(css, {
  from: globals,
  to: join(output, "app.css"),
});
await writeFile(join(output, "app.css"), result.css);
await writeFile(
  join(output, "index.html"),
  '<!doctype html><html lang="ko" data-theme="toss"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>eatbid 레이아웃 비교</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);
if (process.argv.includes("--build-only")) process.exit(0);
const files = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/app.css": ["app.css", "text/css"],
};
createServer(async (request, response) => {
  const entry = files[new URL(request.url, "http://127.0.0.1").pathname];
  if (!entry) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    response.writeHead(200, {
      "Content-Type": `${entry[1]}; charset=utf-8`,
      "Cache-Control": "no-store",
    });
    response.end(await readFile(join(output, entry[0])));
  } catch {
    response.writeHead(500);
    response.end("시안을 불러오지 못했습니다.");
  }
}).listen(8770, "127.0.0.1", () =>
  process.stdout.write("레이아웃 비교 시안: http://127.0.0.1:8770\n"),
);
