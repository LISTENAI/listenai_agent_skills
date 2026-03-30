declare module "vitest" {
  export interface TypeExpectation<T = unknown> {
    toMatchTypeOf<U>(): void;
  }

  type Hook = (...args: any[]) => any;
  type TestCase<T = unknown> = (value: T) => unknown;
  type Each = <T>(cases: readonly T[]) => (
    name: string,
    fn: TestCase<T>,
    timeout?: number
  ) => unknown;

  export const describe: (...args: any[]) => any;
  export const expect: any;
  export const expectTypeOf: <T = unknown>(value?: T) => TypeExpectation<T>;
  export const beforeEach: Hook;
  export const afterEach: Hook;
  export const beforeAll: Hook;
  export const afterAll: Hook;
  export const vi: any;
  export const it: ((...args: any[]) => any) & { each: Each };
  export const test: ((...args: any[]) => any) & { each: Each };
}
