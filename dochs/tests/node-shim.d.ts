// Minimal typings for the Node built-ins used by the tests (avoids an @types/node dependency).
declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function describe(name: string, fn: () => void): void;
}
declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal(a: unknown, b: unknown, message?: string): void;
    notEqual(a: unknown, b: unknown, message?: string): void;
    deepEqual(a: unknown, b: unknown, message?: string): void;
    match(s: string, re: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | string): void;
  }
  const assert: Assert;
  export default assert;
}
declare module 'node:fs' {
  export function writeFileSync(p: string, data: string | Uint8Array): void;
  export function readFileSync(p: string, enc: string): string;
  export function existsSync(p: string): boolean;
  export function mkdirSync(p: string, o?: { recursive?: boolean }): void;
}
declare module 'node:child_process' {
  export function execFileSync(cmd: string, args: string[], o?: { encoding?: string }): string;
}
declare module 'node:zlib' {
  export function deflateRawSync(data: Uint8Array): Uint8Array;
}
