import { useEffect, useState } from "preact/hooks";

const loadingDelayMs = 300;

export function DelayedLoading({ message, className }: { message: string; className: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), loadingDelayMs);
    return () => window.clearTimeout(timer);
  }, []);

  return visible ? (
    <p class={className} role="status">
      {message}
    </p>
  ) : null;
}
