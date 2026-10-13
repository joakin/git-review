import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type { BrowserData } from "./browser-data.ts";
import { useNotification } from "./Notifications.tsx";

const context = createContext<BrowserData | null>(null);
export function BrowserDataProvider({
  data,
  children,
}: {
  data: BrowserData;
  children: ComponentChildren;
}) {
  return <context.Provider value={data}>{children}</context.Provider>;
}
export function useBrowserData(): BrowserData {
  const data = useContext(context);
  if (data === null) throw new Error("Local data requires its browser owner.");
  return data;
}
export function BrowserDataNotice() {
  const data = useBrowserData();
  const [problem, setProblem] = useState(data.readProblem);
  useEffect(() => {
    const update = () => setProblem(data.readProblem());
    const unsubscribe = data.subscribeProblem(update);
    update();
    return unsubscribe;
  }, [data]);
  useNotification(
    "browser-data",
    problem === null ? null : { message: problem, severity: "error" },
  );
  return null;
}
