"""모듈 책임: typed CLI 인수를 실제 application method와 안정된 exit code로 dispatch한다."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from types import TracebackType
from typing import Protocol, Self

from eatbid.cli.arguments import build_parser as build_argument_parser
from eatbid.cli.chunks import CHUNK_COMMANDS, chunk_payload, run_chunk_command
from eatbid.config import ApplicationSettings
from eatbid.core.code_release_projection import CodeReleaseProjectionResult
from eatbid.core.code_vocabulary_projection import CodeVocabularyProjectionResult
from eatbid.failures.categories import (
    CONFIGURATION,
    DATA_QUARANTINED,
    EXIT_CODE_BY_CATEGORY,
    SOURCE_CONTRACT,
    SOURCE_THROTTLED,
    TRANSIENT_NETWORK,
    failure_category_for_error,
)
from eatbid.failures.report import render_failure
from eatbid.ingest.release_models import FailedSourceRelease
from eatbid.mart.models import MartBuildResult
from eatbid.mart.reaper import ReapReport
from eatbid.monitoring.runner import MonitoringResult
from eatbid.pipeline.advance import BackfillWindow
from eatbid.pipeline.code_vocabulary import CodeVocabularyCaptureResult
from eatbid.pipeline.contract_scan import ScanReport
from eatbid.pipeline.discover import DiscoveryResult
from eatbid.pipeline.reference import ReferenceCaptureResult
from eatbid.pipeline.replay_target import ReplayTarget

# 왜: exit code와 DB failure_category는 하나의 어휘여야 한다. 숫자를 여기서 다시 적으면 프로세스가
# 끝난 이유와 run 표에 남은 이유가 조용히 갈라진다. 권위는 `eatbid.failures.categories`다.
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
    def capture_code_vocabulary(self, args: argparse.Namespace) -> object: ...
    def project_code_vocabulary(self, args: argparse.Namespace) -> object: ...
    def fail_release(self, args: argparse.Namespace) -> object: ...
    def check_expectations(self, args: argparse.Namespace) -> object: ...
    def next_backfill_window(self, args: argparse.Namespace) -> object: ...
    def next_replay_target(self, args: argparse.Namespace) -> object: ...
    def reap_marts(self, args: argparse.Namespace) -> object: ...


CommandHandler = Callable[
    [argparse.Namespace, CliApplication, ApplicationSettings | None], int
]
ApplicationFactory = Callable[[ApplicationSettings], CliApplication]


def _handler(method_name: str) -> CommandHandler:
    def run(
        args: argparse.Namespace,
        application: CliApplication,
        settings: ApplicationSettings | None,
    ) -> int:
        result = getattr(application, method_name)(args)
        payload = _machine_result(method_name, result)
        if payload is not None:
            _emit(payload, args)
        return 0

    return run


def _chunk_handler(command_name: str, method_name: str) -> CommandHandler:
    """chunk 명령은 건별 결과를 모아 machine result로 내고 실패가 있으면 비영 exit로 닫는다."""
    command = CHUNK_COMMANDS[command_name]

    def run(
        args: argparse.Namespace,
        application: CliApplication,
        settings: ApplicationSettings | None,
    ) -> int:
        outcome = run_chunk_command(
            command, getattr(application, method_name), args, settings
        )
        _emit(chunk_payload(command, outcome), args)
        return outcome.exit_code

    return run


def _emit(payload: Mapping[str, object], args: argparse.Namespace) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
    result_dir = getattr(args, "result_dir", None)
    if result_dir is not None:
        _write_result_files(result_dir, payload)


def _machine_result(method_name: str, result: object) -> dict[str, object] | None:
    if result is None:
        return None
    if method_name == "next_backfill_window":
        # 워크플로가 이 셋을 output parameter로 읽어 다음 단계에 넘긴다. 고를 창이 없으면 has_window가
        # 거짓이고 뒤 단계는 실행되지 않는다.
        if result is None:
            return {"has_window": False, "start_date": "", "end_date": ""}
        if not isinstance(result, BackfillWindow):
            raise TypeError("next-backfill-window returned an invalid result")
        return {
            "has_window": True,
            "start_date": result.start_date,
            "end_date": result.end_date,
        }
    if method_name == "discover":
        if not isinstance(result, DiscoveryResult):
            raise TypeError("discover returned an invalid result")
        return {
            "detail_run_id": str(result.detail_run_id),
            "discovered_count": result.expected_count,
            "external_bid_ids": list(result.external_bid_ids),
            # capture fan-out은 이 chunk 목록을 쓴다. 평평한 `external_bid_ids`는 사람이 실행을
            # 되짚을 때 읽는 증거로만 남기고 workflow output parameter로는 내보내지 않는다.
            "external_bid_id_chunks": [
                list(chunk) for chunk in result.external_bid_id_chunks
            ],
            # 상세를 실제로 부르는 수와 그 이유별 집계다. poll-open이 목록 신호로 좁힌 결과를 회차마다
            # 되짚을 수 있어야 "왜 이 공고를 안 불렀나"에 답할 수 있다(ADR 0037).
            "detail_count": len(result.detail_external_bid_ids),
            "refetch_reasons": dict(result.refetch_reason_counts),
            "baseline_source_release_id": (
                str(result.baseline_source_release_id)
                if result.baseline_source_release_id is not None
                else ""
            ),
            "manifest_sha256": result.discovered_manifest_sha256,
            "source_release_id": str(result.source_release_id),
        }
    if method_name == "next_replay_target":
        # 워크플로가 이 셋을 output parameter로 읽는다. 고를 것이 없으면 뒤 단계가 건너뛰어진다.
        if not isinstance(result, ReplayTarget):
            raise TypeError("next-replay-target returned an invalid result")
        return {
            "has_target": True,
            "source_release_id": str(result.source_release_id),
            "window_start": result.window_start,
            "publication_id": str(result.publication_id),
            "started_at": result.started_at.isoformat().replace("+00:00", "Z"),
            "normalized_at": result.normalized_at.isoformat().replace("+00:00", "Z"),
            "validated_at": result.validated_at.isoformat().replace("+00:00", "Z"),
            "activated_at": result.activated_at.isoformat().replace("+00:00", "Z"),
        }
    if method_name == "scan_contract":
        if not isinstance(result, ScanReport):
            raise TypeError("scan-contract returned an invalid result")
        # 보고서 전체를 한 문서로 낸다. 사유 목록은 JSON 배열이라 result-dir의 파일 하나로 그대로 남는다.
        return result.to_document()
    if method_name == "reap_marts":
        if not isinstance(result, ReapReport):
            raise TypeError("reap-marts returned an invalid result")
        return result.to_document()
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
    if method_name == "capture_code_vocabulary":
        if not isinstance(result, CodeVocabularyCaptureResult):
            raise TypeError("capture-code-vocabulary returned an invalid result")
        # 옮기지 못한 행 수를 실행 결과로 남긴다. 어휘가 통째로 활성 이름이 되므로 빠뜨린 행이
        # 조용하면 화면은 이름 없는 코드를 "아직 안 받은 것"으로 오해한다.
        return {
            "content_sha256": result.content_sha256,
            "observation_id": result.observation_id,
            "source_release_id": str(result.source_release_id),
            "entry_count": result.entry_count,
            "excluded_row_count": result.excluded_row_count,
            "release_name": result.release_name,
        }
    if method_name == "project_code_vocabulary":
        if not isinstance(result, CodeVocabularyProjectionResult):
            raise TypeError("project-code-vocabulary returned an invalid result")
        # 소스가 그만 쓴다고 말한 코드 수를 함께 남긴다. 조용히 내려가면 화면에서 사라진 선택지가
        # 왜 사라졌는지 되짚을 자리가 없다.
        return {
            "entry_count": result.entry_count,
            "inserted_code_values": result.inserted_code_values,
            "inserted_labels": result.inserted_labels,
            "deactivated_code_values": result.deactivated_code_values,
            "inserted_mappings": result.inserted_mappings,
        }
    if method_name == "fail_release":
        if not isinstance(result, FailedSourceRelease):
            raise TypeError("fail-release returned an invalid result")
        # 닫힌 run id를 함께 남긴다. 운영자가 어느 run을 끝냈는지 workflow 결과에서 읽어야
        # 뒤에 같은 run을 되살리려는 시도를 막을 수 있다.
        return {
            "source_release_id": str(result.source_release_id),
            "status": "failed",
            "failure_category": result.failure_category,
            "closed_run_ids": [str(run_id) for run_id in result.closed_run_ids],
        }
    if method_name == "check_expectations":
        if not isinstance(result, MonitoringResult):
            raise TypeError("check-expectations returned an invalid result")
        # 무엇이 새로 열렸고 무엇이 해소됐는지 회차마다 남긴다. 이 기록이 쌓여야 한두 주 뒤에 기대의
        # 임계가 맞았는지 다시 판단할 수 있다(ADR 0046 Consequences).
        return {
            "evaluated": result.evaluated,
            "opened": list(result.opened),
            "resolved": list(result.resolved),
            "still_open": list(result.still_open),
            # 밖으로 나간 심장박동. skipped와 sent를 구분해 남겨야 "URL이 없어서 안 나갔다"가 로그에서
            # 보인다 — 그 상태로 운영에 오래 있으면 바깥 감시가 켜져 있다고 믿는 채로 눈이 먼다.
            "heartbeat": result.heartbeat,
            "round_recorded": result.round_recorded,
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
    key마다 파일 하나를 둔다. 목록 값은 JSON 배열이라 그대로 fan-out 입력이 된다.

    불리언도 JSON으로 적는다. `str(True)`는 `True`이고 Argo의 `when`은 `true`와 비교하므로 파이썬
    표기를 그대로 내보내면 조건이 언제나 거짓이 된다. 2026-09-14~15에 전진 cron이 28시간 동안 매시
    `Succeeded`로 끝나면서 `when 'True == true' evaluated false`로 본 단계를 통째로 건너뛰었다.
    실패가 아니라 성공으로 보였기 때문에 어떤 감시도 그것을 잡지 못했다.
    """
    result_dir.mkdir(parents=True, exist_ok=True)
    for key, value in payload.items():
        text = (
            json.dumps(value, separators=(",", ":"), sort_keys=True)
            if isinstance(value, bool | list | dict)
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
    # eaT가 자기 코드에 붙여 부르는 이름을 받아 core 어휘에 앉힌다. 공고 수집 DAG와 같은 이미지·같은
    # run 정체성을 쓰되 발견·발행 corpus가 없어 두 단계로 끝난다(EAT-187).
    "capture-code-vocabulary": "capture_code_vocabulary",
    "project-code-vocabulary": "project_code_vocabulary",
    # 운영자 entrypoint다. DAG 단계가 아니라 사람이 planned release를 닫을 때만 부른다(EAT-122).
    "fail-release": "fail_release",
    # 운영자 entrypoint다. fail-release가 planned release만 닫으므로, capture까지 성공해 release가
    # 봉인된 뒤 프로세스가 사라진 run은 이쪽으로 닫는다(EAT-234).
    "close-stalled-run": "close_stalled_run",
    # 스케줄 entrypoint다. 수집 상태를 바꾸지 않고 기대만 평가해 위반을 알린다(EAT-170, ADR 0046).
    "check-expectations": "check_expectations",
    # 운영자 조사 entrypoint다. 받아 둔 raw에 지금 파서를 돌려 격리 사유를 한 번에 모은다. DB에 쓰지 않는다(EAT-251).
    "scan-contract": "scan_contract",
    # 예약 entrypoint다. `retain_until`이 지난 superseded build의 mart 행을 회수한다(EAT-254, ADR 0034).
    "reap-marts": "reap_marts",
    # 예약 entrypoint다. 커버리지 사실만 읽어 다음에 채울 창 하나를 고르고 아무것도 바꾸지 않는다
    # (EAT-209, ADR 0052 결정 4).
    "next-backfill-window": "next_backfill_window",
    # 예약 entrypoint다. 다시 시도할 가치가 있는 실패 창 하나를 고르고 아무것도 바꾸지 않는다(EAT-274).
    "next-replay-target": "next_replay_target",
}

COMMAND_HANDLERS: Mapping[str, CommandHandler] = {
    name: (_chunk_handler(name, method) if name in CHUNK_COMMANDS else _handler(method))
    for name, method in COMMAND_METHODS.items()
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
            settings if settings is not None else ApplicationSettings.model_validate({})
        )
        factory = application_factory
        if factory is None:
            from eatbid.composition import build_application

            factory = build_application
        with factory(settings) as application:
            return COMMAND_HANDLERS[args.command](args, application, settings)
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
