import { ConsoleLogger, DynamicModule, Global, LoggerService, Module } from "@nestjs/common";
import type { Environment } from "../config/environment";

type LogRecord = Readonly<Record<string, unknown>>;
type Writer = (line: string) => void;

export interface CompletionFields {
  readonly requestId: string;
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly durationMs: number;
  readonly errorCode?: string;
}

export interface DefectFields {
  readonly requestId: string;
  readonly route: string;
  readonly error: unknown;
}

function redactSensitiveText(input: string): string {
  return input
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:Authorization|Cookie)\s*:\s*[^\s]+/gi, "$1: [REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b\d{3}-?\d{2}-?\d{5}\b/g, "[REDACTED_BUSINESS_ID]")
    .replace(/\?[^\s]*/g, "?[REDACTED_QUERY]")
    .replace(/\b(?:shareToken|requestBody|responseBody|body)\s*=\s*(?:\{[^}]*\}|[^\s]+)/gi, "$1=[REDACTED]");
}

export class RedactingJsonLogger implements LoggerService {
  readonly records: LogRecord[] = [];
  private readonly buildSha: string;
  private readonly write: Writer;
  private readonly frameworkLogger?: ConsoleLogger;

  constructor(options: { readonly buildSha: string; readonly write?: Writer }) {
    this.buildSha = options.buildSha;
    this.write = options.write ?? ((line) => process.stdout.write(line));
    this.frameworkLogger = options.write
      ? undefined
      : new ConsoleLogger("eatbid-server", { colors: false, json: true });
  }

  completion(fields: CompletionFields): void {
    this.emit("info", "request_completed", {
      requestId: fields.requestId,
      method: fields.method,
      route: fields.route,
      status: fields.status,
      durationMs: fields.durationMs,
      ...(fields.errorCode ? { errorCode: fields.errorCode } : {}),
    });
  }

  defect(fields: DefectFields): void {
    const errorName = fields.error instanceof Error ? fields.error.name : "UnknownError";
    const cause = fields.error instanceof Error
      ? redactSensitiveText(fields.error.stack ?? fields.error.message)
      : redactSensitiveText(String(fields.error));
    this.emit("error", "request_defect", {
      requestId: fields.requestId,
      route: fields.route,
      errorName,
      cause,
    });
  }

  shutdown(fields: { readonly forced: boolean; readonly inflight: number }): void {
    this.emit(fields.forced ? "error" : "info", "shutdown_completed", fields);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.framework("info", message, optionalParams);
  }
  error(message: unknown, ...optionalParams: unknown[]): void {
    this.framework("error", message, optionalParams);
  }
  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.framework("warn", message, optionalParams);
  }
  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.framework("debug", message, optionalParams);
  }
  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.framework("debug", message, optionalParams);
  }
  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.framework("fatal", message, optionalParams);
  }

  private framework(level: string, message: unknown, optionalParams: unknown[]): void {
    const context = optionalParams.find((value) => typeof value === "string");
    const safeMessage = redactSensitiveText(typeof message === "string" ? message : String(message));
    const safeContext = context ? redactSensitiveText(context) : undefined;
    if (this.frameworkLogger) {
      switch (level) {
        case "error": this.frameworkLogger.error(safeMessage, safeContext); return;
        case "warn": this.frameworkLogger.warn(safeMessage, safeContext); return;
        case "debug": this.frameworkLogger.debug(safeMessage, safeContext); return;
        case "fatal": this.frameworkLogger.fatal(safeMessage, safeContext); return;
        default: this.frameworkLogger.log(safeMessage, safeContext); return;
      }
    }
    this.emit(level, "nest", { message: safeMessage, ...(safeContext ? { context: safeContext } : {}) });
  }

  private emit(level: string, event: string, fields: Record<string, unknown>): void {
    const record = Object.freeze({
      timestamp: new Date().toISOString(),
      level,
      service: "eatbid-server",
      buildSha: this.buildSha,
      event,
      ...fields,
    });
    this.records.push(record);
    this.write(`${JSON.stringify(record)}\n`);
  }
}

@Global()
@Module({})
export class LoggingModule {
  static forLogger(logger: RedactingJsonLogger): DynamicModule {
    return {
      module: LoggingModule,
      providers: [{ provide: RedactingJsonLogger, useValue: logger }],
      exports: [RedactingJsonLogger],
    };
  }

  static create(environment: Environment, write?: Writer): RedactingJsonLogger {
    return new RedactingJsonLogger({ buildSha: environment.buildSha, write });
  }
}
