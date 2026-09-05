from __future__ import annotations

import json
from argparse import Namespace
from pathlib import Path
from typing import Self
from uuid import UUID

import pytest
from pydantic import ValidationError

from eatbid.cli import COMMAND_HANDLERS, build_parser, main
from eatbid.composition import Application, build_application
from eatbid.config import ApplicationSettings
from eatbid.errors import SourceContractError
from eatbid.pipeline.capture import SourceThrottledError
from eatbid.pipeline.discover import DiscoveryResult
from eatbid.pipeline.normalize import DataQuarantinedError

RUN_ID = "43000000-0000-0000-0000-000000000001"
RELEASE_ID = "43000000-0000-0000-0000-000000000002"
PUBLICATION_ID = "43000000-0000-0000-0000-000000000003"
SHA = "a" * 64


class _기록애플리케이션:
    def __init__(self, *, error: Exception | None = None) -> None:
        self.calls: list[tuple[str, UUID]] = []
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

    def discover(self, args: Namespace) -> None: self._record("discover", args)
    def capture(self, args: Namespace) -> None: self._record("capture", args)
    def normalize(self, args: Namespace) -> None: self._record("normalize", args)
    def validate(self, args: Namespace) -> None: self._record("validate", args)
    def project(self, args: Namespace) -> None: self._record("project", args)
    def replay(self, args: Namespace) -> None: self._record("replay", args)


def _공통(command: str) -> list[str]:
    return [command, "--run-id", RUN_ID, "--source-release-id", RELEASE_ID,
            "--build-sha", SHA, "--parser-version", "eat-v1"]


def _명령(command: str) -> list[str]:
    extras = {
        "discover": ["--detail-run-id", PUBLICATION_ID, "--mode", "backfill",
                     "--release-name", "R0 offline", "--as-of", "2026-09-01T00:00:00Z",
                     "--started-at", "2026-09-01T00:00:00Z", "--completed-at", "2026-09-01T00:01:00Z",
                     "--start-date", "20260901", "--end-date", "20260901"],
        "capture": ["--external-bid-id", "5610615", "--started-at", "2026-09-01T00:00:00Z"],
        "normalize": ["--observation-id", "1", "--normalized-at", "2026-09-01T00:01:00Z"],
        "validate": ["--publication-id", PUBLICATION_ID, "--validated-at", "2026-09-01T00:02:00Z"],
        "project": ["--publication-id", PUBLICATION_ID, "--activated-at", "2026-09-01T00:03:00Z"],
        "replay": ["--publication-id", PUBLICATION_ID, "--observation-id", "1",
                   "--started-at", "2026-09-01T00:00:00Z", "--normalized-at", "2026-09-01T00:01:00Z",
                   "--validated-at", "2026-09-01T00:02:00Z", "--activated-at", "2026-09-01T00:03:00Z"],
    }
    return _공통(command) + extras[command]


def test_모든_command가_UUID_source_release_id를_요구한다() -> None:
    parser = build_parser()
    for command in COMMAND_HANDLERS:
        missing = _명령(command)
        index = missing.index("--source-release-id")
        del missing[index:index + 2]
        with pytest.raises(SystemExit):
            parser.parse_args(missing)
        invalid = _명령(command)
        invalid[invalid.index(RELEASE_ID)] = "not-a-uuid"
        with pytest.raises(SystemExit):
            parser.parse_args(invalid)


@pytest.mark.parametrize("command", tuple(COMMAND_HANDLERS))
def test_command_handler가_주입된_application_method를_실행하고_0을_반환한다(command: str) -> None:
    application = _기록애플리케이션()
    assert main(_명령(command), application_factory=lambda _: application, settings=_설정()) == 0
    assert application.calls == [(command, UUID(RELEASE_ID))]
    assert application.close_count == 1


@pytest.mark.parametrize(("error", "expected"), [
    (RuntimeError("secret=do-not-print"), 64),
    (DataQuarantinedError(7, "secret=do-not-print"), 65),
    (SourceThrottledError(429), 75),
    (SourceContractError("secret=do-not-print"), 76),
])
def test_typed_failure는_secret없이_정해진_exit_code를_반환한다(
    error: Exception, expected: int, capsys: pytest.CaptureFixture[str]
) -> None:
    application = _기록애플리케이션(error=error)
    assert main(_명령("discover"), application_factory=lambda _: application, settings=_설정()) == expected
    assert "do-not-print" not in capsys.readouterr().err
    assert application.close_count == 1


def _설정(**overrides: object) -> ApplicationSettings:
    values: dict[str, object] = {
        "DATABASE_URL": "postgresql://user:db-password@localhost:5432/eatbid",
        "R2_ENDPOINT_URL": "https://account.r2.cloudflarestorage.com",
        "R2_BUCKET": "eatbid-raw", "R2_ACCESS_KEY_ID": "access-secret",
        "R2_SECRET_ACCESS_KEY": "r2-secret", "SOURCE_CONNECT_TIMEOUT_SECONDS": 10,
        "SOURCE_READ_TIMEOUT_SECONDS": 30, "SOURCE_WRITE_TIMEOUT_SECONDS": 10,
        "SOURCE_POOL_TIMEOUT_SECONDS": 10, "SOURCE_PAGE_BUDGET": 100,
    }
    values.update(overrides)
    return ApplicationSettings(**values)


def test_settings는_bounded_config를_검증하고_secret을_표현하지_않는다() -> None:
    settings = _설정()
    rendered = repr(settings)
    assert all(value not in rendered for value in ("db-password", "access-secret", "r2-secret"))
    with pytest.raises(ValidationError) as captured:
        _설정(SOURCE_CONNECT_TIMEOUT_SECONDS=0, SOURCE_PAGE_BUDGET=0)
    assert all(value not in str(captured.value) for value in ("db-password", "access-secret", "r2-secret"))


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
    with pytest.raises(RuntimeError, match="application configuration failed") as captured:
        build_application(_설정())
    assert events == ["http", "db"]
    assert captured.value.__cause__ is None
    assert captured.value.__context__ is None
    assert "secret" not in repr(captured.value)


def test_discover는_mode를_요구하고_검토된_모드만_받는다() -> None:
    parser = build_parser()
    without_mode = _명령("discover")
    index = without_mode.index("--mode")
    del without_mode[index:index + 2]
    with pytest.raises(SystemExit):
        parser.parse_args(without_mode)
    unknown_mode = _명령("discover")
    unknown_mode[unknown_mode.index("backfill")] = "replay"
    with pytest.raises(SystemExit):
        parser.parse_args(unknown_mode)
    scheduled = _명령("discover")
    for flag in ("--start-date", "--end-date"):
        index = scheduled.index(flag)
        del scheduled[index:index + 2]
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
        )


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
        "manifest_sha256": "b" * 64,
        "source_release_id": RELEASE_ID,
    }


RELEASE_COMMIT = "9c9ff63f479d03f0fbfcc036954e8470b182bb61"


@pytest.mark.parametrize("build_sha", [RELEASE_COMMIT, SHA])
def test_모든_command가_release_commit_40자와_64자_build_sha를_받는다(build_sha: str) -> None:
    parser = build_parser()
    for command in COMMAND_HANDLERS:
        argv = _명령(command)
        argv[argv.index("--build-sha") + 1] = build_sha

        assert parser.parse_args(argv).build_sha == build_sha


@pytest.mark.parametrize("build_sha", ["a" * 39, "a" * 41, RELEASE_COMMIT.upper()])
def test_길이가_다르거나_대문자인_build_sha는_인자_단계에서_거부한다(build_sha: str) -> None:
    parser = build_parser()
    argv = _명령("discover")
    argv[argv.index("--build-sha") + 1] = build_sha

    with pytest.raises(SystemExit):
        parser.parse_args(argv)
