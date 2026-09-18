"""모듈 책임: CLI subcommand의 인수 계약과 그 값 타입 검사를 소유한다.

dispatch·exit code와 나눈 이유는 함께 바뀌지 않기 때문이다. 새 단계를 더할 때 움직이는 것은 인수
계약이고, 실패 분류와 exit code는 workflow 재시도 정책에 묶여 있어 그대로 있어야 한다.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Iterable
from datetime import date, datetime
from pathlib import Path
from uuid import UUID

from eatbid.core.build_identity import validate_build_sha
from eatbid.failures.categories import OPERATOR_CLOSE_CATEGORIES
from eatbid.mart.models import DEFAULT_REGION_SCHEME, MART_NAMES
from eatbid.pipeline.collection_window import COLLECTION_MODES

# PostgreSQL bigint 상한이다. observation ID는 bigint 열이므로 그 범위를 넘는 값은 저장소에 닿기
# 전에 인자 단계에서 닫는다.
_MAX_BIGINT = 9_223_372_036_854_775_807


def build_sha(value: str) -> str:
    try:
        return validate_build_sha(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from None


def aware_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("must be an ISO 8601 timestamp") from None
    if parsed.utcoffset() is None:
        raise argparse.ArgumentTypeError("must include a timezone offset")
    return parsed


def collection_date(value: str) -> date:
    """`YYYYMMDD` 여덟 자리만 받는다. 소스 목록 조회가 쓰는 모양 그대로이며, 다른 표기를 받아 주면
    어느 표기가 참인지 두 곳에서 달라진다(AGENTS 15항)."""
    if len(value) != 8 or not value.isdigit():
        raise argparse.ArgumentTypeError("date must be YYYYMMDD")
    try:
        return date(int(value[0:4]), int(value[4:6]), int(value[6:8]))
    except ValueError as error:
        raise argparse.ArgumentTypeError("date must be a real calendar date") from error


def positive_id(value: str) -> int:
    if not value.isascii() or not value.isdecimal() or value.startswith("0"):
        raise argparse.ArgumentTypeError("must be a positive ASCII decimal")
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def _json_array(value: str, *, label: str) -> list[object]:
    """왜: chunk 인자는 workflow가 만든 JSON 배열 하나로 도착한다. shell이 그 문자열을 쪼개거나
    확장하지 못하도록 argv 한 칸으로 받고, 모양 검사는 저장소에 닿기 전 이 자리에서 끝낸다."""
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        raise argparse.ArgumentTypeError(f"{label} must be a JSON array") from None
    if not isinstance(parsed, list) or not parsed:
        raise argparse.ArgumentTypeError(f"{label} must be a non-empty JSON array")
    return parsed


def external_bid_id_chunk(value: str) -> tuple[str, ...]:
    label = "external bid IDs"
    ids = tuple(
        _external_bid_id(item, label=label) for item in _json_array(value, label=label)
    )
    if len(set(ids)) != len(ids):
        raise argparse.ArgumentTypeError(f"{label} must be unique")
    return ids


def _external_bid_id(value: object, *, label: str) -> str:
    if not isinstance(value, str):
        raise argparse.ArgumentTypeError(
            f"every value in {label} must be a JSON string"
        )
    # 발견은 숫자 `ETN_BID_ID`를 int로 정렬해 manifest를 만든다. 같은 모양을 여기서도 요구해야
    # 목록이 만든 ID와 상세가 부르는 ID가 갈라지지 않는다.
    positive_id(value)
    return value


def observation_id_chunk(value: str) -> tuple[int, ...]:
    label = "observation IDs"
    ids = tuple(
        _observation_id(item, label=label) for item in _json_array(value, label=label)
    )
    if len(set(ids)) != len(ids):
        raise argparse.ArgumentTypeError(f"{label} must be unique")
    return ids


def _observation_id(value: object, *, label: str) -> int:
    # `type(...) is not int`인 이유는 bool이 int의 하위 타입이라 isinstance로는 `true`가 통과하기
    # 때문이다. JSON `true`를 observation 1로 읽으면 엉뚱한 관측을 정규화한다.
    if type(value) is not int or not 1 <= value <= _MAX_BIGINT:
        raise argparse.ArgumentTypeError(
            f"every value in {label} must be a positive bigint"
        )
    return value


def add_common_arguments(command: argparse.ArgumentParser) -> None:
    command.add_argument("--run-id", required=True, type=UUID)
    command.add_argument("--source-release-id", required=True, type=UUID)
    command.add_argument("--build-sha", required=True, type=build_sha)
    command.add_argument("--parser-version", required=True)
    command.add_argument("--result-dir", type=Path, default=None)


def build_parser(command_names: Iterable[str]) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="eatbid")
    subcommands = parser.add_subparsers(dest="command", required=True)
    commands = {name: subcommands.add_parser(name) for name in command_names}
    for name, command in commands.items():
        # fail-release와 check-expectations는 특정 run에 매이지 않는 운영 entrypoint라 공통 인수를
        # 받지 않는다. 감시는 어떤 release에도 속하지 않고 지금의 DB 상태만 본다.
        if name not in {
            "fail-release",
            "check-expectations",
            "next-backfill-window",
            "scan-contract",
            "reap-marts",
            "next-replay-target",
        }:
            add_common_arguments(command)

    discover = commands["discover"]
    discover.add_argument("--detail-run-id", required=True, type=UUID)
    # 모드가 창을 정한다. 날짜는 backfill에서만 받고 예약 모드에서는 --as-of의 서울 날짜로 번역한다.
    discover.add_argument("--mode", required=True, choices=COLLECTION_MODES)
    discover.add_argument("--release-name", required=True)
    # 워크플로 안에서만 값이 있다. 없는 것은 "밖에서 돌렸다"는 사실이지 오류가 아니다(EAT-231).
    discover.add_argument("--workflow-name", default=None)
    discover.add_argument("--as-of", required=True, type=aware_datetime)
    discover.add_argument("--started-at", required=True, type=aware_datetime)
    discover.add_argument("--completed-at", required=True, type=aware_datetime)
    discover.add_argument("--start-date", default="")
    discover.add_argument("--end-date", default="")
    discover.add_argument("--progress-status-code", default="")
    discover.add_argument("--region-code", default="")
    discover.add_argument("--page-size", type=int, default=100)

    # capture와 normalize는 pod 하나가 chunk 하나를 순차로 처리한다. 건별 raw 저장·request unit·
    # 관측 grain은 그대로이고 fan-out 폭만 줄어든다(EAT-79).
    capture = commands["capture"]
    capture.add_argument(
        "--external-bid-ids-json",
        dest="external_bid_ids",
        required=True,
        type=external_bid_id_chunk,
    )
    capture.add_argument("--started-at", required=True, type=aware_datetime)

    normalize = commands["normalize"]
    normalize.add_argument(
        "--observation-ids-json",
        dest="observation_ids",
        required=True,
        type=observation_id_chunk,
    )
    normalize.add_argument("--normalized-at", required=True, type=aware_datetime)

    validate = commands["validate"]
    validate.add_argument("--publication-id", required=True, type=UUID)
    validate.add_argument("--validated-at", required=True, type=aware_datetime)

    project = commands["project"]
    project.add_argument("--publication-id", required=True, type=UUID)
    project.add_argument("--activated-at", required=True, type=aware_datetime)

    replay = commands["replay"]
    replay.add_argument("--publication-id", required=True, type=UUID)
    # 비우면 그 release의 상세 관측 전부가 대상이다. 목록을 밖에서 넘기면 1만 6천 건에서 workflow
    # parameter 상한(128KiB)을 넘어 사람이 나눠야 한다(EAT-274). 부분 재처리는 지금처럼 id를 준다.
    replay.add_argument(
        "--observation-id", action="append", type=positive_id, default=None
    )
    for name in ("started-at", "normalized-at", "validated-at", "activated-at"):
        replay.add_argument(f"--{name}", required=True, type=aware_datetime)

    # 정부 코드 파일은 발견도 fan-out도 없다. source·dataset 이름만 받고 요청 모양과 컬럼 계약은
    # 검토된 source 계약이 갖는다(ADR 0035).
    capture_reference = commands["capture-reference"]
    capture_reference.add_argument("--source", required=True)
    capture_reference.add_argument("--dataset", required=True)
    capture_reference.add_argument("--release-name", required=True)
    capture_reference.add_argument("--as-of", required=True, type=aware_datetime)
    capture_reference.add_argument("--started-at", required=True, type=aware_datetime)

    project_reference = commands["project-reference"]
    project_reference.add_argument("--source", required=True)
    project_reference.add_argument("--dataset", required=True)
    project_reference.add_argument("--observation-id", required=True, type=positive_id)
    project_reference.add_argument("--release-name", required=True)
    project_reference.add_argument("--projected-at", required=True, type=aware_datetime)

    # eaT 코드목록도 발견도 fan-out도 없다. 어느 그룹을 묻는지는 인자가 아니라 검토된 코드목록 표가
    # 정하므로(`source/eat/code_schemes.EAT_CODE_LIST_GROUPS`) 여기서는 실행 정체성과 시각만 받는다.
    capture_code_vocabulary = commands["capture-code-vocabulary"]
    capture_code_vocabulary.add_argument("--release-name", required=True)
    capture_code_vocabulary.add_argument("--as-of", required=True, type=aware_datetime)
    capture_code_vocabulary.add_argument(
        "--started-at", required=True, type=aware_datetime
    )

    project_code_vocabulary = commands["project-code-vocabulary"]
    project_code_vocabulary.add_argument(
        "--observation-id", required=True, type=positive_id
    )
    project_code_vocabulary.add_argument(
        "--projected-at", required=True, type=aware_datetime
    )

    # 운영자가 결론 없이 끝난 release를 닫는다. category는 죽은 pod의 exit code 어휘와 INTERRUPTED뿐이고
    # 그 밖의 값은 저장소에 닿기 전에 여기서 닫는다(EAT-122).
    # 선언한 범위의 바닥이다. 이 값을 뒤로 미는 커밋 하나가 그 해의 수집을 시작시키며, 그 커밋이
    # 운영자 승인이다(ADR 0052 결정 5).
    next_window = commands["next-backfill-window"]
    next_window.add_argument("--floor-date", required=True, type=collection_date)
    next_window.add_argument("--as-of", required=True, type=aware_datetime)
    next_window.add_argument("--result-dir", type=Path, default=None)

    # 운영자 조사 entrypoint다(EAT-251). 어떤 run에도 매이지 않고 DB에 쓰지 않는다. 창 범위는 둘 다 주거나 둘 다
    # 비운다 — 한쪽만 있는 범위는 "열린 구간"이 아니라 실수다.
    scan_contract = commands["scan-contract"]
    scan_contract.add_argument("--parser-version", required=True)
    scan_contract.add_argument("--limit", type=int, default=20000)
    scan_contract.add_argument("--window-start", default="")
    scan_contract.add_argument("--window-end", default="")
    scan_contract.add_argument("--result-dir", type=Path, default=None)

    # 예약 entrypoint다(EAT-254). 시한이 지난 superseded build의 행을 회수한다. 어느 build가 지났는지는
    # `--as-of`가 정하므로 같은 시각으로 다시 부르면 같은 판단이다.
    reap_marts = commands["reap-marts"]
    reap_marts.add_argument("--as-of", required=True, type=aware_datetime)
    reap_marts.add_argument("--result-dir", type=Path, default=None)

    # 예약 entrypoint다(EAT-274). 발행이 실패한 창 중 지금 이미지와 다른 이미지가 실패시킨 것 하나를
    # 고른다. 아무것도 바꾸지 않으며 고를 것이 없으면 그것도 정상이다.
    next_replay = commands["next-replay-target"]
    next_replay.add_argument("--run-id", required=True, type=UUID)
    next_replay.add_argument("--build-sha", required=True, type=build_sha)
    next_replay.add_argument("--result-dir", type=Path, default=None)

    fail_release = commands["fail-release"]
    fail_release.add_argument("--source-release-id", required=True, type=UUID)
    fail_release.add_argument("--build-sha", required=True, type=build_sha)
    fail_release.add_argument(
        "--failure-category", required=True, choices=sorted(OPERATOR_CLOSE_CATEGORIES)
    )
    fail_release.add_argument("--failed-at", required=True, type=aware_datetime)
    fail_release.add_argument("--result-dir", type=Path, default=None)

    build_marts = commands["build-marts"]
    # 발행이 없으면 전량 재빌드다. 있으면 그 발행이 실은 record type이 영향 범위를 정한다.
    build_marts.add_argument("--publication-id", type=UUID, default=None)
    build_marts.add_argument("--calc-version", required=True)
    build_marts.add_argument("--built-at", required=True, type=aware_datetime)
    build_marts.add_argument("--as-of", required=True, type=aware_datetime)
    # 반복 가능하며 생략하면 영향 범위가 고른다. 이름을 직접 주는 것이 언제나 이긴다.
    build_marts.add_argument(
        "--mart", action="append", choices=list(MART_NAMES), default=None
    )
    build_marts.add_argument("--region-scheme", default=DEFAULT_REGION_SCHEME)
    return parser
