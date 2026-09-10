/**
 * @module 책임: 로그 출력을 분류형 필드로만 좁혀 외부 문자열과 비밀값이 기록에 남지 않게 하고,
 * production 인스턴스가 그 기록을 보관하지 않아 요청마다 영구 객체가 쌓이지 않는 경계도 함께 소유한다.
 */
import { ConsoleLogger, DynamicModule, Global, LoggerService, Module } from "@nestjs/common";
import {
  formatInstantText,
  toMilliseconds,
  type Clock,
  type ElapsedMilliseconds,
} from "@eatbid/domain";
import type { Environment } from "../config/environment";

type LogRecord = Readonly<Record<string, unknown>>;
type Writer = (line: string) => void;

const safeErrorCodes = new Set([
  "EACCES",
  "EADDRINUSE",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPERM",
  "ETIMEDOUT",
]);

export interface SafeErrorRecord {
  /** 외부 문자열을 복사하지 않는 분류형 오류 표현이라 로그 주입과 비밀 유출을 함께 막는다. */
  readonly errorName: "Error" | "TypeError" | "SyntaxError" | "RangeError" | "URIError";
  readonly errorCode?: string;
  readonly stackFrames: readonly ("application" | "dependency" | "runtime")[];
  readonly causeClassification?: "error" | "non_error";
  readonly cause?: SafeErrorRecord;
}

export type SafeFailureEvent = "bootstrap_failed" | "shutdown_failed";

export interface CompletionFields {
  readonly requestId: string;
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly duration: ElapsedMilliseconds;
  readonly errorCode?: string;
}

export interface DefectFields {
  readonly requestId: string;
  readonly route: string;
  readonly error: unknown;
}

export interface RejectionFields {
  readonly requestId: string;
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly errorCode: string;
  /** 503처럼 원인이 있는 거부만 싣는다. 분류형으로만 남기므로 driver message나 토큰이 기록에 들어오지 않는다. */
  readonly error?: unknown;
}

function errorName(error: Error): SafeErrorRecord["errorName"] {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof URIError) return "URIError";
  return "Error";
}

function errorCode(error: Error): string | undefined {
  try {
    const code = (error as Error & { readonly code?: unknown }).code;
    return typeof code === "string" && safeErrorCodes.has(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

function stackFrameClassifications(error: Error): SafeErrorRecord["stackFrames"] {
  let stack: string | undefined;
  try {
    stack = error.stack;
  } catch {
    return [];
  }
  if (typeof stack !== "string" || stack.length === 0) return [];
  return Object.freeze(stack.split(/\r?\n/).slice(1, 9).map((frame) => {
    if (frame.includes("node:internal") || frame.includes("node:")) return "runtime";
    if (frame.includes("node_modules")) return "dependency";
    return "application";
  }));
}

export function serializeSafeError(error: unknown, depth = 0): SafeErrorRecord {
  // message, header, body, 원문 stack frame은 신뢰할 수 없어 이름·허용 코드·프레임 분류만 남긴다.
  if (!(error instanceof Error)) {
    return Object.freeze({ errorName: "Error", stackFrames: [] });
  }
  let cause: unknown;
  try {
    cause = error.cause;
  } catch {
    cause = undefined;
  }
  const causeClassification = cause === undefined
    ? undefined
    : cause instanceof Error ? "error" as const : "non_error" as const;
  const code = errorCode(error);
  return Object.freeze({
    errorName: errorName(error),
    ...(code ? { errorCode: code } : {}),
    stackFrames: stackFrameClassifications(error),
    ...(causeClassification ? { causeClassification } : {}),
    ...(cause instanceof Error && depth < 2 ? { cause: serializeSafeError(cause, depth + 1) } : {}),
  });
}

export function writeSafeFailure(
  event: SafeFailureEvent,
  error: unknown,
  clock: Clock,
  write: Writer = (line) => process.stderr.write(line),
): void {
  write(`${JSON.stringify({
    timestamp: formatInstantText(clock.now()),
    level: "error",
    service: "eatbid-server",
    event,
    ...serializeSafeError(error),
  })}\n`);
}

export class RedactingJsonLogger implements LoggerService {
  private readonly buildSha: string;
  private readonly clock: Clock;
  private readonly write: Writer;
  private readonly frameworkLogger?: ConsoleLogger;

  constructor(options: { readonly buildSha: string; readonly clock: Clock; readonly write?: Writer }) {
    this.buildSha = options.buildSha;
    this.clock = options.clock;
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
      durationMs: toMilliseconds(fields.duration),
      ...(fields.errorCode ? { errorCode: fields.errorCode } : {}),
    });
  }

  defect(fields: DefectFields): void {
    this.emit("error", "request_defect", {
      requestId: fields.requestId,
      route: fields.route,
      ...serializeSafeError(fields.error),
    });
  }

  /**
   * 완료 interceptor에 닿기 전에 끝난 요청(guard 거부)의 요약이다. 완료 로그와 같은 allowlist 필드만 남기고,
   * 시작 시각을 모르는 자리라 소요 시간은 싣지 않는다. 헤더·쿠키·원문 URL은 어떤 필드로도 들어오지 않는다.
   */
  rejection(fields: RejectionFields): void {
    this.emit("info", "request_rejected", {
      requestId: fields.requestId,
      method: fields.method,
      route: fields.route,
      status: fields.status,
      errorCode: fields.errorCode,
      ...(fields.error === undefined ? {} : serializeSafeError(fields.error)),
    });
  }

  lifecycle(event: "application_ready" | "auth_disabled"): void {
    this.emit("info", event, {});
  }

  /**
   * 인증 provider의 진단을 고정 event와 안전한 오류 분류로만 남긴다.
   *
   * provider 원문을 그대로 쓰지 않는 이유: 설치본은 세션 저장 실패를 `logger.error(message, error)`로
   * 넘기고 그 error가 driver 예외이면 message와 params에 세션 토큰이 그대로 들어 있다. 문자열을 복사하는
   * 순간 로그가 그 토큰을 보관한다.
   */
  provider(fields: { readonly level: string; readonly error: unknown }): void {
    this.emit(fields.level === "debug" ? "debug" : fields.level, "auth_provider", {
      ...(fields.error === undefined ? {} : serializeSafeError(fields.error)),
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

  private framework(level: string, message: unknown, _optionalParams: unknown[]): void {
    const messageClassification = message instanceof Error ? "error" : typeof message;
    if (this.frameworkLogger) {
      switch (level) {
        case "error": this.frameworkLogger.error("framework_event", "Nest"); return;
        case "warn": this.frameworkLogger.warn("framework_event", "Nest"); return;
        case "debug": this.frameworkLogger.debug("framework_event", "Nest"); return;
        case "fatal": this.frameworkLogger.fatal("framework_event", "Nest"); return;
        default: this.frameworkLogger.log("framework_event", "Nest"); return;
      }
    }
    this.emit(level, "nest", { messageClassification });
  }

  private emit(level: string, event: string, fields: Record<string, unknown>): void {
    const record = Object.freeze({
      timestamp: formatInstantText(this.clock.now()),
      level,
      service: "eatbid-server",
      buildSha: this.buildSha,
      event,
      ...fields,
    });
    this.write(`${JSON.stringify(record)}\n`);
    this.retain(record);
  }

  /**
   * 기본은 아무 것도 하지 않는다. 이 클래스는 process당 한 번 만들어져 수명 내내 사는 production
   * singleton이고 EAT-149 이후 guard 거부까지 매 emit을 거치므로, 여기서 보관하면 인증 없는 요청
   * 하나하나가 영구 객체 하나를 만든다. 관측이 필요한 test runtime은 아래 RecordingJsonLogger로만 받는다(EAT-157).
   */
  protected retain(_record: LogRecord): void {}
}

/**
 * write 부작용 없이 로그 내용을 assert해야 하는 테스트 전용 관측 하위 클래스다. RedactingJsonLogger
 * 자체에는 records 필드가 없어 production·dev-login-seed 같은 CLI 경로는 이 클래스를 만들 수단이 없고,
 * LoggingModule.createForTest와 다섯 테스트 파일의 직접 생성 지점만 이 클래스를 쓴다(EAT-157).
 */
export class RecordingJsonLogger extends RedactingJsonLogger {
  readonly records: LogRecord[] = [];

  protected override retain(record: LogRecord): void {
    this.records.push(record);
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

  static create(environment: Environment, clock: Clock, write?: Writer): RedactingJsonLogger {
    return new RedactingJsonLogger({ buildSha: environment.buildSha, clock, write });
  }

  /**
   * create-app.ts의 test runtime 분기만 부른다. dev-login-seed.ts 같은 CLI는 NODE_ENV가 test여도
   * 위 create()를 그대로 쓰므로 이 factory를 부르는 것 자체가 관측 의도의 표시다(EAT-157).
   */
  static createForTest(environment: Environment, clock: Clock, write?: Writer): RecordingJsonLogger {
    return new RecordingJsonLogger({ buildSha: environment.buildSha, clock, write });
  }
}
