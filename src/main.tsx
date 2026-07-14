import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const designerPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).has("designer");
const DesignPlayground = import.meta.env.DEV
  ? lazy(() => import("./components/DesignPlayground").then((module) => ({ default: module.DesignPlayground })))
  : null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {designerPreview && DesignPlayground
      ? <Suspense fallback={null}><DesignPlayground /></Suspense>
      : <App />}
  </React.StrictMode>,
);
