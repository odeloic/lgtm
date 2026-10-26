import { useEffect, useState } from "react";
import { Icon } from "./Icon";

type Theme = "system" | "light" | "dark";

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const ICON: Record<Theme, string> = { system: "monitor", light: "sun", dark: "moon" };
const KEY = "lgtm-theme";

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(stored);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      return;
    }
  }, [theme]);

  return (
    <button className="theme" onClick={() => setTheme(NEXT[theme])} aria-label={`Theme: ${theme}. Switch to ${NEXT[theme]}`} title={`Theme: ${theme}`}>
      <Icon name={ICON[theme]} />
    </button>
  );
}
