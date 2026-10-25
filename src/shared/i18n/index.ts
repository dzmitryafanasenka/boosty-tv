import { pluralRu, type RuPluralForms } from './plural';
import { ru, type Catalog } from './ru';

type Join<P extends string, K extends string> = P extends '' ? K : `${P}.${K}`;

/** Dotted paths to the catalog leaves whose value extends `Leaf`. */
type PathsTo<T, Leaf, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends Leaf
    ? Join<P, K>
    : T[K] extends readonly unknown[]
      ? never
      : T[K] extends object
        ? PathsTo<T[K], Leaf, Join<P, K>>
        : never;
}[keyof T & string];

export type MessageKey = PathsTo<Catalog, string>;
export type PluralKey = PathsTo<Catalog, RuPluralForms>;

function lookup(key: string): unknown {
  let node: unknown = ru;
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** A plain message from the catalog. Unknown keys fail typecheck. */
export function t(key: MessageKey): string {
  return lookup(key) as string;
}

/** The plural form for `n` (non-negative integer; throws otherwise). */
export function tp(key: PluralKey, n: number): string {
  return pluralRu(n, lookup(key) as RuPluralForms);
}

export { pluralRu, selectRuPluralCategory } from './plural';
export type { RuPluralCategory, RuPluralForms } from './plural';
