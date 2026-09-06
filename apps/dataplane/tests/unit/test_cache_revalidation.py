from __future__ import annotations

import json
from argparse import Namespace
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest
from pydantic import SecretStr

from eatbid.cache_revalidation import (
    REVALIDATE_PATH,
    WebCacheTarget,
    all_auctions_scope,
    mart_scope,
    revalidate_web_cache,
)
from eatbid.composition import Application
from eatbid.core.record_types import AUCTION_V2
from eatbid.mart.models import OpenedMartBuild

TOKEN = SecretStr("revalidate-fixture-token")
PUBLICATION_ID = UUID("45000000-0000-0000-0000-000000000001")
RELEASE_ID = UUID("45000000-0000-0000-0000-000000000002")
RUN_ID = UUID("45000000-0000-0000-0000-000000000003")
BUILD_SHA = "a" * 64
ACTIVATED_AT = datetime(2026, 9, 6, 3, 0, tzinfo=UTC)


class _기록클라이언트:
    def __init__(self, *, status_code: int = 204, error: Exception | None = None) -> None:
        self.status_code = status_code
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def post(
        self,
        url: str,
        *,
        json: Mapping[str, object],
        headers: Mapping[str, str],
        timeout: float,
    ) -> Any:
        self.calls.append(
            {"url": url, "json": dict(json), "headers": dict(headers), "timeout": timeout}
        )
        if self.error is not None:
            raise self.error
        return type("응답", (), {"status_code": self.status_code})()


def _대상() -> WebCacheTarget:
    return WebCacheTarget(base_url="http://web/", token=TOKEN)


def test_발행_범위는_공고_전체_태그_하나로_보낸다() -> None:
    assert all_auctions_scope() == {"allAuctions": True}


def test_mart_범위는_활성화한_mart_이름만_싣는다() -> None:
    assert mart_scope(("org_round_summary", "win_rate_distribution_monthly")) == {
        "marts": ["org_round_summary", "win_rate_distribution_monthly"]
    }
    # 다시 만든 mart가 없으면 보낼 범위도 없다. 빈 요청은 계약이 400으로 막는다.
    assert mart_scope(()) == {}


def test_무효화는_Bearer_토큰과_함께_내부_URL로_POST한다() -> None:
    client = _기록클라이언트()

    assert revalidate_web_cache(all_auctions_scope(), target=_대상(), client=client) is True
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["url"] == f"http://web{REVALIDATE_PATH}"
    assert call["json"] == {"allAuctions": True}
    assert call["headers"]["authorization"] == f"Bearer {TOKEN.get_secret_value()}"


def test_설정이_없거나_범위가_비면_부르지_않는다() -> None:
    client = _기록클라이언트()

    assert revalidate_web_cache(all_auctions_scope(), target=None, client=client) is False
    assert revalidate_web_cache({}, target=_대상(), client=client) is False
    assert client.calls == []


def test_실패는_발행을_멈추지_않고_JSON_한_줄_로그만_남긴다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    client = _기록클라이언트(error=RuntimeError("connect timeout to 10.0.0.1"))

    assert revalidate_web_cache(all_auctions_scope(), target=_대상(), client=client) is False

    line = capsys.readouterr().err.strip()
    record = json.loads(line)
    assert record["event"] == "cache-revalidate-failed"
    assert record["reason"] == "RuntimeError"
    assert record["url"] == f"http://web{REVALIDATE_PATH}"


def test_204가_아닌_응답도_실패로_남기지만_예외를_올리지_않는다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    client = _기록클라이언트(status_code=401)

    assert revalidate_web_cache(mart_scope(("org_round_summary",)), target=_대상(), client=client) is False

    record = json.loads(capsys.readouterr().err.strip())
    assert record["event"] == "cache-revalidate-failed"
    assert record["status"] == 401


def test_로그와_요청에_토큰_값이_노출되지_않는다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    client = _기록클라이언트(error=RuntimeError(TOKEN.get_secret_value()))

    revalidate_web_cache(all_auctions_scope(), target=_대상(), client=client)

    assert TOKEN.get_secret_value() not in capsys.readouterr().err


class _발행저장소:
    def require_publication_corpus(self, *_args: object) -> None:
        return None


class _투영저장소:
    def project_publication(self, **_kwargs: object) -> None:
        return None


class _mart저장소:
    def publication_marts(self, _publication_id: UUID) -> tuple[str, ...]:
        return (AUCTION_V2,)

    def open_build(self, _plan: Any) -> OpenedMartBuild:
        # 같은 봉인된 입력의 결과가 이미 공개 중인 상태다. 다시 쌓지 않고 활성 결과만 돌려준다.
        return OpenedMartBuild(build_id=7, status="active", row_count=3)


def _애플리케이션(기록: list[Mapping[str, object]] | None = None) -> Application:
    return Application(
        connection=None,
        http_client=None,
        release_repository=_발행저장소(),
        projection_repository=_투영저장소(),
        mart_repository=_mart저장소(),
        notify_cache=None if 기록 is None else 기록.append,
    )


def _발행인자() -> Namespace:
    return Namespace(
        source_release_id=RELEASE_ID,
        run_id=RUN_ID,
        publication_id=PUBLICATION_ID,
        build_sha=BUILD_SHA,
        activated_at=ACTIVATED_AT,
    )


def test_발행이_끝난_뒤에만_공고_전체_무효화를_알린다() -> None:
    기록: list[Mapping[str, object]] = []

    _애플리케이션(기록).project(_발행인자())

    assert 기록 == [{"allAuctions": True}]


def test_활성_전환이_끝난_뒤_다시_만든_mart_이름만_알린다() -> None:
    기록: list[Mapping[str, object]] = []

    results = _애플리케이션(기록).build_marts(
        Namespace(
            mart=None,
            source_release_id=RELEASE_ID,
            publication_id=PUBLICATION_ID,
            calc_version="mart-r2",
            build_sha=BUILD_SHA,
            parser_version="eat-v2",
            region_scheme=None,
            as_of=ACTIVATED_AT,
            built_at=ACTIVATED_AT,
        )
    )

    assert [result.mart_name for result in results] == [
        "org_round_summary",
        "win_rate_distribution_monthly",
    ]
    assert 기록 == [{"marts": ["org_round_summary", "win_rate_distribution_monthly"]}]


def test_무효화_설정이_없는_조립에서도_발행은_그대로_끝난다() -> None:
    _애플리케이션().project(_발행인자())
