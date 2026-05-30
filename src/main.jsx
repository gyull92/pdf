import React from "react";
import ReactDOM from "react-dom/client";
import PdfViewerWithBookmarks from "./PdfViewerWithBookmarks";
import "./index.css";

document.title = __APP_WINDOW_TITLE__;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PdfViewerWithBookmarks />
  </React.StrictMode>
);
