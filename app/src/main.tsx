import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { Providers } from "./app/providers";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(<StrictMode><ErrorBoundary><Providers><App /></Providers></ErrorBoundary></StrictMode>);
