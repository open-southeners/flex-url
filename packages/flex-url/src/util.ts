/* eslint-disable @typescript-eslint/unified-signatures */
export type ObjectKey = string | number | symbol;
export type Primitive = string | number | boolean | symbol | bigint;
export type PrimitivesObject<K extends ObjectKey = ObjectKey> = Record<K, Primitive>;
export type AnyPrimitive<K extends ObjectKey = ObjectKey> = Primitive | PrimitivesObject<K>;

export function getAllIndexes<T = AnyPrimitive>(array: T[], value: T): number[];
export function getAllIndexes<T = AnyPrimitive>(array: T[], value: (item: T) => boolean): number[];
export function getAllIndexes<T = AnyPrimitive>(array: T[], value: T) {
  const indexes: number[] = [];
  let i = -1;

  for (i = 0; i < array.length; i++) {
    if (typeof value === 'function' ? value(array[i]) : value) {
      indexes.push(i);
    }
  }

  return indexes;
}

export function setValueFromIndexes<T = AnyPrimitive>(array: T[], indexes: number[], value: T): void;
export function setValueFromIndexes<T = AnyPrimitive>(array: T[], indexes: number[], value: (item: T) => T): void;
export function setValueFromIndexes<T = AnyPrimitive>(array: T[], indexes: number[], value: T) {
  let i = -1;

  for (i = 0; i < array.length; i++) {
    if (indexes.includes(i)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      array[i] = typeof value === 'function' ? value(array[i]) : value;
    }
  }
}

/**
 * `decodeURIComponent` that never throws.
 *
 * A query string is user input, so it routinely contains a `%` that isn't a
 * valid escape — a literal percentage (`?discount=20%`), a word (`?q=50%off`),
 * or a latin-1 byte from a legacy system. `decodeURIComponent` throws
 * `URIError: URI malformed` on all of those, and because parsing happens in
 * the `FlexibleUrl` constructor, one bad character took down the whole URL
 * rather than just that parameter.
 *
 * Decoding is all-or-nothing, so a fragment containing one bad escape is
 * returned undecoded rather than partly decoded. That keeps the change to the
 * smallest thing that removes the crash: every input that decoded before
 * still decodes identically, and inputs that used to throw now yield their
 * raw text. Re-serialising such a value escapes the `%` (`20%` -> `20%25`),
 * so it round-trips stably from then on.
 */
export function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
