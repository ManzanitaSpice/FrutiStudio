import { createContext, useCallback, useMemo, useReducer } from "react";

import type { SectionKey } from "../components/Toolbar";

export type ThemePreference = "system" | "light" | "dark";

interface UIState {
  activeSection: SectionKey;
  uiScale: number;
  isFocusMode: boolean;
  theme: ThemePreference;
}

type UIAction =
  | { type: "set-section"; payload: SectionKey }
  | { type: "set-scale"; payload: number }
  | { type: "toggle-focus" }
  | { type: "set-focus"; payload: boolean }
  | { type: "set-theme"; payload: ThemePreference };

const initialState: UIState = {
  activeSection: "mis-modpacks",
  uiScale: 1,
  isFocusMode: false,
  theme: "system",
};

const reducer = (state: UIState, action: UIAction): UIState => {
  switch (action.type) {
    case "set-section":
      return {
        ...state,
        activeSection: action.payload,
        isFocusMode:
          action.payload === "mis-modpacks" ? state.isFocusMode : false,
      };
    case "set-scale":
      return { ...state, uiScale: action.payload };
    case "toggle-focus":
      return { ...state, isFocusMode: !state.isFocusMode };
    case "set-focus":
      return { ...state, isFocusMode: action.payload };
    case "set-theme":
      return { ...state, theme: action.payload };
    default:
      return state;
  }
};

export interface UIContextValue extends UIState {
  setSection: (section: SectionKey) => void;
  setScale: (scale: number) => void;
  toggleFocus: () => void;
  setFocus: (value: boolean) => void;
  setTheme: (value: ThemePreference) => void;
}

export const UIContext = createContext<UIContextValue | undefined>(undefined);

export const UIProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const setSection = useCallback(
    (section: SectionKey) => dispatch({ type: "set-section", payload: section }),
    [],
  );

  const setScale = useCallback(
    (scale: number) => dispatch({ type: "set-scale", payload: scale }),
    [],
  );

  const toggleFocus = useCallback(
    () => dispatch({ type: "toggle-focus" }),
    [],
  );

  const setFocus = useCallback(
    (value: boolean) => dispatch({ type: "set-focus", payload: value }),
    [],
  );

  const setTheme = useCallback(
    (value: ThemePreference) => dispatch({ type: "set-theme", payload: value }),
    [],
  );

  const value = useMemo(
    () => ({
      ...state,
      setSection,
      setScale,
      toggleFocus,
      setFocus,
      setTheme,
    }),
    [setFocus, setScale, setSection, setTheme, state, toggleFocus],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};
