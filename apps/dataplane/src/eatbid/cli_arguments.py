"""모듈 책임: CLI subcommand의 인수 계약과 그 값 타입 검사를 소유한다.

dispatch·exit code와 나눈 이유는 함께 바뀌지 않기 때문이다. 새 단계를 더할 때 움직이는 것은 인수
계약이고, 실패 분류와 exit code는 workflow 재시도 정책에 묶여 있어 그대로 있어야 한다.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from uuid import UUID

from eatbid.core.build_identity import validate_build_sha
from eatbid.mart.models import DEFAULT_REGION_SCHEME, MART_NAMES
from eatbid.pipeline.collection_window import COLLECTION_MODES


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


def positive_id(value: str) -> int:
    if not value.isascii() or not value.isdecimal() or value.startswith("0"):
        raise argparse.ArgumentTypeError("must be a positive ASCII decimal")
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


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
    for command in commands.values():
        add_common_arguments(command)

    discover = commands["discover"]
    discover.add_argument("--detail-run-id", required=True, type=UUID)
    # 모드가 창을 정한다. 날짜는 backfill에서만 받고 예약 모드에서는 --as-of의 서울 날짜로 번역한다.
    discover.add_argument("--mode", required=True, choices=COLLECTION_MODES)
    discover.add_argument("--release-name", required=True)
    discover.add_argument("--as-of", required=True, type=aware_datetime)
    discover.add_argument("--started-at", required=True, type=aware_datetime)
    discover.add_argument("--completed-at", required=True, type=aware_datetime)
    discover.add_argument("--start-date", default="")
    discover.add_argument("--end-date", default="")
    discover.add_argument("--progress-status-code", default="")
    discover.add_argument("--region-code", default="")
    discover.add_argument("--page-size", type=int, default=100)

    capture = commands["capture"]
    capture.add_argument("--external-bid-id", required=True)
    capture.add_argument("--started-at", required=True, type=aware_datetime)

    normalize = commands["normalize"]
    normalize.add_argument("--observation-id", required=True, type=positive_id)
    normalize.add_argument("--normalized-at", required=True, type=aware_datetime)

    validate = commands["validate"]
    validate.add_argument("--publication-id", required=True, type=UUID)
    validate.add_argument("--validated-at", required=True, type=aware_datetime)

    project = commands["project"]
    project.add_argument("--publication-id", required=True, type=UUID)
    project.add_argument("--activated-at", required=True, type=aware_datetime)

    replay = commands["replay"]
    replay.add_argument("--publication-id", required=True, type=UUID)
    replay.add_argument("--observation-id", required=True, action="append", type=positive_id)
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

    build_marts = commands["build-marts"]
    # 발행이 없으면 전량 재빌드다. 있으면 그 발행이 실은 record type이 영향 범위를 정한다.
    build_marts.add_argument("--publication-id", type=UUID, default=None)
    build_marts.add_argument("--calc-version", required=True)
    build_marts.add_argument("--built-at", required=True, type=aware_datetime)
    build_marts.add_argument("--as-of", required=True, type=aware_datetime)
    # 반복 가능하며 생략하면 영향 범위가 고른다. 이름을 직접 주는 것이 언제나 이긴다.
    build_marts.add_argument("--mart", action="append", choices=list(MART_NAMES), default=None)
    build_marts.add_argument("--region-scheme", default=DEFAULT_REGION_SCHEME)
    return parser
