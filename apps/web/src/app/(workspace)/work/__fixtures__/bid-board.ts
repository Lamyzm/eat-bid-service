// 넣을 공고 표시 테스트와 브라우저 검증이 함께 쓰는 응답 표본이다. 공고(학교·마감·공고번호)는 시안 D가 쓴 2026-10-21(수)
// 저녁 7시 김해 육류 실제 목록이고, 기준 시각도 그때(KST 19:00)다. 88% 공고 넷의 규칙 칸은 서버 `positionBids`가 같은 입력
// (기초금액·하한율·참여 수·관측 시각·마감)으로 낸 값과 같아야 하며 `rule-parity.test.ts`가 그것을 확인한다. 90% 값은 10월
// 배수(0.9849·0.9890, 예비 0.9838·0.9860·0.9871)에서 나온 기초금액 대비 %다. 기초금액은 화면에 보이지 않는 표본 값이다.
import type { BidBoardRowWire, MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';
import { Temporal } from '@eatbid/domain';

const money = (amount: string) => ({ amount: `${amount}.00`, currency: 'KRW' as const });
const rate = (value: string) => ({ value, unit: 'percentage-points' as const });

/** 2026년 10월의 KST 날짜·시각을 instant 글자로 바꾼다. */
function kst(day: string, time: string): string {
  return Temporal.PlainDateTime.from(`2026-10-${day}T${time}`)
    .toZonedDateTime('Asia/Seoul')
    .toInstant()
    .toString();
}

/** 기초금액 × 기초금액 대비 % 를 원 단위로 내린다. 금액은 이 화면에 보이지 않아 표본의 모양만 맞춘다. */
function amountOf(base: string, baseRelative: string): string {
  const units = BigInt(baseRelative.replace('.', ''));
  return ((BigInt(base) * units) / BigInt(1_000_000)).toString();
}

const MARKET_90 = ['88.6410', '89.0100'] as const;
const MARKET_SPARES = ['88.5420', '88.7400', '88.8390'] as const;

function market90(base: string) {
  const position = (order: number, baseRelative: string) => ({
    order,
    amount: money(amountOf(base, baseRelative)),
    baseRelativeRate: rate(baseRelative)
  });
  return {
    state: 'applicable' as const,
    positions: MARKET_90.map((value, index) => position(index + 1, value)),
    single: position(1, MARKET_90[0]),
    spares: MARKET_SPARES.map((value, index) => position(index + 3, value))
  };
}

const OBSERVED_AT = '2026-10-21T09:40:00Z';

function row(
  overrides: Partial<BidBoardRowWire> & Pick<BidBoardRowWire, 'auctionId'>
): BidBoardRowWire {
  return {
    closesAt: kst('22', '10:00'),
    organizationLabel: null,
    title: null,
    itemLabel: '육류',
    displayBidNo: null,
    baseAmount: null,
    floorRate: rate('90.000'),
    bidCount: null,
    observedAt: OBSERVED_AT,
    rule: null,
    market: null,
    ...overrides
  };
}

/** 하한 90% 공고 한 줄이다. 기초금액은 공고마다 조금씩 달리 둔다. */
function notice90(
  id: number,
  day: string,
  time: string,
  school: string,
  bidNo: string
): BidBoardRowWire {
  const base = String(9_000_000 + (id % 37) * 211_300);
  return row({
    auctionId: String(2_810_000 + id),
    closesAt: kst(day, time),
    organizationLabel: school,
    displayBidNo: bidNo,
    baseAmount: money(base),
    bidCount: 20 + (id % 50),
    market: market90(base)
  });
}

/** 마감 1시간 전 참여 수로 보정한 대역(70곳 이상)의 세 자리다. 서버 규칙 2026-10-10판과 같은 값이다. */
function rule88(
  observedBidCount: number,
  hoursBeforeDeadline: number,
  estimatedBidCount: number,
  amounts: readonly [string, string, string]
) {
  const win = [
    ['1.498127', '0.869949', 60],
    ['2.571785', '1.723290', 103],
    ['3.295880', '2.560529', 132]
  ] as const;
  const relative = ['86.7240', '87.1640', '87.5160'] as const;
  return {
    state: 'applicable' as const,
    band: { minBidCount: 70, maxBidCount: null },
    bidCountBasis: {
      kind: 'estimated' as const,
      observedBidCount,
      hoursBeforeDeadline,
      estimatedBidCount
    },
    evidence: 'clear' as const,
    selection: 'training' as const,
    validationRounds: 4005,
    holdout: { month: '2026-09', rounds: 1507, tickets: 2, wins: 31, lotteryExpectedWins: '19.7' },
    positions: amounts.map((amount, index) => ({
      order: index + 1,
      amount: money(amount),
      baseRelativeRate: rate(relative[index]!),
      cumulativeWinRate: rate(win[index]![0]),
      cumulativeLotteryWinRate: rate(win[index]![1]),
      cumulativeValidationWins: win[index]![2]
    }))
  };
}

function notice88(
  id: number,
  day: string,
  school: string,
  bidNo: string,
  input: { readonly base: string; readonly bidCount: number },
  rule: BidBoardRowWire['rule']
): BidBoardRowWire {
  return row({
    auctionId: String(2_810_000 + id),
    closesAt: kst(day, '10:00'),
    organizationLabel: school,
    displayBidNo: bidNo,
    baseAmount: money(input.base),
    floorRate: rate('88.000'),
    bidCount: input.bidCount,
    rule,
    market: { state: 'not-applicable', reasons: ['floor-rate-outside-market-pick'] }
  });
}

export const boardRows = {
  janggyuHigh88: notice88(
    13,
    '22',
    '장유고등학교',
    'E261015-677715-0',
    { base: '21345000', bidCount: 48 },
    rule88(48, 15, 79, ['18511238', '18605156', '18680291'])
  ),
  tongyeongJampo88: notice88(
    14,
    '22',
    '통영잠포학교',
    'E261016-679180-0',
    { base: '9876540', bidCount: 50 },
    rule88(50, 15, 82, ['8565331', '8608788', '8643553'])
  ),
  gimhaeSunamHigh88: notice88(
    15,
    '22',
    '김해수남고등학교',
    'E261016-679285-0',
    { base: '16420300', bidCount: 46 },
    rule88(46, 15, 75, ['14240341', '14312591', '14370390'])
  ),
  bunseongMiddle88: notice88(
    24,
    '23',
    '분성중학교',
    'E261019-681379-0',
    { base: '12004600', bidCount: 31 },
    rule88(31, 39, 73, ['10410870', '10463690', '10505946'])
  )
} as const;

const NOTICES_90: readonly (readonly [string, string, string, string])[] = [
  ['22', '08:00', '김해삼성초등학교', 'E261015-678192-0'],
  ['22', '09:00', '신문초등학교', 'E261015-678312-0'],
  ['22', '09:00', '진영장등중학교', 'E261016-680283-0'],
  ['22', '09:00', '한얼중학교', 'E261015-677812-0'],
  ['22', '09:00', '김해중앙여자고등학교', 'E261016-680433-0'],
  ['22', '10:00', '김해은혜학교', 'E261015-677917-0'],
  ['22', '10:00', '가야중학교', 'E261014-675559-0'],
  ['22', '10:00', '김해임호고등학교', 'E261014-676437-0'],
  ['22', '10:00', '석봉초등학교', 'E261014-675814-0'],
  ['22', '10:00', '장유중학교', 'E261015-677211-0'],
  ['22', '10:00', '대청초등학교', 'E261015-677224-0'],
  ['22', '10:00', '임호초등학교', 'E261015-677691-0'],
  ['22', '10:00', '어방초등학교', 'E261016-679769-0'],
  ['22', '10:00', '김해동광초등학교', 'E261016-680916-0'],
  ['22', '10:10', '진영금병초등학교', 'E261014-676091-0'],
  ['22', '14:10', '월산중학교', 'E261014-676263-0'],
  ['23', '09:00', '구산고등학교', 'E261015-678454-0'],
  ['23', '09:00', '능동중학교', 'E261015-678105-0'],
  ['23', '09:00', '진영고등학교', 'E261019-681634-0'],
  ['23', '10:00', '김해제일고등학교', 'E261016-680537-0'],
  ['23', '10:00', '삼문초등학교', 'E261019-681787-0'],
  ['23', '10:00', '활천중학교', 'E261019-681971-0'],
  ['23', '10:00', '봉명초등학교', 'E261019-682726-0'],
  ['23', '10:00', '김해생명과학고등학교', 'E261019-684100-0'],
  ['23', '10:00', '영운초등학교', 'E261015-677459-0'],
  ['23', '10:00', '김해모산중학교', 'E261016-678797-0'],
  ['23', '10:00', '관동중학교', 'E261016-680139-0'],
  ['23', '10:00', '김해구지초등학교', 'E261016-679893-0'],
  ['23', '10:00', '임호중학교', 'E261016-678850-0'],
  ['23', '10:00', '수남중학교', 'E261019-684406-0'],
  ['23', '15:00', '김해외국어고등학교', 'E261019-682859-0'],
  ['26', '08:00', '진영중앙초등학교', 'E261019-683938-0'],
  ['26', '08:30', '김해경원고등학교', 'E261020-685029-0'],
  ['26', '09:00', '김해한일여자고등학교', 'E261020-686281-0'],
  ['26', '09:00', '김해삼문고등학교', 'E261020-686273-0'],
  ['26', '09:00', '김해가야고등학교', 'E261020-685859-0'],
  ['26', '09:00', '김해신명초등학교', 'E261020-685288-0'],
  ['26', '10:00', '김해영운고등학교', 'E261020-685226-0'],
  ['26', '10:00', '신어중학교', 'E261020-685582-0'],
  ['26', '10:00', '영운중학교', 'E261019-684004-0'],
  ['26', '10:00', '김해분성고등학교', 'E261020-686534-0'],
  ['26', '10:00', '장유초등학교', 'E261019-683771-0'],
  ['26', '10:00', '김해신안초등학교', 'E261020-686958-0'],
  ['26', '10:00', '경운초등학교', 'E261016-680781-0'],
  ['26', '10:00', '분성초등학교', 'E261019-682138-0'],
  ['26', '10:00', '김해대청고등학교', 'E261019-682717-0'],
  ['26', '10:00', '김해합성초등학교', 'E261019-683065-0'],
  ['26', '10:00', '관동초등학교', 'E261019-684613-0'],
  ['27', '10:00', '김해분성여자고등학교', 'E261020-687345-0'],
  ['27', '10:00', '충렬여자고등학교', 'E261021-688706-0'],
  ['28', '10:00', '김해대곡중학교', 'E261022-689263-0']
];

export const notices90: readonly BidBoardRowWire[] = NOTICES_90.map(
  ([day, time, school, bidNo], index) => notice90(100 + index, day, time, school, bidNo)
);

export const marketPickHead: Extract<
  MyBidBoardV1Response,
  { regionPreference: 'confirmed' }
>['marketPick'] = {
  version: '2026-10-10',
  windowMonths: 3,
  minimumRounds: 70,
  window: { fromMonth: '2026-07', throughMonth: '2026-09' },
  state: 'picked',
  reasons: [],
  marketRounds: 164,
  linkedBusinesses: 2,
  evidence: [
    {
      from: '2024-04',
      through: '2024-12',
      rounds: 634,
      expectedWins: '32.7',
      ruleExpectedWins: '27.6',
      currentExpectedWins: '21.7',
      lotteryExpectedWins: '25.7'
    },
    {
      from: '2025-01',
      through: '2025-12',
      rounds: 681,
      expectedWins: '39.6',
      ruleExpectedWins: '34.7',
      currentExpectedWins: '22.4',
      lotteryExpectedWins: '26.6'
    },
    {
      from: '2026-01',
      through: '2026-08',
      rounds: 450,
      expectedWins: '19.3',
      ruleExpectedWins: '17.2',
      currentExpectedWins: '12.0',
      lotteryExpectedWins: '14.2'
    },
    {
      from: '2026-09',
      through: '2026-09',
      rounds: 73,
      expectedWins: '3.4',
      ruleExpectedWins: '2.4',
      currentExpectedWins: '1.8',
      lotteryExpectedWins: '2.2'
    }
  ]
};

export const board: MyBidBoardV1Response = {
  regionPreference: 'confirmed',
  asOf: '2026-10-21T10:00:00Z',
  closesBeforeDate: '2026-11-20',
  truncated: false,
  rule: {
    version: '2026-10-10',
    trainedThrough: '2025-12',
    validatedFrom: '2026-01',
    validatedThrough: '2026-08'
  },
  marketPick: marketPickHead,
  rows: [...Object.values(boardRows), ...notices90]
};

/** 오늘 마감이지만 아직 열린 공고다. 화면은 오늘을 빼므로 목록에 나오지 않아야 한다. */
export const todayOpenRow: BidBoardRowWire = notice90(
  900,
  '21',
  '22:00',
  '오늘마감초등학교',
  'E261021-000001-0'
);

export { kst };
