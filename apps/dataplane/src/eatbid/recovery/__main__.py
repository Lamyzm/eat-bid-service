"""모듈 책임: 자물쇠 풀기 예약(`python -m eatbid.recovery`)의 프로세스 입구로, 결과를 한 줄 JSON으로 남기고 실패를 exit code로 드러낸다.

왜 `eatbid` CLI를 거치지 않는가: CLI는 DB·R2·eaT adapter를 먼저 조립한다. 자물쇠 풀기는 Kubernetes API만 쓰고,
DB가 막혀 있을 때도 돌아야 한다 — 회복 도구가 회복 대상에 매이면 안 된다.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from eatbid.kubernetes_api import InClusterApi
from eatbid.recovery.release_locks import release_stuck_locks


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m eatbid.recovery")
    # 성공한 파드는 곧바로 지워져 로그가 남지 않는다. 결과를 회차 출력값으로도 남겨 무엇을 풀었는지 회차에서 읽게 한다.
    parser.add_argument("--result-file", type=Path)
    args = parser.parse_args(argv)
    report = release_stuck_locks(InClusterApi(), now=datetime.now(UTC))
    rendered = json.dumps(report.as_json(), ensure_ascii=False)
    print(rendered)
    if args.result_file is not None:
        args.result_file.parent.mkdir(parents=True, exist_ok=True)
        args.result_file.write_text(rendered, encoding="utf-8")
    return 1 if report.failures else 0


if __name__ == "__main__":
    sys.exit(main())
