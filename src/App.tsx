import { Suspense, lazy, useEffect, useMemo, useState } from "react";

import { BaseDirProvider } from "./context/BaseDirContext";
import { UIProvider } from "./context/UIContext";
import { InstanceProvider } from "./context/instanceContext";
import { NotificationProvider } from "./context/NotificationContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NotificationCenter } from "./components/NotificationCenter";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useUiZoom } from "./hooks/useUiZoom";
import { useUI } from "./hooks/useUI";
import { featureFlags } from "./config/featureFlags";
import { fetchInstances } from "./services/instanceService";
import { fetchNewsOverview } from "./services/newsService";
import { fetchExplorerItems } from "./services/explorerService";
import { fetchServerListings } from "./services/serverService";
import { loadConfig, saveConfig } from "./services/configService";
import type { Instance } from "./types/models";
import "./App.css";

const InstancePanel = lazy(() =>
  import("./components/panels/InstancePanel").then((module) => ({
    default: module.InstancePanel,
  })),
);
const ExplorerPanel = lazy(() =>
  import("./components/panels/ExplorerPanel").then((module) => ({
    default: module.ExplorerPanel,
  })),
);
const NewsPanel = lazy(() =>
  import("./components/panels/NewsPanel").then((module) => ({
    default: module.NewsPanel,
  })),
);
const ServersPanel = lazy(() =>
  import("./components/panels/ServersPanel").then((module) => ({
    default: module.ServersPanel,
  })),
);
const SettingsPanel = lazy(() =>
  import("./components/panels/SettingsPanel").then((module) => ({
    default: module.SettingsPanel,
  })),
);

const loadingSteps = [
  "Inicializando launcher",
  "Cargando APIs",
  "Preparando secciones",
  "Sincronizando preferencias",
  "Finalizando",
];

const defaultCustomTheme = {
  bg: "#f7f4ff",
  surface: "#ffffff",
  surfaceStrong: "#ece7f8",
  border: "#cfc3e8",
  text: "#2f2340",
  muted: "#66597f",
  accent: "#a070ff",
};

const AppShell = () => {
  const {
    activeSection,
    uiScale,
    isFocusMode,
    setScale,
    setSection,
    toggleFocus,
    setTheme,
    theme,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
  } = useUI();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    null,
  );
  const [instances, setInstances] = useState<Instance[]>([]);
  const [bootReady, setBootReady] = useState(false);
  const [bootStep, setBootStep] = useState(0);

  useEffect(() => {
    const runBoot = async () => {
      setBootStep(0);
      const config = await loadConfig();
      setBootStep(1);
      await Promise.allSettled([
        fetchInstances(),
        fetchNewsOverview(),
        fetchExplorerItems("Modpacks"),
        fetchServerListings(),
      ]);
      setBootStep(2);
      if (config.uiScale) {
        setScale(config.uiScale);
      }
      if (config.theme) {
        setTheme(config.theme);
      }
      if (config.customTheme) {
        Object.entries(config.customTheme).forEach(([key, value]) => {
          document.documentElement.style.setProperty(`--custom-${key}`, value);
        });
      } else {
        Object.entries(defaultCustomTheme).forEach(([key, value]) => {
          document.documentElement.style.setProperty(`--custom-${key}`, value);
        });
      }
      setBootStep(3);
      const loadedInstances = await fetchInstances();
      setInstances(loadedInstances);
      setBootStep(4);
      window.setTimeout(() => setBootReady(true), 600);
    };
    void runBoot();
  }, [setScale, setTheme]);

  useUiZoom({
    scale: uiScale,
    onChange: (nextScale) => {
      setScale(nextScale);
      const persist = async () => {
        const config = await loadConfig();
        await saveConfig({ ...config, uiScale: nextScale });
      };
      void persist();
    },
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", uiScale.toString());
  }, [uiScale]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const persist = async () => {
      const config = await loadConfig();
      await saveConfig({ ...config, theme });
    };
    void persist();
  }, [theme]);

  useKeyboardShortcuts({
    onSelectSection: setSection,
    onToggleFocus: toggleFocus,
  });

  const selectedInstance = useMemo(
    () =>
      instances.find((instance) => instance.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );

  const handleClearSelection = () => setSelectedInstanceId(null);
  const handleCreateInstance = (instance: Instance) => {
    setInstances((prev) => [instance, ...prev]);
    setSelectedInstanceId(instance.id);
  };
  const showStatusBar = activeSection === "mis-modpacks" && !isFocusMode;

  return (
    <ErrorBoundary>
      <div className={isFocusMode ? "app-shell app-shell--focus" : "app-shell"}>
        {!bootReady && (
          <div className="boot-screen" role="status" aria-live="polite">
            <div className="boot-screen__logo">FrutiLauncher</div>
            <h2>Cargando APIs y secciones</h2>
            <ul>
              {loadingSteps.map((step, index) => {
                const done = index <= bootStep;
                return (
                  <li key={step} className={done ? "is-done" : ""}>
                    {step}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <NotificationCenter />
        <Toolbar
          current={activeSection}
          onSelect={setSection}
          showGlobalSearch={activeSection !== "mis-modpacks"}
          flags={featureFlags}
          isFocusMode={isFocusMode}
          onBack={goBack}
          onForward={goForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
        />
        <div className="app-shell__body app-shell__body--no-sidebar">
          <main className="main-panel" role="main">
            <Suspense fallback={<div className="panel-loading">Cargando…</div>}>
              {activeSection === "mis-modpacks" && (
                <InstancePanel
                  instances={instances}
                  selectedInstanceId={selectedInstanceId}
                  onSelectInstance={setSelectedInstanceId}
                  onClearSelection={handleClearSelection}
                  onCreateInstance={handleCreateInstance}
                  isFocusMode={isFocusMode}
                  onToggleFocusMode={toggleFocus}
                />
              )}
              {activeSection === "novedades" && featureFlags.news && (
                <NewsPanel />
              )}
              {activeSection === "explorador" && featureFlags.explorer && (
                <ExplorerPanel />
              )}
              {activeSection === "servers" && featureFlags.servers && (
                <ServersPanel />
              )}
              {activeSection === "configuracion" && featureFlags.settings && (
                <SettingsPanel />
              )}
            </Suspense>
          </main>
        </div>
        {showStatusBar && (
          <StatusBar selectedInstance={selectedInstance} instances={instances} />
        )}
      </div>
    </ErrorBoundary>
  );
};

function App() {
  return (
    <UIProvider>
      <BaseDirProvider>
        <NotificationProvider>
          <InstanceProvider>
            <AppShell />
          </InstanceProvider>
        </NotificationProvider>
      </BaseDirProvider>
    </UIProvider>
  );
}

export default App;
