import { createContext } from "react";

// The sources of the answer being rendered, so a citation deep inside its
// markdown can find source n without every renderer passing them down.
export const CitationContext = createContext(null);
