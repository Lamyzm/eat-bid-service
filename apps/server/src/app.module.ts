import { Module } from "@nestjs/common";
import { EffectModule } from "./platform/effect/effect.module";

@Module({
  imports: [EffectModule],
})
export class AppModule {}
