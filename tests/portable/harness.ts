export type Test = { name: string; run: () => void | Promise<void> };
export const cases: Test[] = [];
export function test(name: string, run: Test['run']): void {
  cases.push({ name, run });
}
export function assert(
  value: unknown,
  message = 'Assertion failed',
): asserts value {
  if (!value) throw new Error(message);
}
export function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
}
export async function rejects(
  action: () => unknown | Promise<unknown>,
  name: string,
): Promise<Error> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error, 'Expected an Error instance.');
    equal(error.name, name);
    return error;
  }
  throw new Error(`Expected ${name} rejection.`);
}
export function fakeClock(start = 1000) {
  let now = start;
  const delays: number[] = [];
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
      now += ms;
    },
  };
}
