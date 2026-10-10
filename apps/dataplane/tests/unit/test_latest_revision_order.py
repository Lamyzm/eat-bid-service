from __future__ import annotations

import re

from eatbid.mart import (
    build_exclusion,
    open_auction_snapshot,
    org_round_summary,
    win_rate_distribution,
)
from eatbid.mart.latest_revision import latest_revision_order


def test_최신_revision은_관측_번호_순이고_같은_관측이면_나중_해석이다() -> None:
    assert latest_revision_order("revision") == "revision.observation_id desc, revision.auction_revision_id desc"


def test_mart_빌드는_최신_revision을_번호만으로_고르지_않는다() -> None:
    # EAT-333: 번호(투영 순)만으로 고르면 늦게 투영된 옛 관측이 최신이 된다. 네 빌드의 SQL에서 `X.auction_revision_id desc`는
    # 모두 같은 별칭의 관측 번호 정렬 바로 뒤에만 나와야 한다.
    sources = {
        "build_exclusion": build_exclusion.BUILD_STALE_AUCTION_FILL_SQL,
        "open_auction_snapshot": open_auction_snapshot._FILL_TERMS_SQL,
        "org_round_summary": org_round_summary.ORG_ROUND_SUMMARY_FILL_SQL,
        "win_rate_distribution": win_rate_distribution.WIN_RATE_DISTRIBUTION_FILL_SQL,
    }
    for name, sql in sources.items():
        orders = re.findall(r"(\w+)\.auction_revision_id desc", sql)
        assert orders, name
        for alias in orders:
            assert latest_revision_order(alias) in sql, (name, alias)
