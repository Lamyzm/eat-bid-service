/**
 * @module 책임: 등록 사업자 목록 조회(listMyBusinesses) 하나만 재현하는 브라우저 검증 전용 fixture
 * 응답기다. 설정 화면이 첫 페인트에 목록을 갖는지 보려면 이 응답이 필요하다. 제품 코드는 import하지 않는다.
 */
import { meV1Operations, myBusinessesV1ResponseSchema } from '@eatbid/contracts/api/v1/me';

const operation = meV1Operations.listMyBusinesses;

// 합성 번호다. 실제 납품업체의 사업자등록번호를 쓰지 않는다. 연결·미관측 두 상태를 한 화면에서 본다.
const BUSINESSES = myBusinessesV1ResponseSchema.parse({
  businesses: [
    {
      businessId: '7',
      businessNumber: '9000000035',
      registeredAt: '2026-09-09T00:00:00Z',
      supplier: { kind: 'linked', supplierPartyId: '4101' },
      location: { addressText: '경상남도 창원시 의창구 중앙대로 151', updatedAt: '2026-09-09T00:00:00Z' }
    },
    {
      businessId: '8',
      businessNumber: '9000000049',
      registeredAt: '2026-09-09T00:10:00Z',
      supplier: { kind: 'unobserved' },
      location: null
    }
  ]
});

export function myBusinessesResponse(request: Request): Response | undefined {
  const { pathname } = new URL(request.url);
  if (pathname !== operation.openApiPath) return undefined;
  return Response.json(BUSINESSES);
}
