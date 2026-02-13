import { useEffect } from "react";

import type { SectionKey } from "../components/Toolbar";

interface ShortcutOptions {
  onSelectSection: (section: SectionKey) => void;
  onToggleFocus: () => void;
}

export const useKeyboardShortcuts = ({
  onSelectSection,
  onToggleFocus,
}: ShortcutOptions) => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
      ) {
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
          case "1":
            onSelectSection("inicio");
            break;
          case "2":
            onSelectSection("mis-modpacks");
            break;
          case "3":
            onSelectSection("features");
            break;
          case "4":
            onSelectSection("explorador");
            break;
          case "5":
            onSelectSection("servers");
            break;
          case "6":
            onSelectSection("comunidad");
            break;
          default:
            break;
        }
      }

      if (event.key.toLowerCase() === "f") {
        onToggleFocus();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSelectSection, onToggleFocus]);
};
