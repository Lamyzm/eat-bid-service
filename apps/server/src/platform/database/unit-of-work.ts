const transactionHandleBrand: unique symbol = Symbol("TransactionHandle");
const transactionDatabases = new WeakMap<object, unknown>();

export interface TransactionHandle {
  readonly [transactionHandleBrand]: true;
}

export interface UnitOfWork {
  run<A>(work: (transaction: TransactionHandle) => Promise<A>): Promise<A>;
}

export interface TransactionDriver {
  transaction<A>(work: (transaction: unknown) => Promise<A>): Promise<A>;
}

function transactionHandle(database: unknown): TransactionHandle {
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
