/** A loaded resource value for presentation; identity and lifetime stay with its owner. */
export type LoadState<T> =
  { kind: "loading" } | { kind: "ready"; value: T } | { kind: "error"; message: string };
