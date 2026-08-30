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
