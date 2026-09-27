import { render } from "preact";
import { App } from "./App.tsx";

const root = document.getElementById("app");
if (root === null) throw new Error("The application root is missing");
render(<App />, root);
