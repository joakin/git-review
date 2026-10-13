import { render } from "preact";
import { appBasePath } from "./deployment.ts";
import { AgentApplication } from "./AgentApplication.tsx";
import { createPageAgentConnection } from "./agent-connection.ts";

const root = document.getElementById("app");
if (root === null) throw new Error("The application root is missing");
const legacyConnection = createPageAgentConnection();
render(
  <AgentApplication legacyConnection={legacyConnection} connections={[legacyConnection]} />,
  root,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${appBasePath}sw.js`, {
        scope: appBasePath,
        updateViaCache: "none",
      })
      .catch(() => {
        // The live review app still works when service workers are unavailable.
      });
  });
}
