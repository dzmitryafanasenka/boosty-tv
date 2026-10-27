/** Test-only async helpers. */

/** A promise the test settles by hand. */
export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise continuations run (a fixed number of microtask turns). */
export async function flush() {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}
