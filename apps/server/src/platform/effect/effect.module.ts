import { Global, Module } from "@nestjs/common";
import { EffectRunner } from "./effect-runner";

@Global()
@Module({
  providers: [EffectRunner],
  exports: [EffectRunner],
})
export class EffectModule {}
