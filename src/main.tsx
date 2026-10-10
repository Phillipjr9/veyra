import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/dashboard.css";
import "./styles/plan.css";
import "./styles/flow.css";
import "./styles/scout.css";
import "./styles/admin.css";
import "./styles/admin-casework.css";
import "./styles/personal.css";
import "./styles/business.css";
import "./styles/statements.css";
import "./styles/dashboard-advanced.css";
// Phone-first corrections — must stay last so it can override the sheets above.
import "./styles/mobile.css";
import App from "./App";

function showBootError(err: unknown) {
  const el = document.getElementById("boot-error");
  if (!el) return;
  const text = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  el.textContent = text;
  el.classList.add("is-on");
}

window.addEventListener("error", event => {
  if (String(event.message).includes("ResizeObserver")) return;
  showBootError(event.error ?? event.message);
});
window.addEventListener("unhandledrejection", event => {
  showBootError(event.reason);
});

const root = document.getElementById("root");
if (!root) {
  showBootError("Veyra could not find #root.");
} else {
  try {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  } catch (err) {
    showBootError(err);
  }
}
