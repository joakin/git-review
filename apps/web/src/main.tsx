import { render } from "preact";
import { App } from "./App.tsx";
import { NotificationProvider } from "./Notifications.tsx";
import { appBasePath } from "./deployment.ts";
import { AgentApiProvider } from "./AgentApiProvider.tsx";
import { createPageAgentConnection } from "./agent-connection.ts";

const root = document.getElementById("app");
if (root === null) throw new Error("The application root is missing");
render(
  <NotificationProvider>
    <AgentApiProvider connection={createPageAgentConnection()}>
      <App />
    </AgentApiProvider>
  </NotificationProvider>,
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
