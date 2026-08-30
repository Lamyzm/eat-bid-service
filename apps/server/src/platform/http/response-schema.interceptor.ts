import {
  CallHandler,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  NestInterceptor,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { mergeMap, Observable } from "rxjs";
import type { StandardSchema } from "./standard-schema.pipe";

const responseSchemaKey = "eatbid:response-schema";

export const ResponseSchema = (schema: StandardSchema): MethodDecorator => SetMetadata(responseSchemaKey, schema);

export async function validateResponse<T>(value: unknown, schema: StandardSchema<T>): Promise<T> {
  const result = await schema["~standard"].validate(value);
  if (result.issues !== undefined) {
    throw new InternalServerErrorException({ code: "RESPONSE_SCHEMA_VIOLATION" });
  }
  return result.value;
}

@Injectable()
export class ResponseSchemaInterceptor implements NestInterceptor {
  constructor(private readonly reflector = new Reflector()) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.getAllAndOverride<StandardSchema | undefined>(responseSchemaKey, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!schema) return next.handle();
    return next.handle().pipe(mergeMap((value) => validateResponse(value, schema)));
  }
}
