import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@newmd/ui/styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root is missing from index.html");

// StrictMode double-invokes effects in development. `bootstrapCore` is guarded
// so the second call returns the in-flight boot rather than starting a second one.
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
