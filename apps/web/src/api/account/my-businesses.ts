/** @module 책임: 등록 사업자 조회·등록과 사업장 위치 저장·삭제를 계약대로 수행하는 transport 독립 함수를 소유한다. */
import {
  meV1Operations,
  type MyBusinessesV1Response,
  type MyBusinessV1Response
} from '@eatbid/contracts/api/v1/me';

import type { ContractRequest } from '../_transport/request-contract';
import { mapAccountResourceError } from './account-resource-error';

export async function listMyBusinessesWith(
  request: ContractRequest,
  input: { readonly signal?: AbortSignal } = {}
): Promise<MyBusinessesV1Response> {
  try {
    return await request({
      operation: meV1Operations.listMyBusinesses,
      path: undefined,
      signal: input.signal
    });
  } catch (error) {
    throw mapAccountResourceError(request, error);
  }
}

/**
 * 사용자가 적은 표기를 계약 schema가 canonical 숫자로 정규화한다. 화면이 자체 정규화를 하면 서버가 받는
 * 값과 화면이 검증한 값이 갈라지므로 정규화 권위를 계약 하나로 둔다(ADR 0032 §7).
 */
export async function registerMyBusinessWith(
  request: ContractRequest,
  input: { readonly businessNumber: string; readonly signal?: AbortSignal }
): Promise<MyBusinessV1Response> {
  try {
    return await request({
      operation: meV1Operations.registerMyBusiness,
      path: undefined,
      body: { businessNumber: input.businessNumber },
      signal: input.signal
    });
  } catch (error) {
    throw mapAccountResourceError(request, error);
  }
}

export async function setMyBusinessLocationWith(
  request: ContractRequest,
  input: {
    readonly businessId: string;
    readonly addressText: string;
    readonly signal?: AbortSignal;
  }
): Promise<MyBusinessV1Response> {
  const path = meV1Operations.setMyBusinessLocation.pathSchema.parse({
    businessId: input.businessId
  });
  try {
    return await request({
      operation: meV1Operations.setMyBusinessLocation,
      path,
      body: { addressText: input.addressText },
      signal: input.signal
    });
  } catch (error) {
    throw mapAccountResourceError(request, error);
  }
}

/** 위치 미설정은 빈 문자열 저장이 아니라 값이 없는 상태다. 그래서 지우기는 별도 command다. */
export async function clearMyBusinessLocationWith(
  request: ContractRequest,
  input: { readonly businessId: string; readonly signal?: AbortSignal }
): Promise<MyBusinessV1Response> {
  const path = meV1Operations.clearMyBusinessLocation.pathSchema.parse({
    businessId: input.businessId
  });
  try {
    return await request({
      operation: meV1Operations.clearMyBusinessLocation,
      path,
      signal: input.signal
    });
  } catch (error) {
    throw mapAccountResourceError(request, error);
  }
}
