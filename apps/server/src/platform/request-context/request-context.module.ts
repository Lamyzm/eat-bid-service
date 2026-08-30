import { AsyncLocalStorage } from "node:async_hooks";
import { DynamicModule, Global, Module } from "@nestjs/common";

export interface RequestContext {
  readonly requestId: string;
}

export class RequestContextStore {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  current(): RequestContext | undefined {
    return this.storage.getStore();
  }
}

@Global()
@Module({})
export class RequestContextModule {
  static forStore(store: RequestContextStore): DynamicModule {
    return {
      module: RequestContextModule,
      providers: [{ provide: RequestContextStore, useValue: store }],
      exports: [RequestContextStore],
    };
  }
}
