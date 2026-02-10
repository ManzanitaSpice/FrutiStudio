import { createContext, useCallback, useMemo, useReducer } from "react";

import type { SectionKey } from "../components/Toolbar";

export type ThemePreference =
  | "system"
  | "default"
  | "light"
  | "chrome"
  | "aurora"
  | "mint"
  | "lilac"
  | "peach"
  | "sky"
  | "rose"
  | "custom";

export interface CustomTheme {
  background: string;
  surface: string;
  card: string;
  text: string;
  accent: string;
  muted: string;
  border: string;
}

interface UIState {
  activeSection: SectionKey;
  uiScale: number;
  isFocusMode: boolean;
  theme: ThemePreference;
  customTheme: CustomTheme;
  history: SectionKey[];
  historyIndex: number;
}

type UIAction =
  | { type: "set-section"; payload: SectionKey }
  | { type: "set-scale"; payload: number }
  | { type: "toggle-focus" }
  | { type: "set-focus"; payload: boolean }
  | { type: "set-theme"; payload: ThemePreference }
  | { type: "set-custom-theme"; payload: CustomTheme }
  | { type: "go-back" }
  | { type: "go-forward" };

const initialState: UIState = {
  activeSection: "mis-modpacks",
  uiScale: 1,
  isFocusMode: false,
  theme: "default",
  customTheme: {
    background: "#0f1115",
    surface: "#131822",
    card: "#1a1f2a",
    text: "#e6e9f0",
    accent: "#f97316",
    muted: "#9aa3b2",
    border: "#2b313f",
  },
  history: ["mis-modpacks"],
  historyIndex: 0,
};

const reducer = (state: UIState, action: UIAction): UIState => {
  switch (action.type) {
    case "set-section": {
      if (action.payload === state.activeSection) {
        return state;
      }
      const nextHistory = state.history.slice(0, state.historyIndex + 1);
      nextHistory.push(action.payload);
      return {
        ...state,
        activeSection: action.payload,
        isFocusMode:
          action.payload === "mis-modpacks" ? state.isFocusMode : false,
        history: nextHistory,
        historyIndex: nextHistory.length - 1,
      };
    }
    case "set-scale":
      return { ...state, uiScale: action.payload };
    case "toggle-focus":
      return { ...state, isFocusMode: !state.isFocusMode };
    case "set-focus":
      return { ...state, isFocusMode: action.payload };
    case "set-theme":
      return { ...state, theme: action.payload };
    case "set-custom-theme":
      return { ...state, customTheme: action.payload };
    case "go-back": {
      if (state.historyIndex <= 0) {
        return state;
      }
      const nextIndex = state.historyIndex - 1;
      return {
        ...state,
        activeSection: state.history[nextIndex],
        isFocusMode:
          state.history[nextIndex] === "mis-modpacks"
            ? state.isFocusMode
            : false,
        historyIndex: nextIndex,
      };
    }
    case "go-forward": {
      if (state.historyIndex >= state.history.length - 1) {
        return state;
      }
      const nextIndex = state.historyIndex + 1;
      return {
        ...state,
        activeSection: state.history[nextIndex],
        isFocusMode:
          state.history[nextIndex] === "mis-modpacks"
            ? state.isFocusMode
            : false,
        historyIndex: nextIndex,
      };
    }
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
  setCustomTheme: (value: CustomTheme) => void;
  goBack: () => void;
  goForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
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

  const setCustomTheme = useCallback(
    (value: CustomTheme) =>
      dispatch({ type: "set-custom-theme", payload: value }),
    [],
  );

  const goBack = useCallback(() => dispatch({ type: "go-back" }), []);
  const goForward = useCallback(() => dispatch({ type: "go-forward" }), []);

  const value = useMemo(
    () => ({
      ...state,
      setSection,
      setScale,
      toggleFocus,
      setFocus,
      setTheme,
      setCustomTheme,
      goBack,
      goForward,
      canGoBack: state.historyIndex > 0,
      canGoForward: state.historyIndex < state.history.length - 1,
    }),
    [
      goBack,
      goForward,
      setFocus,
      setScale,
      setSection,
      setTheme,
      setCustomTheme,
      state,
      toggleFocus,
    ],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};
