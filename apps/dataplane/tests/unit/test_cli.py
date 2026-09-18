from __future__ import annotations

import json
from argparse import Namespace
from datetime import UTC, datetime
from pathlib import Path
from typing import Self
from uuid import UUID

import pytest
from pydantic import ValidationError

from eatbid.cli import COMMAND_HANDLERS, build_parser, main
from eatbid.composition import Application, build_application
from eatbid.config import ApplicationSettings
from eatbid.failures.errors import SourceContractError, SourceUnavailableError
from eatbid.ingest.models import CapturedObservation
from eatbid.ingest.release_models import FailedSourceRelease
from eatbid.mart.models import MartBuildResult
from eatbid.mart.reaper import ReapReport
from eatbid.monitoring.runner import MonitoringResult
from eatbid.pipeline.advance import BackfillWindow
from eatbid.pipeline.capture import SourceThrottledError
from eatbid.pipeline.contract_scan import ScanReport
from eatbid.pipeline.discover import DiscoveryResult
from eatbid.pipeline.normalize import DataQuarantinedError

RUN_ID = "43000000-0000-0000-0000-000000000001"
RELEASE_ID = "43000000-0000-0000-0000-000000000002"
PUBLICATION_ID = "43000000-0000-0000-0000-000000000003"
SHA = "a" * 64
FETCHED_AT = datetime(2026, 9, 1, 0, 0, tzinfo=UTC)


class _기록애플리케이션:
    def __init__(self, *, error: Exception | None = None) -> None:
        self.calls: list[tuple[str, UUID | None]] = []
        self.captured: list[str] = []
        self.normalized: list[int] = []
        self.error = error
        self.close_count = 0

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *args: object) -> None:
        self.close_count += 1

    def _record(self, command: str, args: Namespace) -> None:
        if self.error is not None:
            raise self.error
        self.calls.append((command, args.source_release_id))

    def next_backfill_window(self, args: Namespace) -> None:
        # 전진 판단도 release에 매이지 않는다.
        self.calls.append(("next-backfill-window", None))

    def check_expectations(self, args: Namespace) -> MonitoringResult:
        # release에 매이지 않으므로 _record의 source_release_id 경로를 타지 않는다.
        if self.error is not None:
            raise self.error
        self.calls.append(("check-expectations", None))
        return MonitoringResult(
            evaluated=3,
            opened=("backfill-progress",),
            resolved=(),
            still_open=("backfill-progress",),
        )

    def discover(self, args: Namespace) -> None:
        self._record("discover", args)

    def capture(self, args: Namespace) -> CapturedObservation:
        self._record("capture", args)
        self.captured.append(args.external_bid_id)
        return CapturedObservation(
            observation_id=len(self.captured),
            content_sha256="c" * 64,
            object_key=f"raw/eat/bid-detail/{args.external_bid_id}.xml.gz",
            fetched_at=FETCHED_AT,
        )

    def normalize(self, args: Namespace) -> None:
        self._record("normalize", args)
        self.normalized.append(args.observation_id)

    def validate(self, args: Namespace) -> None:
        self._record("validate", args)

    def project(self, args: Namespace) -> None:
        self._record("project", args)

    def replay(self, args: Namespace) -> None:
        self._record("replay", args)

    def build_marts(self, args: Namespace) -> None:
        self._record("build-marts", args)

    def capture_reference(self, args: Namespace) -> None:
        self._record("capture-reference", args)

    def project_reference(self, args: Namespace) -> None:
        self._record("project-reference", args)

    def capture_code_vocabulary(self, args: Namespace) -> None:
        self._record("capture-code-vocabulary", args)

    def project_code_vocabulary(self, args: Namespace) -> None:
        self._record("project-code-vocabulary", args)

    def fail_release(self, args: Namespace) -> None:
        self._record("fail-release", args)

    def scan_contract(self, args: Namespace) -> ScanReport:
        # 조사 명령은 release에 매이지 않고 보고서만 돌려준다(EAT-251).
        if self.error is not None:
            raise self.error
        self.calls.append(("scan-contract", None))
        return ScanReport(parser_version=args.parser_version, started_at=FETCHED_AT)

    def next_replay_target(self, args: Namespace) -> None:
        # 고를 것이 없는 회차도 정상이며 그때는 machine result가 없다(EAT-274).
        if self.error is not None:
            raise self.error
        self.calls.append(("next-replay-target", None))

    def reap_marts(self, args: Namespace) -> ReapReport:
        # 회수도 release에 매이지 않는다(EAT-254).
        if self.error is not None:
            raise self.error
        self.calls.append(("reap-marts", None))
        return ReapReport(as_of=args.as_of, reaped=())


def _공통(command: str) -> list[str]:
    return [
        command,
        "--run-id",
        RUN_ID,
        "--source-release-id",
        RELEASE_ID,
        "--build-sha",
        SHA,
        "--parser-version",
        "eat-v1",
    ]


# 감시와 전진 판단은 어떤 release에도 속하지 않는다. 지금의 DB 상태만 보므로 release·run 인수를 받지
# 않는다. 이 집합이 자라면 여기에 더한다 — 그것이 "이 명령은 무엇에도 매이지 않는다"의 선언이다.
RELEASE_FREE_COMMANDS = frozenset(
    {
        "check-expectations",
        "next-backfill-window",
        "scan-contract",
        "reap-marts",
        "next-replay-target",
    }
)
RELEASE_SCOPED_COMMANDS = tuple(
    name for name in COMMAND_HANDLERS if name not in RELEASE_FREE_COMMANDS
)


def _명령(command: str) -> list[str]:
    if command == "check-expectations":
        return [command]
    if command == "scan-contract":
        # 조사 명령이다. DB에 쓰지 않고 어떤 run에도 매이지 않는다(EAT-251).
        return [command, "--parser-version", "eat-v3"]
    if command == "next-backfill-window":
        return [command, "--floor-date", "20250901", "--as-of", "2026-09-01T00:06:00Z"]
    if command == "reap-marts":
        return [command, "--as-of", "2026-09-01T00:06:00Z"]
    if command == "next-replay-target":
        # 다시 시도할 가치를 build_sha로 판단하므로 그 값만 받는다(EAT-274).
        return [
            command,
            "--run-id",
            RUN_ID,
            "--build-sha",
            SHA,
            "--as-of",
            "2026-09-01T00:06:00Z",
        ]
    if command == "fail-release":
        # 운영자 판정 명령이라 run·parser version 같은 공통 인수가 없다.
        return [
            command,
            "--source-release-id",
            RELEASE_ID,
            "--build-sha",
            SHA,
            "--failure-category",
            "INTERRUPTED",
            "--failed-at",
            "2026-09-01T00:06:00Z",
        ]
    extras = {
        "discover": [
            "--detail-run-id",
            PUBLICATION_ID,
            "--mode",
            "backfill",
            "--release-name",
            "R0 offline",
            "--as-of",
            "2026-09-01T00:00:00Z",
            "--started-at",
            "2026-09-01T00:00:00Z",
            "--completed-at",
            "2026-09-01T00:01:00Z",
            "--start-date",
            "20260901",
            "--end-date",
            "20260901",
        ],
        "capture": [
            "--external-bid-ids-json",
            '["5610615"]',
            "--started-at",
            "2026-09-01T00:00:00Z",
        ],
        "normalize": [
            "--observation-ids-json",
            "[1]",
            "--normalized-at",
            "2026-09-01T00:01:00Z",
        ],
        "validate": [
            "--publication-id",
            PUBLICATION_ID,
            "--validated-at",
            "2026-09-01T00:02:00Z",
        ],
        "project": [
            "--publication-id",
            PUBLICATION_ID,
            "--activated-at",
            "2026-09-01T00:03:00Z",
        ],
        "replay": [
            "--publication-id",
            PUBLICATION_ID,
            "--observation-id",
            "1",
            "--started-at",
            "2026-09-01T00:00:00Z",
            "--normalized-at",
            "2026-09-01T00:01:00Z",
            "--validated-at",
            "2026-09-01T00:02:00Z",
            "--activated-at",
            "2026-09-01T00:03:00Z",
        ],
        "build-marts": [
            "--calc-version",
            "mart-r1",
            "--as-of",
            "2026-09-01T00:00:00Z",
            "--built-at",
            "2026-09-01T00:04:00Z",
        ],
        "capture-reference": [
            "--source",
            "mois-standard-code",
            "--dataset",
            "legal-dong",
            "--release-name",
            "legal-dong 2026-09-06",
            "--as-of",
            "2026-09-01T00:00:00Z",
            "--started-at",
            "2026-09-01T00:00:00Z",
        ],
        "project-reference": [
            "--source",
            "mois-standard-code",
            "--dataset",
            "legal-dong",
            "--observation-id",
            "1",
            "--release-name",
            "legal-dong 2026-09-06",
            "--projected-at",
            "2026-09-01T00:05:00Z",
        ],
        "capture-code-vocabulary": [
            "--release-name",
            "eat-code-vocabulary 2026-09-16",
            "--as-of",
            "2026-09-01T00:00:00Z",
            "--started-at",
            "2026-09-01T00:00:00Z",
        ],
        "project-code-vocabulary": [
            "--observation-id",
            "1",
            "--projected-at",
            "2026-09-01T00:05:00Z",
        ],
    }
    return _공통(command) + extras[command]


def test_감시_command는_release에_매이지_않아_인수_없이_해석된다() -> None:
    parsed = build_parser().parse_args(["check-expectations"])

    assert parsed.command == "check-expectations"
    assert not hasattr(parsed, "source_release_id")


def test_계약_조사_command는_parser_version과_창_범위만_받고_기본_상한을_갖는다() -> (
    None
):
    parsed = build_parser().parse_args(
        [
            "scan-contract",
            "--parser-version",
            "eat-v3",
            "--window-start",
            "20250901",
            "--window-end",
            "20250930",
        ]
    )

    assert parsed.command == "scan-contract"
    assert (parsed.parser_version, parsed.window_start, parsed.window_end) == (
        "eat-v3",
        "20250901",
        "20250930",
    )
    assert parsed.limit == 20000
    assert not hasattr(parsed, "source_release_id")


def test_release에_매인_command는_모두_UUID_source_release_id를_요구한다() -> None:
    parser = build_parser()
    for command in RELEASE_SCOPED_COMMANDS:
        missing = _명령(command)
        index = missing.index("--source-release-id")
        del missing[index : index + 2]
        with pytest.raises(SystemExit):
            parser.parse_args(missing)
        invalid = _명령(command)
        invalid[invalid.index(RELEASE_ID)] = "not-a-uuid"
        with pytest.raises(SystemExit):
            parser.parse_args(invalid)


@pytest.mark.parametrize("command", tuple(COMMAND_HANDLERS))
def test_command_handler가_주입된_application_method를_실행하고_0을_반환한다(
    command: str,
) -> None:
    application = _기록애플리케이션()
    expected_release = None if command in RELEASE_FREE_COMMANDS else UUID(RELEASE_ID)
    assert (
        main(
            _명령(command), application_factory=lambda _: application, settings=_설정()
        )
        == 0
    )
    assert application.calls == [(command, expected_release)]
    assert application.close_count == 1


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (RuntimeError("dsn=postgresql://user:db-password@localhost/eatbid"), 64),
        (DataQuarantinedError(7, "store rejected r2-secret"), 65),
        (SourceUnavailableError("host=access-secret", attempts=3), 69),
        (SourceThrottledError(429), 75),
        (SourceContractError("key=access-secret"), 76),
    ],
)
def test_typed_failure는_secret없이_정해진_exit_code를_반환한다(
    error: Exception, expected: int, capsys: pytest.CaptureFixture[str]
) -> None:
    application = _기록애플리케이션(error=error)
    assert (
        main(
            _명령("discover"),
            application_factory=lambda _: application,
            settings=_설정(),
        )
        == expected
    )
    printed = capsys.readouterr().err
    assert all(
        value not in printed for value in ("db-password", "r2-secret", "access-secret")
    )
    assert application.close_count == 1


def _설정(**overrides: object) -> ApplicationSettings:
    values: dict[str, object] = {
        "DATABASE_URL": "postgresql://user:db-password@localhost:5432/eatbid",
        "R2_ENDPOINT_URL": "https://account.r2.cloudflarestorage.com",
        "R2_BUCKET": "eatbid-raw",
        "R2_ACCESS_KEY_ID": "access-secret",
        "R2_SECRET_ACCESS_KEY": "r2-secret",
        "SOURCE_CONNECT_TIMEOUT_SECONDS": 10,
        "SOURCE_READ_TIMEOUT_SECONDS": 30,
        "SOURCE_WRITE_TIMEOUT_SECONDS": 10,
        "SOURCE_POOL_TIMEOUT_SECONDS": 10,
        "SOURCE_PAGE_BUDGET": 100,
    }
    values.update(overrides)
    return ApplicationSettings(**values)


def test_settings는_bounded_config를_검증하고_secret을_표현하지_않는다() -> None:
    settings = _설정()
    rendered = repr(settings)
    assert all(
        value not in rendered for value in ("db-password", "access-secret", "r2-secret")
    )
    with pytest.raises(ValidationError) as captured:
        _설정(SOURCE_CONNECT_TIMEOUT_SECONDS=0, SOURCE_PAGE_BUDGET=0)
    assert all(
        value not in str(captured.value)
        for value in ("db-password", "access-secret", "r2-secret")
    )


def test_application_factory_구성실패도_secret을_stderr에_노출하지_않는다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    def fail(_: object) -> _기록애플리케이션:
        raise RuntimeError("postgresql://user:secret@localhost/db")

    assert main(_명령("discover"), application_factory=fail, settings=_설정()) == 64
    assert "secret" not in capsys.readouterr().err


class _닫힘기록:
    def __init__(self, events: list[str] | None = None, name: str = "") -> None:
        self.close_count = 0
        self.events = events
        self.name = name

    def close(self) -> None:
        self.close_count += 1
        if self.events is not None:
            self.events.append(self.name)


@pytest.mark.parametrize("body_error", [False, True])
def test_application_context가_정상과_예외에서_HTTP와_DB를_정확히_한번_닫는다(
    body_error: bool,
) -> None:
    connection = _닫힘기록()
    http_client = _닫힘기록()
    application = Application.for_test(
        connection=connection,
        http_client=http_client,
    )

    if body_error:
        with pytest.raises(LookupError), application:
            raise LookupError("본문 실패")
    else:
        with application:
            pass

    assert connection.close_count == 1
    assert http_client.close_count == 1


def test_R2_구성실패는_HTTP와_DB를_역순으로_한번씩_닫고_secret을_숨긴다(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    connection = _닫힘기록(events, "db")
    http_client = _닫힘기록(events, "http")
    monkeypatch.setattr("eatbid.composition.psycopg.connect", lambda _: connection)
    monkeypatch.setattr("eatbid.composition.EatHttpClient", lambda **_: http_client)

    def fail_store(_: object) -> object:
        raise RuntimeError("r2-secret-provider")

    monkeypatch.setattr("eatbid.composition.R2RawObjectStore", fail_store)
    with pytest.raises(
        RuntimeError, match="application configuration failed"
    ) as captured:
        build_application(_설정())
    assert events == ["http", "db"]
    assert captured.value.__cause__ is None
    assert captured.value.__context__ is None
    assert "secret" not in repr(captured.value)


def test_discover는_mode를_요구하고_검토된_모드만_받는다() -> None:
    parser = build_parser()
    without_mode = _명령("discover")
    index = without_mode.index("--mode")
    del without_mode[index : index + 2]
    with pytest.raises(SystemExit):
        parser.parse_args(without_mode)
    unknown_mode = _명령("discover")
    unknown_mode[unknown_mode.index("backfill")] = "replay"
    with pytest.raises(SystemExit):
        parser.parse_args(unknown_mode)
    scheduled = _명령("discover")
    for flag in ("--start-date", "--end-date"):
        index = scheduled.index(flag)
        del scheduled[index : index + 2]
    scheduled[scheduled.index("backfill")] = "poll-open"
    parsed = parser.parse_args(scheduled)
    assert (parsed.mode, parsed.start_date, parsed.end_date) == ("poll-open", "", "")


class _발견결과애플리케이션(_기록애플리케이션):
    def discover(self, args: Namespace) -> DiscoveryResult:
        self._record("discover", args)
        return DiscoveryResult(
            source_release_id=UUID(RELEASE_ID),
            expected_count=2,
            external_bid_ids=("7", "11"),
            observation_ids=(1,),
            detail_run_id=UUID(PUBLICATION_ID),
            detail_request_unit_ids=(2, 3),
            discovered_manifest_sha256="b" * 64,
            detail_external_bid_ids=("7", "11"),
            refetch_reason_counts={"full-mode": 2, "unchanged": 0},
            baseline_source_release_id=None,
        )


def test_감시_결과는_심장박동이_나갔는지를_함께_남긴다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    # skipped와 sent를 구분해 남겨야 "URL이 없어서 안 나갔다"가 로그에서 보인다. 그 상태로 운영에 오래
    # 있으면 바깥 감시가 켜져 있다고 믿는 채로 눈이 먼다(EAT-171).
    application = _기록애플리케이션()

    assert (
        main(
            _명령("check-expectations"),
            application_factory=lambda _: application,
            settings=_설정(),
        )
        == 0
    )

    printed = json.loads(capsys.readouterr().out)
    assert printed["heartbeat"] == "skipped"
    # 회차 지표 행도 같은 이유로 남긴다 — 기록자가 빠진 채 오래 돌면 선이 끊긴 줄 모른다(EAT-227).
    assert printed["round_recorded"] is False


def test_전진_결과의_불리언은_Argo가_읽는_소문자로_적힌다(
    tmp_path: Path,
) -> None:
    """`str(True)`는 `True`이고 Argo의 `when`은 `true`와 비교한다.

    2026-09-14~15에 전진 cron이 28시간 동안 매시 `Succeeded`로 끝나면서
    `when 'True == true' evaluated false`로 본 단계를 통째로 건너뛰었다. 실패가 아니라 성공으로
    보였기 때문에 어떤 감시도 그것을 잡지 못했다. 이 파일에 적히는 정확한 글자가 계약이다.
    """

    class _창을고르는애플리케이션(_기록애플리케이션):
        def next_backfill_window(self, args: Namespace) -> BackfillWindow:
            return BackfillWindow(start_date="20260601", end_date="20260630")

    application = _창을고르는애플리케이션()
    argv = _명령("next-backfill-window") + ["--result-dir", str(tmp_path / "win")]

    assert main(argv, application_factory=lambda _: application, settings=_설정()) == 0

    written = {
        path.name: path.read_text(encoding="utf-8")
        for path in (tmp_path / "win").iterdir()
    }
    assert written == {
        "has_window": "true",
        "start_date": "20260601",
        "end_date": "20260630",
    }


def test_고를_창이_없으면_거짓도_소문자로_적힌다(tmp_path: Path) -> None:
    class _창이없는애플리케이션(_기록애플리케이션):
        def next_backfill_window(self, args: Namespace) -> None:
            return None

    application = _창이없는애플리케이션()
    argv = _명령("next-backfill-window") + ["--result-dir", str(tmp_path / "none")]

    assert main(argv, application_factory=lambda _: application, settings=_설정()) == 0

    경로 = tmp_path / "none" / "has_window"
    assert not 경로.exists() or 경로.read_text(encoding="utf-8") == "false"


def test_result_dir는_machine_result의_key마다_workflow가_읽을_파일을_남긴다(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    application = _발견결과애플리케이션()
    argv = _명령("discover") + ["--result-dir", str(tmp_path / "out")]

    assert main(argv, application_factory=lambda _: application, settings=_설정()) == 0

    printed = json.loads(capsys.readouterr().out)
    assert printed["external_bid_ids"] == ["7", "11"]
    written = {
        path.name: path.read_text(encoding="utf-8")
        for path in (tmp_path / "out").iterdir()
    }
    assert written == {
        "detail_run_id": PUBLICATION_ID,
        "discovered_count": "2",
        "external_bid_ids": '["7","11"]',
        "external_bid_id_chunks": '[["7","11"]]',
        "detail_count": "2",
        "refetch_reasons": '{"full-mode":2,"unchanged":0}',
        "baseline_source_release_id": "",
        "manifest_sha256": "b" * 64,
        "source_release_id": RELEASE_ID,
    }


def test_발견은_50건_단위_chunk를_발견_순서대로_낸다() -> None:
    result = DiscoveryResult(
        source_release_id=UUID(RELEASE_ID),
        expected_count=120,
        external_bid_ids=tuple(str(number) for number in range(1, 121)),
        observation_ids=(1,),
        detail_run_id=UUID(PUBLICATION_ID),
        detail_request_unit_ids=(),
        discovered_manifest_sha256="b" * 64,
        detail_external_bid_ids=tuple(str(number) for number in range(1, 121)),
        refetch_reason_counts={"full-mode": 120, "unchanged": 0},
        baseline_source_release_id=None,
    )

    chunks = result.external_bid_id_chunks

    assert [len(chunk) for chunk in chunks] == [50, 50, 20]
    assert (
        tuple(value for chunk in chunks for value in chunk) == result.external_bid_ids
    )


def test_chunk는_목록_전체가_아니라_상세를_부르기로_한_ID만_담는다() -> None:
    result = DiscoveryResult(
        source_release_id=UUID(RELEASE_ID),
        expected_count=3,
        external_bid_ids=("1", "2", "3"),
        observation_ids=(1,),
        detail_run_id=UUID(PUBLICATION_ID),
        detail_request_unit_ids=(),
        discovered_manifest_sha256="b" * 64,
        detail_external_bid_ids=("2",),
        refetch_reason_counts={"signal-changed": 1, "unchanged": 2},
        baseline_source_release_id=UUID(RELEASE_ID),
    )

    assert result.external_bid_id_chunks == (("2",),)
    with pytest.raises(ValueError, match="discovered IDs"):
        DiscoveryResult(
            source_release_id=UUID(RELEASE_ID),
            expected_count=1,
            external_bid_ids=("1",),
            observation_ids=(1,),
            detail_run_id=UUID(PUBLICATION_ID),
            detail_request_unit_ids=(),
            discovered_manifest_sha256="b" * 64,
            detail_external_bid_ids=("9",),
            refetch_reason_counts={"new": 1, "unchanged": 0},
            baseline_source_release_id=None,
        )


def test_capture_chunk는_건별로_application을_부르고_관측_ID를_fan_out에_남긴다(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    application = _기록애플리케이션()
    argv = _공통("capture") + [
        "--external-bid-ids-json",
        '["5610615","5610616","5610617"]',
        "--started-at",
        "2026-09-01T00:00:00Z",
        "--result-dir",
        str(tmp_path / "capture"),
    ]

    assert main(argv, application_factory=lambda _: application, settings=_설정()) == 0

    assert application.captured == ["5610615", "5610616", "5610617"]
    printed = json.loads(capsys.readouterr().out)
    assert printed["observation_ids"] == [1, 2, 3]
    assert printed["failed_count"] == 0
    assert [item["key"] for item in printed["results"]] == application.captured
    assert all(item["status"] == "succeeded" for item in printed["results"])
    written = (tmp_path / "capture" / "observation_ids").read_text(encoding="utf-8")
    assert written == "[1,2,3]"


def test_normalize_chunk는_관측_ID를_숫자로_되돌려_건별로_부른다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    application = _기록애플리케이션()
    argv = _공통("normalize") + [
        "--observation-ids-json",
        "[7,11]",
        "--normalized-at",
        "2026-09-01T00:01:00Z",
    ]

    assert main(argv, application_factory=lambda _: application, settings=_설정()) == 0

    assert application.normalized == [7, 11]
    printed = json.loads(capsys.readouterr().out)
    assert "observation_ids" not in printed
    assert [item["key"] for item in printed["results"]] == ["7", "11"]


class _한건실패애플리케이션(_기록애플리케이션):
    def __init__(self, failing_key: str, error: Exception) -> None:
        super().__init__()
        self.failing_key = failing_key
        self.failure = error
        self.attempts: list[str] = []

    def capture(self, args: Namespace) -> CapturedObservation:
        self.attempts.append(args.external_bid_id)
        if args.external_bid_id == self.failing_key:
            raise self.failure
        return super().capture(args)


def test_chunk_안_한_건의_전송_실패는_그_건만_실패로_남기고_fail_closed로_끝난다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    application = _한건실패애플리케이션(
        "5610616", SourceUnavailableError("host=access-secret", attempts=3)
    )
    argv = _공통("capture") + [
        "--external-bid-ids-json",
        '["5610615","5610616","5610617"]',
        "--started-at",
        "2026-09-01T00:00:00Z",
    ]

    assert main(argv, application_factory=lambda _: application, settings=_설정()) == 69

    assert application.attempts == ["5610615", "5610616", "5610617"]
    captured = capsys.readouterr()
    printed = json.loads(captured.out)
    assert printed["observation_ids"] == [1, 2]
    assert printed["failed_count"] == 1
    assert printed["skipped"] == []
    failed = [item for item in printed["results"] if item["status"] == "failed"]
    assert failed == [
        {"key": "5610616", "status": "failed", "failure_category": "TRANSIENT_NETWORK"}
    ]
    reported = json.loads(captured.err.strip())
    assert reported["chunk_item"] == "5610616"
    assert reported["category"] == "TRANSIENT_NETWORK"
    assert "access-secret" not in captured.err


def test_소스가_차단하면_남은_건을_시도하지_않고_차단_exit_code로_닫는다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    application = _한건실패애플리케이션("5610616", SourceThrottledError(429))
    argv = _공통("capture") + [
        "--external-bid-ids-json",
        '["5610615","5610616","5610617"]',
        "--started-at",
        "2026-09-01T00:00:00Z",
    ]

    assert main(argv, application_factory=lambda _: application, settings=_설정()) == 75

    assert application.attempts == ["5610615", "5610616"]
    printed = json.loads(capsys.readouterr().out)
    assert printed["skipped"] == ["5610617"]
    assert printed["observation_ids"] == [1]


class _격리애플리케이션(_기록애플리케이션):
    def normalize(self, args: Namespace) -> None:
        if args.observation_id == 2:
            raise DataQuarantinedError(2, "unknown code r2-secret")
        super().normalize(args)


def test_normalize_chunk의_격리_한_건은_실패가_아니라_기록된_최종_상태로_남고_0으로_끝난다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    application = _격리애플리케이션()
    argv = _공통("normalize") + [
        "--observation-ids-json",
        "[1,2,3]",
        "--normalized-at",
        "2026-09-01T00:01:00Z",
    ]

    assert main(argv, application_factory=lambda _: application, settings=_설정()) == 0

    assert application.normalized == [1, 3]
    captured = capsys.readouterr()
    printed = json.loads(captured.out)
    assert printed["failed_count"] == 0
    assert printed["quarantined_count"] == 1
    assert [item["status"] for item in printed["results"]] == [
        "succeeded",
        "quarantined",
        "succeeded",
    ]
    reported = json.loads(captured.err.strip())
    assert reported["chunk_item"] == "2"
    assert reported["category"] == "DATA_QUARANTINED"
    assert "r2-secret" not in captured.err


class _닫기애플리케이션(_기록애플리케이션):
    def fail_release(self, args: Namespace) -> FailedSourceRelease:
        self._record("fail-release", args)
        return FailedSourceRelease(
            source_release_id=args.source_release_id,
            source="eat",
            as_of=FETCHED_AT,
            failure_category=args.failure_category,
            closed_run_ids=(UUID(RUN_ID),),
        )


def test_fail_release는_닫은_release와_run을_machine_result로_남긴다(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    application = _닫기애플리케이션()
    argv = _명령("fail-release") + ["--result-dir", str(tmp_path)]

    assert main(argv, application_factory=lambda _: application, settings=_설정()) == 0

    printed = json.loads(capsys.readouterr().out)
    assert printed == {
        "source_release_id": RELEASE_ID,
        "status": "failed",
        "failure_category": "INTERRUPTED",
        "closed_run_ids": [RUN_ID],
    }
    assert (tmp_path / "failure_category").read_text(encoding="utf-8") == "INTERRUPTED"


def test_fail_release는_운영_어휘_밖의_category를_인자_단계에서_거부한다() -> None:
    argv = _명령("fail-release")
    argv[argv.index("INTERRUPTED")] = "PROJECTION_CONTRACT"

    with pytest.raises(SystemExit):
        build_parser().parse_args(argv)


@pytest.mark.parametrize(
    "value",
    [
        "[]",
        "not-json",
        "{}",
        '"5610615"',
        "[5610615]",
        '["5610615","5610615"]',
        '["0610615"]',
        '["-1"]',
        '["5610615; touch /tmp/eatbid-injection"]',
        '["$(touch /tmp/eatbid-substitution)"]',
        '["*"]',
        "[null]",
    ],
)
def test_capture_chunk_인자는_숫자_ID의_고유한_JSON_배열만_받는다(value: str) -> None:
    argv = _공통("capture") + [
        "--external-bid-ids-json",
        value,
        "--started-at",
        "2026-09-01T00:00:00Z",
    ]

    with pytest.raises(SystemExit):
        build_parser().parse_args(argv)


@pytest.mark.parametrize(
    "value",
    [
        "[]",
        "not-json",
        "{}",
        '["7"]',
        "[0]",
        "[-1]",
        "[true]",
        "[9223372036854775808]",
        "[7,7]",
    ],
)
def test_normalize_chunk_인자는_양의_bigint_고유_JSON_배열만_받는다(value: str) -> None:
    argv = _공통("normalize") + [
        "--observation-ids-json",
        value,
        "--normalized-at",
        "2026-09-01T00:01:00Z",
    ]

    with pytest.raises(SystemExit):
        build_parser().parse_args(argv)


class _마트결과애플리케이션(_기록애플리케이션):
    def build_marts(self, args: Namespace) -> tuple[MartBuildResult, ...]:
        self._record("build-marts", args)
        self.requested = args.mart
        return (
            MartBuildResult(
                mart_name="org_round_summary", build_id=7, row_count=11, status="active"
            ),
        )


def test_build_marts는_발행_없이_전량_재빌드를_받고_mart_이름을_반복해_좁힌다() -> None:
    parser = build_parser()

    full = parser.parse_args(_명령("build-marts"))
    assert (full.publication_id, full.mart) == (None, None)
    assert (full.calc_version, full.region_scheme) == (
        "mart-r1",
        "eat:auction-location-sigungu",
    )

    scoped = parser.parse_args(
        _명령("build-marts")
        + [
            "--publication-id",
            PUBLICATION_ID,
            "--mart",
            "org_round_summary",
            "--mart",
            "open_auction_snapshot",
        ]
    )
    assert scoped.publication_id == UUID(PUBLICATION_ID)
    assert scoped.mart == ["org_round_summary", "open_auction_snapshot"]

    with pytest.raises(SystemExit):
        parser.parse_args(_명령("build-marts") + ["--mart", "supplier_monthly_record"])


def test_build_marts_machine_result는_mart마다_build와_행_수를_남긴다(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    application = _마트결과애플리케이션()
    argv = _명령("build-marts") + ["--result-dir", str(tmp_path / "marts")]

    assert main(argv, application_factory=lambda _: application, settings=_설정()) == 0

    printed = json.loads(capsys.readouterr().out)
    assert printed == {
        "marts": [
            {
                "build_id": 7,
                "mart_name": "org_round_summary",
                "row_count": 11,
                "status": "active",
            }
        ]
    }
    written = (tmp_path / "marts" / "marts").read_text(encoding="utf-8")
    assert json.loads(written) == printed["marts"]


RELEASE_COMMIT = "9c9ff63f479d03f0fbfcc036954e8470b182bb61"


@pytest.mark.parametrize("build_sha", [RELEASE_COMMIT, SHA])
def test_release에_매인_command는_release_commit_40자와_64자_build_sha를_받는다(
    build_sha: str,
) -> None:
    parser = build_parser()
    for command in RELEASE_SCOPED_COMMANDS:
        argv = _명령(command)
        argv[argv.index("--build-sha") + 1] = build_sha

        assert parser.parse_args(argv).build_sha == build_sha


@pytest.mark.parametrize("build_sha", ["a" * 39, "a" * 41, RELEASE_COMMIT.upper()])
def test_길이가_다르거나_대문자인_build_sha는_인자_단계에서_거부한다(
    build_sha: str,
) -> None:
    parser = build_parser()
    argv = _명령("discover")
    argv[argv.index("--build-sha") + 1] = build_sha

    with pytest.raises(SystemExit):
        parser.parse_args(argv)


class _replay인자기록애플리케이션(_기록애플리케이션):
    def __init__(self) -> None:
        super().__init__()
        self.replay_args: list[Namespace] = []

    def replay(self, args: Namespace) -> None:
        self.replay_args.append(args)
        super().replay(args)


def test_replay_command는_release_commit_40자_build_sha를_받아_handler에_그대로_넘긴다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    application = _replay인자기록애플리케이션()
    argv = _명령("replay")
    argv[argv.index("--build-sha") + 1] = RELEASE_COMMIT

    assert main(argv, application_factory=lambda _: application, settings=_설정()) == 0

    assert [args.build_sha for args in application.replay_args] == [RELEASE_COMMIT]
    assert application.calls == [("replay", UUID(RELEASE_ID))]
    assert "CONFIGURATION" not in capsys.readouterr().err


def test_discover의_workflow_이름은_선택_인자라_밖에서_돌릴_때_없어도_된다() -> None:
    # 워크플로 밖(테스트·수동 실행)에서 만든 run은 이름이 없는 것이 사실이다. 필수로 두면 그 실행이 막힌다(EAT-231).
    parser = build_parser()

    assert parser.parse_args(_명령("discover")).workflow_name is None
    assert (
        parser.parse_args(
            [*_명령("discover"), "--workflow-name", "eatbid-poll-open-1789504380"]
        ).workflow_name
        == "eatbid-poll-open-1789504380"
    )
