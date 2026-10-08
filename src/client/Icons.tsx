export type IconName = "back" | "forward" | "folder" | "file" | "link" | "other";

export function Chevron({ direction = "right" }: { direction?: "right" | "down" | "up" }) {
  return (
    <svg
      class={`app-chevron app-chevron-${direction}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      class="app-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {name === "back" ? (
        <path d="M19 12H5m6-6-6 6 6 6" />
      ) : name === "forward" ? (
        <path d="M5 12h14m-6-6 6 6-6 6" />
      ) : name === "folder" ? (
        <path d="M3 7V5.5A2.5 2.5 0 0 1 5.5 3H9l2.2 2.5h7.3A2.5 2.5 0 0 1 21 8v10.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5V7Zm0 2h18" />
      ) : name === "file" ? (
        <path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3Zm8 0v4h4M9 12h6m-6 4h6" />
      ) : name === "link" ? (
        <>
          <path d="M8 16 16 8m-5 0h5v5" />
          <path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
        </>
      ) : (
        <path d="m12 3 9 9-9 9-9-9 9-9Z" />
      )}
    </svg>
  );
}
