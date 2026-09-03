/** @module 책임: curl과 인라인 interpreter(`python -c`, `node -e`)처럼 인자 내용에 따라 읽기와 쓰기가 갈리는 shell 명령을 fail-closed로 판정한다. */

// 파일이나 요청 본문을 쓰는 curl option은 짧은 글자 하나로도 켜지므로 묶인 flag(`-sSo out`)의 글자를
// 모두 검사한다. 값이 붙은 형태(`-HX-Foo:bar`)가 오탐으로 막히는 쪽이 놓치는 쪽보다 안전하다.
const CURL_WRITE_SHORT_FLAGS = new Set(["X", "d", "F", "T", "o", "O", "J", "c", "D", "K"]);
const CURL_WRITE_LONG_OPTION =
  /^--(?:request|data(?:-[a-z]+)?|form(?:-string)?|upload-file|output(?:-dir)?|remote-name(?:-all)?|remote-header-name|cookie-jar|dump-header|config|trace(?:-ascii)?|json|create-dirs|stderr|libcurl|etag-save)$/i;
const CURL_READ_METHODS = new Set(["GET", "HEAD"]);

export function classifyCurl(command) {
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== "curl") return null;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--request" || token === "-X") {
      index += 1;
      if (!CURL_READ_METHODS.has(String(tokens[index] ?? "").toUpperCase())) return false;
      continue;
    }
    if (token.startsWith("--request=")) {
      if (!CURL_READ_METHODS.has(token.slice("--request=".length).toUpperCase())) return false;
      continue;
    }
    if (token.startsWith("-X") && token.length > 2) {
      if (!CURL_READ_METHODS.has(token.slice(2).toUpperCase())) return false;
      continue;
    }
    if (token.startsWith("--")) {
      if (CURL_WRITE_LONG_OPTION.test(token.split("=")[0])) return false;
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      if ([...token.slice(1)].some((letter) => CURL_WRITE_SHORT_FLAGS.has(letter))) return false;
    }
  }
  return true;
}

// 인라인 코드는 따옴표 하나로 감싼 단일 인자만 인정한다. 그래야 코드 안의 `;`를 shell chaining으로
// 오해하지 않으면서 따옴표 밖의 pipe·redirect·치환은 기존 SHELL_COMPOSITION 규칙이 계속 막는다.
const INLINE_INTERPRETER = /^(?:(python3?|py)\s+-c|(node)\s+(?:-e|-p|--eval|--print))\s+(?:"([^"]*)"|'([^']*)')((?:\s+[^\s|;&><$\x60"']+)*)\s*$/;

// 셸이 큰따옴표 안에서도 치환하는 토큰과 파일·프로세스에 닿는 API를 막는다. exec/eval/getattr 계열은
// 문자열 조립으로 같은 API를 숨기는 경로라 함께 막는다.
const SHARED_WRITE_TOKENS = [/>/, /`/, /\$\(/];
const PYTHON_WRITE_TOKENS = [
  /open\s*\([^)]*['"][rbt+]*[wax]/,
  /open\s*\([^)]*\+/,
  /\bmode\s*=/,
  /write_(?:text|bytes)/,
  /(?<!stdout|stderr)\.write(?:lines)?\s*\(/,
  /\bto_(?:csv|json|excel|parquet|pickle|sql|hdf|feather)\s*\(/,
  /\b(?:shutil|subprocess|tempfile|ctypes|importlib|__import__|exec|eval|compile|getattr|setattr|globals|builtins)\b/,
  /\bos\.(?:system|popen|remove|unlink|rename|replace|rmdir|removedirs|mkdir|makedirs|chmod|chown|truncate|symlink|link|utime|exec\w*|spawn\w*|fdopen|open)\b/,
  /\.(?:touch|mkdir|unlink|rmdir|rename|replace|symlink|chmod)\s*\(/,
];
const NODE_WRITE_TOKENS = [
  /\b(?:writeFile|appendFile|createWriteStream|mkdir|mkdtemp|rm|rmdir|unlink|rename|copyFile|cp|truncate|chmod|chown|symlink|link|utimes|writev|open|opendir|ftruncate|fchmod|lchmod|lutimes)(?:Sync)?\s*\(/,
  /(?<!std(?:out|err)\.)\bwrite(?:Sync)?\s*\(/,
  /\b(?:child_process|worker_threads|vm|exec|execFile|spawn|fork|eval|Function|process\.binding|process\.dlopen)\b/,
  /\bimport\s*\(/,
];

export function classifyInlineInterpreter(command) {
  const match = command.trim().match(INLINE_INTERPRETER);
  if (!match) return null;
  const code = match[3] ?? match[4] ?? "";
  const tokens = match[2] ? NODE_WRITE_TOKENS : PYTHON_WRITE_TOKENS;
  return ![...SHARED_WRITE_TOKENS, ...tokens].some((pattern) => pattern.test(code));
}
