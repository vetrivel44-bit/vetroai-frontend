// TEMPORARY local preview of the Chess Arena screen (deleted after checking).
import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import ChessArena from "./components/screens/ChessArena";

createRoot(document.getElementById("root")).render(<ChessArena onClose={() => {}} />);
