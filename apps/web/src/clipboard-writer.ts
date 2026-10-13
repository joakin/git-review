/** Serializes uncancellable native writes across agent/UI activations. */
export function createClipboardWriter(writeNative: (text: string) => Promise<void>) {
  let tail = Promise.resolve();
  return {
    write(text: string, owns: () => boolean): Promise<void> {
      const result = tail.then(async () => {
        if (!owns()) throw new DOMException("The copy was canceled", "AbortError");
        await writeNative(text);
      });
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
export type ClipboardWriter = ReturnType<typeof createClipboardWriter>;
