import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ZodValidationPipe());
  app.enableCors();
  const port = Number(process.env.PORT ?? 4400);
  await app.listen(port, "0.0.0.0");
  console.log(`eatbid server on :${port}`);
}
bootstrap();
