import {
  problemDetailsSchema,
  type OperationBodyInput,
  type OperationPathInput,
  type OperationQueryInput,
  type OperationSuccess,
  type PublicHttpOperation
} from '@eatbid/contracts/api';
import { parseApiOrigin } from './api-origin';
import { ContractResponseError, HttpProblemError, HttpStatusError } from './http-problem';

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface ContractRequest {
  <Operation extends PublicHttpOperation>(input: {
    operation: Operation;
    path: OperationPathInput<Operation>;
    query?: OperationQueryInput<Operation>;
    body?: OperationBodyInput<Operation>;
    signal?: AbortSignal;
  }): Promise<OperationSuccess<Operation>>;
  readonly isProblem: (error: unknown) => error is HttpProblemError;
}

export interface ContractRequestOptions {
  readonly fetch: FetchImplementation;
  readonly resolveOrigin?: () => string | undefined;
}

const safeRequestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

function safeRequestId(response: Response): string | undefined {
  const value = response.headers.get('x-request-id');
  return value && safeRequestIdPattern.test(value) ? value : undefined;
}

async function jsonBody(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false };
  }
}

function requestTarget(relativePath: string, resolveOrigin?: () => string | undefined): string {
  const rawOrigin = resolveOrigin?.();
  if (rawOrigin === undefined) return relativePath;
  const origin = parseApiOrigin(rawOrigin);
  return new URL(relativePath, `${origin}/`).toString();
}

function requestBody(operation: PublicHttpOperation, body: unknown): BodyInit | undefined {
  const parsed = operation.bodySchema.parse(body);
  return parsed === undefined ? undefined : JSON.stringify(parsed);
}

async function parseSuccess<Operation extends PublicHttpOperation>(
  operation: Operation,
  response: Response
): Promise<OperationSuccess<Operation>> {
  const contract = operation.successResponses[response.status];
  if (!contract) throw new ContractResponseError(operation.operationId, response.status);
  const decoded =
    response.status === 204 ? { ok: true as const, value: undefined } : await jsonBody(response);
  if (!decoded.ok) throw new ContractResponseError(operation.operationId, response.status);
  const parsed = contract.schema.safeParse(decoded.value);
  if (!parsed.success) {
    throw new ContractResponseError(operation.operationId, response.status, {
      cause: parsed.error
    });
  }
  return parsed.data as OperationSuccess<Operation>;
}

async function parseFailure(operation: PublicHttpOperation, response: Response): Promise<never> {
  const decoded = await jsonBody(response);
  const statusContract = operation.problemResponses[response.status];
  if (decoded.ok && statusContract) {
    const common = problemDetailsSchema.safeParse(decoded.value);
    const specific = statusContract.schema.safeParse(decoded.value);
    if (common.success && specific.success && common.data.status === response.status) {
      throw new HttpProblemError(common.data);
    }
  }
  throw new HttpStatusError(response.status, safeRequestId(response));
}

export function createContractRequest(options: ContractRequestOptions): ContractRequest {
  return Object.assign(
    async <Operation extends PublicHttpOperation>(input: {
      operation: Operation;
      path: OperationPathInput<Operation>;
      query?: OperationQueryInput<Operation>;
      body?: OperationBodyInput<Operation>;
      signal?: AbortSignal;
    }): Promise<OperationSuccess<Operation>> => {
      const relativePath = input.operation.buildPath({ path: input.path, query: input.query });
      const body = requestBody(input.operation, input.body);
      const response = await options.fetch(requestTarget(relativePath, options.resolveOrigin), {
        method: input.operation.method.toUpperCase(),
        headers:
          body === undefined
            ? { accept: 'application/json, application/problem+json' }
            : {
                accept: 'application/json, application/problem+json',
                'content-type': 'application/json'
              },
        body,
        signal: input.signal
      });
      return response.ok
        ? parseSuccess(input.operation, response)
        : parseFailure(input.operation, response);
    },
    {
      isProblem: (error: unknown): error is HttpProblemError => error instanceof HttpProblemError
    }
  );
}
