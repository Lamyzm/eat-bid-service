/**
 * @module 책임: 로컬 개발이 잡을 TCP 포트를 Windows 예약 대역과 실제 점유를 함께 피해 고르고,
 * 사람이 고른 포트가 잡을 수 없는 자리면 그 이유를 이름으로 돌려준다.
 *
 * 포트 선택을 도구마다 따로 적으면 같은 PC에서 한 도구만 예약 대역을 피하게 되고, 그때 나오는 오류는
 * `EADDRINUSE` 한 줄이라 코드 회귀와 구분되지 않는다. 2026-09-17에 4552~4951이 통째로 예약돼 기존
 * 기본 포트가 전부 막힌 일이 이 module이 있는 이유다.
 */
import { execFileSync } from "node:child_process";
import { connect } from "node:net";

/** Windows가 다른 용도로 미리 잡아 둔 대역이다. 비어 있어도 bind가 거부된다. */
export function parseExcludedPortRanges(text) {
  const ranges = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start > end || end > 65_535) continue;
    ranges.push({ start, end });
  }
  return ranges;
}

export function isPortExcluded(port, ranges) {
  return ranges.some((range) => port >= range.start && port <= range.end);
}

/**
 * 예약 대역은 Windows에만 있다. 다른 OS에서는 빈 목록이 정답이며, 조회가 실패해도 빈 목록으로 내려간다 —
 * 예약 여부를 몰라도 실제 bind 시도가 여전히 막아 준다.
 */
export function readExcludedPortRanges(platform = process.platform) {
  if (platform !== "win32") return [];
  try {
    const output = execFileSync(
      "netsh",
      ["interface", "ipv4", "show", "excludedportrange", "protocol=tcp"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return parseExcludedPortRanges(output);
  } catch {
    return [];
  }
}

/**
 * bind가 아니라 connect로 묻는다. Windows에서는 남이 이미 `0.0.0.0:P`를 듣고 있어도 bind가 성공하며,
 * `exclusive`를 켜도 그대로였다(2026-09-18 실측: 다른 worktree의 Next dev가 잡은 3000을 bind 검사가
 * `비었음`이라고 답했다). 연결이 되면 누군가 그 자리에서 이미 응답하고 있다는 뜻이고, 그것이 우리가
 * 피해야 하는 사실의 전부다. 예약만 되고 듣지는 않는 자리는 예약 대역 검사가 따로 잡는다.
 */
export function isPortFree(port, host = "127.0.0.1", timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const settle = (free) => {
      socket.destroy();
      resolve(free);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle(false));
    socket.once("timeout", () => settle(true));
    socket.once("error", () => settle(true));
  });
}

/**
 * 원하는 자리에서 시작해 위로 훑는다. 기본값을 코드에 박지 않는 대신 "여기서부터 찾아라"만 주고,
 * 실제로 고른 값은 호출자가 기기별 환경 파일에 적어 다음 실행이 같은 자리를 다시 쓰게 한다.
 */
export async function choosePort({ from, ranges, span = 200, free = isPortFree }) {
  for (let port = from; port < from + span; port += 1) {
    if (port > 65_535) break;
    if (isPortExcluded(port, ranges)) continue;
    if (await free(port)) return port;
  }
  throw new Error(`${from}부터 ${span}칸 안에 쓸 수 있는 포트가 없습니다`);
}

/** 사람이 env로 못 박은 포트는 옮기지 않는다. 대신 왜 못 쓰는지를 한 줄로 말한다. */
export async function assertPortUsable(port, { ranges, free = isPortFree, label }) {
  if (isPortExcluded(port, ranges)) {
    throw new Error(
      `${label} 포트 ${port}은 Windows 예약 대역에 있습니다.`
        + " netsh interface ipv4 show excludedportrange protocol=tcp 로 확인하고 다른 값을 주세요.",
    );
  }
  if (!(await free(port))) {
    throw new Error(`${label} 포트 ${port}은 이미 다른 프로세스가 쓰고 있습니다.`);
  }
  return port;
}
