from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CHECKER = REPOSITORY_ROOT / "tools" / "quality" / "check-python-semantic-values.py"


def _run(tmp_path: Path, files: dict[str, str]) -> subprocess.CompletedProcess[str]:
    for relative_path, source in files.items():
        file = tmp_path / relative_path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(source, encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(CHECKER), "--root", str(tmp_path)],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def _assert_violation(tmp_path: Path, source: str, rule: str) -> None:
    result = _run(tmp_path, {"apps/dataplane/src/eatbid/core/example.py": source})
    assert result.returncode != 0, result.stdout + result.stderr
    assert f"[{rule}]" in result.stdout + result.stderr


def test_naive_datetime의_직접_별칭_속성_조건부_우회를_거부한다(tmp_path: Path) -> None:
    mutations = [
        "from datetime import datetime\nvalue = datetime.now()\n",
        "from datetime import datetime as Clock\nvalue = Clock.utcnow()\n",
        "import datetime as dates\nvalue = dates.datetime(2026, 8, 30)\n",
        "from datetime import datetime\nnow = datetime.now\nvalue = now()\n",
        "from datetime import datetime\nclock = datetime if condition else safe_clock\nvalue = clock.now()\n",
    ]
    for index, source in enumerate(mutations):
        case = tmp_path / str(index)
        case.mkdir()
        _assert_violation(case, source, "naive-datetime")


def test_aware_datetime과_ZoneInfo_해석은_허용한다(tmp_path: Path) -> None:
    result = _run(
        tmp_path,
        {
            "apps/dataplane/src/eatbid/core/example.py": """
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

utc_now = datetime.now(timezone.utc)
seoul_value = datetime(2026, 8, 30, tzinfo=ZoneInfo("Asia/Seoul"))
""",
        },
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_금액과_비율의_float_annotation과_변환_별칭을_거부한다(tmp_path: Path) -> None:
    mutations = [
        "from pydantic import BaseModel\nclass Auction(BaseModel):\n    bid_rate: float\n",
        "from typing import Optional\nbase_amount: Optional[float] = None\n",
        "bid_rate = float(raw_rate)\n",
        "to_float = float\nplanned_amount = to_float(raw_amount)\n",
    ]
    for index, source in enumerate(mutations):
        case = tmp_path / str(index)
        case.mkdir()
        _assert_violation(case, source, "float-semantic-value")


def test_Decimal_금액과_좌표_float는_허용한다(tmp_path: Path) -> None:
    result = _run(
        tmp_path,
        {
            "apps/dataplane/src/eatbid/core/example.py": """
from decimal import Decimal

base_amount: Decimal = Decimal("123.45")
latitude: float = 37.5665
longitude: float = 126.9780
""",
        },
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_원시_sleep의_직접_모듈_별칭_조건부_우회를_거부한다(tmp_path: Path) -> None:
    mutations = [
        "from time import sleep\nsleep(5)\n",
        "import asyncio as aio\nawait aio.sleep(1 + 2)\n",
        "from time import sleep as pause\npause(0.5)\n",
        "from time import sleep\nsleeper = sleep if condition else fallback\nsleeper(3)\n",
    ]
    for index, source in enumerate(mutations):
        case = tmp_path / str(index)
        case.mkdir()
        _assert_violation(case, source, "raw-sleep-value")


def test_timedelta에서_이름_붙여_변환한_sleep은_허용한다(tmp_path: Path) -> None:
    result = _run(
        tmp_path,
        {
            "apps/dataplane/src/eatbid/core/example.py": """
from datetime import timedelta
from time import sleep

RETRY_DELAY = timedelta(seconds=5)
sleep(RETRY_DELAY.total_seconds())
""",
        },
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_손으로_작성한_normalized_Pydantic과_별칭_base를_거부한다(tmp_path: Path) -> None:
    mutations = [
        "from pydantic import BaseModel\nclass NormalizedAuction(BaseModel):\n    auction_id: str\n",
        "from pydantic import BaseModel as Model\nclass CanonicalAuction(Model):\n    auction_id: str\n",
        "from pydantic import BaseModel\nBase = BaseModel if condition else object\nclass InterchangeAuction(Base):\n    auction_id: str\n",
    ]
    for index, source in enumerate(mutations):
        case = tmp_path / str(index)
        case.mkdir()
        _assert_violation(case, source, "handwritten-normalized-pydantic")


def test_source_Pydantic과_exact_generated_model은_허용한다(tmp_path: Path) -> None:
    result = _run(
        tmp_path,
        {
            "apps/dataplane/src/eatbid/source/eat/models.py": """
from pydantic import BaseModel
class EatSourcePayload(BaseModel):
    BID_CALC_AMT: str | None = None
""",
            "apps/dataplane/src/eatbid/generated/ingestion_v1.py": """
from pydantic import BaseModel
class GeneratedAuction(BaseModel):
    auction_id: str
""",
        },
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_checker_결과는_JSON이_아닌_안정된_rule과_경로를_출력한다(tmp_path: Path) -> None:
    result = _run(
        tmp_path,
        {"apps/dataplane/src/eatbid/core/example.py": "from datetime import datetime\nvalue = datetime.now()\n"},
    )
    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "apps/dataplane/src/eatbid/core/example.py" in output
    assert "[naive-datetime]" in output
    # 실패 표면은 사람이 읽는 진단이어야 하며 우연히 직렬화한 내부 AST에 의존하지 않는다.
    try:
        json.loads(output)
    except json.JSONDecodeError:
        pass
    else:
        raise AssertionError("checker output must not expose raw JSON internals")
