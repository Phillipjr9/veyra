import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/dashboard.css";
import "./styles/flow.css";
import "./styles/scout.css";
import "./styles/admin.css";
import "./styles/personal.css";
import "./styles/business.css";
import "./styles/statements.css";
// Phone-first corrections — must stay last so it can override the sheets above.
import "./styles/mobile.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
