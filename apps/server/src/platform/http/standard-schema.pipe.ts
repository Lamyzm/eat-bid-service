import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";

export interface StandardSchema<TOutput = unknown> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<TOutput> | Promise<StandardResult<TOutput>>;
  };
}

type StandardIssue = { readonly message: string; readonly path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> };
type StandardResult<T> = { readonly value: T; readonly issues?: undefined }
  | { readonly value?: undefined; readonly issues: readonly StandardIssue[] };

@Injectable()
export class StandardSchemaPipe<TOutput = unknown> implements PipeTransform<unknown, Promise<TOutput>> {
  constructor(private readonly schema: StandardSchema<TOutput>) {}

  async transform(value: unknown): Promise<TOutput> {
    // 이 경계는 transport 모양만 검증하며 인증·인가나 도메인 판단을 대신하지 않는다.
    const result = await this.schema["~standard"].validate(value);
    if (result.issues !== undefined) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        issues: result.issues.map((issue) => ({ message: issue.message, path: issue.path ?? [] })),
      });
    }
    return result.value;
  }
}
