"""모듈 책임: typed CLI 인수를 실제 application method와 안정된 exit code로 dispatch한다."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from types import TracebackType
from typing import Protocol, Self

from eatbid.cli_arguments import build_parser as build_argument_parser
from eatbid.config import ApplicationSettings
from eatbid.core.code_release_projection import CodeReleaseProjectionResult
from eatbid.failure_categories import (
    CONFIGURATION,
    DATA_QUARANTINED,
    EXIT_CODE_BY_CATEGORY,
    SOURCE_CONTRACT,
    SOURCE_THROTTLED,
    TRANSIENT_NETWORK,
    failure_category_for_error,
)
from eatbid.failure_report import render_failure
from eatbid.ingest.models import CapturedObservation
from eatbid.mart.models import MartBuildResult
from eatbid.pipeline.discover import DiscoveryResult
from eatbid.pipeline.reference import ReferenceCaptureResult

# 왜: exit code와 DB failure_category는 하나의 어휘여야 한다. 숫자를 여기서 다시 적으면 프로세스가
# 끝난 이유와 run 표에 남은 이유가 조용히 갈라진다. 권위는 `eatbid.failure_categories`다.
CONFIGURATION_EXIT_CODE = EXIT_CODE_BY_CATEGORY[CONFIGURATION]
DATA_QUARANTINED_EXIT_CODE = EXIT_CODE_BY_CATEGORY[DATA_QUARANTINED]
TRANSIENT_NETWORK_EXIT_CODE = EXIT_CODE_BY_CATEGORY[TRANSIENT_NETWORK]
SOURCE_THROTTLED_EXIT_CODE = EXIT_CODE_BY_CATEGORY[SOURCE_THROTTLED]
SOURCE_CONTRACT_EXIT_CODE = EXIT_CODE_BY_CATEGORY[SOURCE_CONTRACT]

# workflow 실패 파라미터와 재시도 정책이 이 이름에 묶여 있으므로 exit code와 짝을 바꾸지 않는다.
FAILURE_CATEGORIES: Mapping[int, str] = {
    exit_code: category for category, exit_code in EXIT_CODE_BY_CATEGORY.items()
}


class CliApplication(Protocol):
    def __enter__(self) -> Self: ...
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...
    def discover(self, args: argparse.Namespace) -> object: ...
    def capture(self, args: argparse.Namespace) -> object: ...
    def normalize(self, args: argparse.Namespace) -> None: ...
    def validate(self, args: argparse.Namespace) -> None: ...
    def project(self, args: argparse.Namespace) -> None: ...
    def replay(self, args: argparse.Namespace) -> None: ...
    def build_marts(self, args: argparse.Namespace) -> object: ...
    def capture_reference(self, args: argparse.Namespace) -> object: ...
    def project_reference(self, args: argparse.Namespace) -> object: ...


CommandHandler = Callable[[argparse.Namespace, CliApplication], int]
ApplicationFactory = Callable[[ApplicationSettings], CliApplication]


def _handler(method_name: str) -> CommandHandler:
    def run(args: argparse.Namespace, application: CliApplication) -> int:
        result = getattr(application, method_name)(args)
        payload = _machine_result(method_name, result)
        if payload is not None:
            print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
            result_dir = getattr(args, "result_dir", None)
            if result_dir is not None:
                _write_result_files(result_dir, payload)
        return 0

    return run


def _machine_result(method_name: str, result: object) -> dict[str, object] | None:
    if result is None:
        return None
    if method_name == "discover":
        if not isinstance(result, DiscoveryResult):
            raise TypeError("discover returned an invalid result")
        return {
            "detail_run_id": str(result.detail_run_id),
            "discovered_count": result.expected_count,
            "external_bid_ids": list(result.external_bid_ids),
            "manifest_sha256": result.discovered_manifest_sha256,
            "source_release_id": str(result.source_release_id),
        }
    if method_name == "capture":
        if not isinstance(result, CapturedObservation):
            raise TypeError("capture returned an invalid result")
        return {
            "content_sha256": result.content_sha256,
            "observation_id": result.observation_id,
        }
    if method_name == "capture_reference":
        if not isinstance(result, ReferenceCaptureResult):
            raise TypeError("capture-reference returned an invalid result")
        return {
            "content_sha256": result.content_sha256,
            "observation_id": result.observation_id,
            "source_release_id": str(result.source_release_id),
            "member_count": result.member_count,
            "release_name": result.release_name,
        }
    if method_name == "project_reference":
        if not isinstance(result, CodeReleaseProjectionResult):
            raise TypeError("project-reference returned an invalid result")
        # 상위를 얻지 못한 member 수를 실행 결과로 남긴다. 계층 결측이 조용하면 화면이 코드를
        # 평평하게 보여 주고도 아무도 그것이 결측인지 모른다.
        return {
            "code_release_id": result.code_release_id,
            "member_count": result.member_count,
            "members_without_parent": result.members_without_parent,
        }
    if method_name == "build_marts":
        if not isinstance(result, tuple) or any(
            not isinstance(item, MartBuildResult) for item in result
        ):
            raise TypeError("build-marts returned an invalid result")
        # mart마다 한 줄이라 workflow가 어느 mart의 어느 build를 활성화했는지 파일로 읽는다.
        return {
            "marts": [
                {
                    "mart_name": item.mart_name,
                    "build_id": item.build_id,
                    "row_count": item.row_count,
                    "status": item.status,
                }
                for item in result
            ]
        }
    return None


def _write_result_files(result_dir: Path, payload: Mapping[str, object]) -> None:
    """왜: workflow 실행기는 stdout이 아니라 파일에서 output parameter를 읽으므로 machine result의
    key마다 파일 하나를 둔다. 목록 값은 JSON 배열이라 그대로 fan-out 입력이 된다."""
    result_dir.mkdir(parents=True, exist_ok=True)
    for key, value in payload.items():
        text = (
            json.dumps(value, separators=(",", ":"))
            if isinstance(value, list)
            else str(value)
        )
        (result_dir / key).write_text(text, encoding="utf-8")


# CLI 이름은 kebab-case이고 application method는 snake_case다. 이름 하나를 두 곳에서 짓지 않도록
# 그 대응을 여기 한 표에 둔다.
COMMAND_METHODS: Mapping[str, str] = {
    "discover": "discover",
    "capture": "capture",
    "normalize": "normalize",
    "validate": "validate",
    "project": "project",
    "replay": "replay",
    "build-marts": "build_marts",
    "capture-reference": "capture_reference",
    "project-reference": "project_reference",
}

COMMAND_HANDLERS: Mapping[str, CommandHandler] = {
    name: _handler(method) for name, method in COMMAND_METHODS.items()
}


def build_parser() -> argparse.ArgumentParser:
    return build_argument_parser(COMMAND_HANDLERS)


def main(
    argv: Sequence[str] | None = None,
    *,
    application_factory: ApplicationFactory | None = None,
    settings: ApplicationSettings | None = None,
) -> int:
    args = build_parser().parse_args(argv)
    try:
        settings = (
            settings
            if settings is not None
            else ApplicationSettings.model_validate({})
        )
        factory = application_factory
        if factory is None:
            from eatbid.composition import build_application

            factory = build_application
        with factory(settings) as application:
            return COMMAND_HANDLERS[args.command](args, application)
    except Exception as error:  # noqa: BLE001 - CLI는 모든 provider detail을 닫는 최종 경계다.
        category = failure_category_for_error(error)
        exit_code = EXIT_CODE_BY_CATEGORY[category]
        # 왜: 카테고리 한 단어로는 권한 부재와 연결 시간 초과를 구분할 수 없어 원인을 pod 이벤트로
        # 역추적해야 했다. 예외 클래스와 비밀값을 지운 메시지를 같은 줄에 남긴다.
        print(
            render_failure(error, category=category, args=args, settings=settings),
            file=sys.stderr,
        )
        return exit_code


def exit_code_for_error(error: Exception) -> int:
    return EXIT_CODE_BY_CATEGORY[failure_category_for_error(error)]
