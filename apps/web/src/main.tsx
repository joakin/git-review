import { render } from "preact";
import { App } from "./App.tsx";
import { NotificationProvider } from "./Notifications.tsx";
import { appBasePath } from "./deployment.ts";

const root = document.getElementById("app");
if (root === null) throw new Error("The application root is missing");
render(
  <NotificationProvider>
    <App />
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
