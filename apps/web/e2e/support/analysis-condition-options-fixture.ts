/** @module 책임: 분석 조건 사전 조회(findAnalysisConditionOptions) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다. */
import {
  analysisV1Operations,
  analysisConditionOptionsV1ResponseSchema
} from '@eatbid/contracts/api/v1/analysis';
import { AUCTION_ITEM_ATOMS } from '@eatbid/contracts/api/v1/auctions';

const operation = analysisV1Operations.findConditionOptions;

/** 시도 셋이면 2단 목록이 실제로 갈라지는지 보인다. 경남은 시군구를 가진 쪽이다. */
const SIDO = [
  { codeValueId: '41', code: '48', label: '경상남도', count: 7_885 },
  { codeValueId: '42', code: '11', label: '서울특별시', count: 9_417 },
  { codeValueId: '44', code: '41', label: '경기도', count: 14_302 },
  // 이 조건에 회차가 없는 시도다. 사전에 있으면 목록에 남아야 한다.
  { codeValueId: '48', code: '50', label: '제주특별자치도', count: 0 }
];

/** 0건인 시군구를 섞어 둔다. 사전 전체를 세우되 건수로 말한다는 규칙이 화면에서 지켜지는지 본다. */
const SIGUNGU: Record<string, ReadonlyArray<{ codeValueId: string; code: string; label: string; count: number }>> = {
  '41': [
    { codeValueId: '43', code: '48120', label: '창원시', count: 912 },
    { codeValueId: '45', code: '48250', label: '김해시', count: 486 },
    { codeValueId: '46', code: '48170', label: '진주시', count: 331 },
    { codeValueId: '47', code: '48220', label: '통영시', count: 0 }
  ]
};

const ORGANIZATIONS = [
  { organizationId: '3101', name: '창원 남산초등학교', count: 24 },
  { organizationId: '3102', name: '김해삼계초등학교', count: 19 },
  { organizationId: '3103', name: '장유초등학교', count: 12 },
  { organizationId: '3104', name: '내동중학교', count: 8 }
];

function regionReference(entry: { codeValueId: string; code: string; label: string }, scheme: string) {
  return { codeValueId: entry.codeValueId, code: entry.code, scheme, label: entry.label };
}

export function analysisConditionOptionsResponse(request: Request): Response | undefined {
  const { pathname, searchParams } = new URL(request.url);
  if (pathname !== operation.openApiPath) return undefined;

  const sido = searchParams.get('sido');
  const search = searchParams.get('organizationQuery');
  const scope = searchParams.get('comparisonScope') === 'region'
    ? searchParams.get('comparisonRegionCodeValueId')
    : null;
  const selectedSido = SIDO.find((entry) => entry.codeValueId === scope);
  const selectedSigungu = Object.entries(SIGUNGU)
    .flatMap(([parent, entries]) => entries.map((entry) => ({ parent, entry })))
    .find(({ entry }) => entry.codeValueId === scope);
  const organizations = ORGANIZATIONS.filter(
    (option) => search === null || option.name.includes(search)
  );

  return Response.json(analysisConditionOptionsV1ResponseSchema.parse({
    selectedRegion: selectedSido
      ? { region: regionReference(selectedSido, 'eat:auction-location-sido'), parentSidoCodeValueId: null }
      : selectedSigungu
        ? {
            region: regionReference(selectedSigungu.entry, 'eat:auction-location-sigungu'),
            parentSidoCodeValueId: selectedSigungu.parent
          }
        : null,
    sidoCounts: SIDO.map((entry) => ({
      region: regionReference(entry, 'eat:auction-location-sido'),
      count: entry.count
    })),
    sigunguCounts: (sido === null ? [] : SIGUNGU[sido] ?? []).map((entry) => ({
      region: regionReference(entry, 'eat:auction-location-sigungu'),
      count: entry.count
    })),
    regionUnobservedCount: 12,
    // 원자 여덟을 전부 싣고 0도 싣는다. 0이 사라지면 그 품목이 조건에 없는지 어휘에 없는지 알 수 없다.
    itemCounts: AUCTION_ITEM_ATOMS.map((item, index) => ({ item, count: index === 0 ? 37 : index * 3 })),
    itemUnknownCount: 5,
    organizations: organizations.map((option) => ({
      organizationId: option.organizationId,
      name: option.name,
      region: regionReference(
        { codeValueId: '45', code: '48250', label: '김해시' },
        'eat:auction-location-sigungu'
      ),
      count: option.count
    })),
    organizationsTruncated: false,
    meta: {
      observationBuild: {
        buildId: '701',
        sourceReleaseId: '0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f',
        calcVersion: 'mart-r10',
        computedAt: '2026-09-18T00:10:00Z',
        coverage: 'unknown',
        regionScheme: 'eat:auction-location-sido'
      }
    }
  }));
}
