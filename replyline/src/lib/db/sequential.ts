/**
 * Run query thunks one after another. A transaction holds a single connection,
 * and pg does not allow overlapping queries on one connection, so Promise.all
 * over the same transaction is not allowed.
 */
export async function sequential<T extends readonly (() => Promise<unknown>)[]>(fns: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const fn of fns) out.push(await fn());
  return out as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
