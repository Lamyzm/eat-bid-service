---
id: EVIDENCE-COMPETITOR-BIDQ-SCREENS
status: evidence
observed_at: 2026-08-30
provenance_reviewed_at: 2026-08-31
---

# 비드큐 공식 공개 사용안내 화면

이 디렉터리는 경쟁 제품의 **공개 안내/교육 화면**을 제품 연구 증거로 보존한다. 라이브 로그인
화면을 캡처한 것이 아니며 eatbid의 디자인 명세나 구현 권위가 아니다. 저작권은 각 원저작자에게
있고 내부 기능·상호작용 분석 목적으로만 사용한다.

## 출처 판정

2026-08-31에 비드큐 공식 사용안내의 직접 이미지와 SHA-256을 다시 대조했다. 7개 모두 공식
원본과 일치한다.

| 파일 | 공식 사용안내 | 등록일 | 직접 이미지 |
|---|---|---:|---|
| `analysisq-1.png`~`analysisq-4.png` | [38 — 분석Q 통합분석 안내](https://www.bidq.co.kr/bidq/customer/usage/view?args=category%3D5&category=5&id=38) | 2024-02-06 | [01](https://www.bidq.co.kr/images/bidq/etc/usage_img01.png) · [02](https://www.bidq.co.kr/images/bidq/etc/usage_img02.png) · [03](https://www.bidq.co.kr/images/bidq/etc/usage_img03.png) · [04](https://www.bidq.co.kr/images/bidq/etc/usage_img04.png) |
| `org-analysis.png` | [28 — 발주처성향분석](https://www.bidq.co.kr/bidq/customer/usage/view?args=category%3D5&category=5&id=28) | 2021-12-16 | [원본](https://storage.googleapis.com/infosenet-public/new_data/board/images/4ab0978bd0c1d02e7dc42c41e63e7062.png) |
| `price-decision.png` | [29 — 투찰금액결정하기](https://www.bidq.co.kr/bidq/customer/usage/view?args=page%3D1%26per-page%3D15&id=29) | 2021-12-16 | [원본](https://storage.googleapis.com/infosenet-public/new_data/board/images/a350e74444280c09de9747ef2305d60a.png) |
| `report.png` | [30 — 분석레포트보기](https://www.bidq.co.kr/bidq/customer/usage/view?args=page%3D1%26per-page%3D15&id=30) | 2021-12-16 | [원본](https://storage.googleapis.com/infosenet-public/new_data/board/images/09ae275469c389fd11345255e8a2a73e.png) |

[인포21C 공개 가이드](https://infose.info21c.net/info21c/customer/guide/site?mode=power1)에도 동일한
발주처 심층분석 화면 내용이 별도 이미지 구성으로 노출된다. `org-analysis.png` 자체는 비드큐 공식
사용안내의 GCS 원본과 hash가 일치하므로 비드큐 화면 evidence로 사용할 수 있다. 다만 이 자료는
공개 교육 화면이지 현재 authenticated live UI의 전체 모습을 증명하지 않는다.

## 관측한 화면 문법

- 조건 filter와 검색을 화면 상단에 밀집시킨다.
- line/histogram과 상세 표를 같은 분석 맥락에 둔다.
- chart drill-down, hover, 기간 zoom을 제공한다.
- 분석 구간을 투찰금액 계산기로 전달하거나 추천 구간을 선택하게 한다.
- report·Excel·인쇄를 결과물로 제공한다.

eatbid는 앞의 두 가지와 출처 연결은 채택하지만 추천 구간, 자동 후보 주입, chart click→가격 적용은
채택하지 않는다. 판정의 권위 문서는 [`../../../product/screen-system.md`](../../../product/screen-system.md)다.

## 공개 FAQ에서 확인한 도메인 언어

[비드큐 자주하는 질문 — 입/낙찰정보](https://www.bidq.co.kr/bidq/customer/faq?category=1)는
발주처·업종/품목·지역·가격·일시 filter, 서로 다른 비율의 산식, 정정·취소·누락과 검색조건 문제,
발주처 성향·구간 빈도·경쟁사 흐름이라는 사용자의 mental model을 보여 준다.

eatbid에 적용할 UX 판정과 적용하지 않을 추천·난수·G2B 전용 규칙은
[`faq-domain-language.md`](faq-domain-language.md)에 분리해 기록한다.

## 무결성

원본 PNG는 내용 변경 없이 `tmp/pdfs/bidq-research`에서 복사했다.

| 파일 | SHA-256 |
|---|---|
| `analysisq-1.png` | `A0537E67C37BE034C2CD1F9863C2493B10073303EA65C32BA188716469132D3D` |
| `analysisq-2.png` | `A5C2B8F07405839008DD8FFA37E9D695C56508C1BAD870CF6F97CDB4BEFDFFBD` |
| `analysisq-3.png` | `2955CD05276D23DC70C6EC7D6D23610C236628F14D54AAEE1000B8096CEA91CB` |
| `analysisq-4.png` | `C5EDDCC8341228A5CCCC0E2C0CBCCC323758135E80C3AC2147FD0FFA0BA70274` |
| `org-analysis.png` | `B8A445DAE46382E2EDA480354584EEF4365ADB2B89ABECB9C5ECD8BA68DFB4A7` |
| `price-decision.png` | `2E70BC093F67093D1B3F7B388ED9CC028C0584F457C771E00E33E263ACBCE0A7` |
| `report.png` | `7146584F6288484E3095206D7ADC547C9B25644EC2E0C748D84953AB5AB40A09` |

공식 페이지가 남아 있어 기능·상호작용 문법의 source-backed evidence로 사용할 수 있다. 등록일이
2021년인 화면은 2026년 live UI가 동일하다는 증거로 사용하지 않고, 현재 제공 기능은 공식 홈페이지와
별도로 대조한다.
