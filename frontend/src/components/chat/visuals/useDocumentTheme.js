import { useEffect, useState } from "react";

// Follows the app's light/dark switch (data-theme on <html>).
export function useDocumentTheme() {
  const read = () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
