const transactionHandleBrand: unique symbol = Symbol("TransactionHandle");
const transactionDatabases = new WeakMap<object, unknown>();

export interface TransactionHandle {
  readonly [transactionHandleBrand]: true;
}

export interface UnitOfWork {
  /** 콜백에 전달된 handle을 써야만 같은 물리 트랜잭션에 참여할 수 있다. */
  run<A>(work: (transaction: TransactionHandle) => Promise<A>): Promise<A>;
}

export interface TransactionDriver {
  transaction<A>(work: (transaction: unknown) => Promise<A>): Promise<A>;
}

function transactionHandle(database: unknown): TransactionHandle {
  // WeakMap에 등록된 위조 불가능 handle로 명시적 전파를 강제하고 숨은 ALS 트랜잭션을 만들지 않는다.
  const handle = Object.freeze({ [transactionHandleBrand]: true }) as TransactionHandle;
  transactionDatabases.set(handle, database);
  return handle;
}

export function transactionDatabase(handle: unknown): unknown {
  if (typeof handle !== "object" || handle === null || !transactionDatabases.has(handle)) {
    throw new TypeError("Transaction handle was not created by UnitOfWork");
  }
  return transactionDatabases.get(handle);
}

export function createUnitOfWork(driver: TransactionDriver): UnitOfWork {
  return {
    run: <A>(work: (transaction: TransactionHandle) => Promise<A>) => driver.transaction(
      (database) => work(transactionHandle(database)),
    ),
  };
}
