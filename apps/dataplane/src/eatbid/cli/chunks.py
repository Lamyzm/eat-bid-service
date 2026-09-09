"""모듈 책임: chunk 단위 CLI 명령이 건별 application 호출·machine result·fail-closed exit code로 펼쳐지는 방식을 소유한다."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from eatbid.config import ApplicationSettings
from eatbid.failures.report import render_failure
from eatbid.ingest.models import CapturedObservation
from eatbid.pipeline.chunk import ChunkItemOutcome, ChunkOutcome, run_chunk

__all__ = ["CHUNK_COMMANDS", "ChunkCommand", "chunk_payload", "run_chunk_command"]

MachineResult = Mapping[str, object]


@dataclass(frozen=True, slots=True)
class ChunkCommand:
    """chunk 명령 하나의 계약: 무엇을 묶어 받고, 건별로 무엇을 부르고, 다음 단계에 무엇을 남기는가.

    `fan_out`이 있는 명령만 뒤 단계가 fan-out할 목록을 machine result에 남긴다. 왼쪽이 그 목록의
    machine result key이고 오른쪽은 건별 결과에서 뽑을 필드 이름이다.
    """

    list_argument: str
    item_argument: str
    describe: Callable[[object], MachineResult]
    fan_out: tuple[str, str] | None


def _captured_fields(result: object) -> MachineResult:
    if not isinstance(result, CapturedObservation):
        raise TypeError("capture returned an invalid result")
    return {
        "observation_id": result.observation_id,
        "content_sha256": result.content_sha256,
    }


def _normalized_fields(result: object) -> MachineResult:
    # 정규화는 CLI 경계로 값을 돌려주지 않는다. 뒤 단계는 봉인된 발행 corpus를 읽으므로 여기서
    # 무엇이 돌아왔는지가 계약이 되면 두 곳이 같은 사실을 다르게 말하게 된다.
    if result is not None:
        raise TypeError("normalize must not return a result")
    return {}


CHUNK_COMMANDS: Mapping[str, ChunkCommand] = {
    "capture": ChunkCommand(
        list_argument="external_bid_ids",
        item_argument="external_bid_id",
        describe=_captured_fields,
        fan_out=("observation_ids", "observation_id"),
    ),
    "normalize": ChunkCommand(
        list_argument="observation_ids",
        item_argument="observation_id",
        describe=_normalized_fields,
        fan_out=None,
    ),
}


def run_chunk_command(
    command: ChunkCommand,
    method: Callable[[argparse.Namespace], object],
    args: argparse.Namespace,
    settings: ApplicationSettings | None,
) -> ChunkOutcome[object]:
    keys: Sequence[object] = getattr(args, command.list_argument)
    return run_chunk(
        tuple(str(key) for key in keys),
        lambda key: method(_item_arguments(args, command, key)),
        _failure_reporter(args, settings),
    )


def _failure_reporter(
    args: argparse.Namespace, settings: ApplicationSettings | None
) -> Callable[[str, str, Exception], None]:
    """왜: chunk가 실패를 삼키면 pod 로그에 남는 것은 exit code 하나뿐이라 50건 중 어느 건이 왜
    죽었는지 되짚을 수 없다. 최종 실패와 같은 한 줄 JSON 형식·같은 비밀값 제거 규칙으로 건마다
    남긴다."""

    def report(key: str, category: str, error: Exception) -> None:
        rendered = json.loads(
            render_failure(error, category=category, args=args, settings=settings)
        )
        print(
            json.dumps(
                {"chunk_item": key, **rendered},
                sort_keys=True,
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )

    return report


def _item_arguments(
    args: argparse.Namespace, command: ChunkCommand, key: str
) -> argparse.Namespace:
    """왜: application port는 여전히 한 건을 받는다. chunk는 pod 하나가 도는 폭만 바꾸고 건별 요청
    정체성·raw 저장·request unit grain은 그대로 두어야 하므로 건마다 같은 모양의 인수를 만든다."""
    values = dict(vars(args))
    values.pop(command.list_argument, None)
    values[command.item_argument] = _item_key(command, key)
    return argparse.Namespace(**values)


def _item_status(item: ChunkItemOutcome[object]) -> str:
    if item.succeeded:
        return "succeeded"
    return "quarantined" if item.quarantined else "failed"


def _item_key(command: ChunkCommand, key: str) -> object:
    # observation ID는 숫자 정체성이고 external bid ID는 소스가 준 문자열 그대로다. chunk는 순서를
    # 남기려고 둘 다 문자열로 다루므로 application에 넘기기 직전에 원래 타입으로 되돌린다.
    return int(key) if command.item_argument == "observation_id" else key


def chunk_payload(
    command: ChunkCommand, outcome: ChunkOutcome[object]
) -> dict[str, object]:
    """건별 판정과 뒤 단계가 fan-out할 목록을 machine result 하나로 만든다."""
    results = [
        {
            "key": item.key,
            "status": _item_status(item),
            "failure_category": item.failure_category,
            **(command.describe(item.result) if item.succeeded else {}),
        }
        for item in outcome.attempted
    ]
    # 격리는 실패와 따로 센다. 운영이 "소스가 안 왔다"와 "받았지만 우리가 해석하지 못했다"를 한 숫자로
    # 읽으면 재시도할 일과 파서를 고칠 일을 구분하지 못한다.
    payload: dict[str, object] = {
        "results": results,
        "failed_count": len(outcome.failed),
        "quarantined_count": len(outcome.quarantined),
        "skipped": list(outcome.skipped),
    }
    if command.fan_out is not None:
        key, field = command.fan_out
        payload[key] = [
            command.describe(item.result)[field] for item in outcome.succeeded
        ]
    return payload
