import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/dashboard.css";
import "./styles/plan.css";
import "./styles/flow.css";
import "./styles/scout.css";
import "./styles/admin.css";
import "./styles/statements.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
