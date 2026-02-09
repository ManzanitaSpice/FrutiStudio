import { Suspense, lazy, useEffect, useMemo, useState } from "react";

import { BaseDirProvider } from "./context/BaseDirContext";
import { UIProvider } from "./context/UIContext";
import { InstanceProvider } from "./context/instanceContext";
import { NotificationProvider } from "./context/NotificationContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NotificationCenter } from "./components/NotificationCenter";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { EmptyState } from "./components/EmptyState";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useUiZoom } from "./hooks/useUiZoom";
import { useUI } from "./hooks/useUI";
import { useI18n } from "./i18n/useI18n";
import { featureFlags } from "./config/featureFlags";
import { fetchInstances } from "./services/instanceService";
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
  } = useUI();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    "vmodrit",
  );
  const [instances, setInstances] = useState<Instance[]>([]);
  const { t } = useI18n();

  useEffect(() => {
    const loadInstances = async () => {
      const data = await fetchInstances();
      setInstances(data);
    };
    void loadInstances();
  }, []);

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
    const applyConfig = async () => {
      const config = await loadConfig();
      if (config.uiScale) {
        setScale(config.uiScale);
      }
      if (config.theme) {
        setTheme(config.theme);
      }
    };
    void applyConfig();
  }, [setScale, setTheme]);

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
  const showSidebar = activeSection === "mis-modpacks" && !isFocusMode;
  const showStatusBar = activeSection === "mis-modpacks" && !isFocusMode;
  const showToolbar = !isFocusMode;

  return (
    <ErrorBoundary>
      <div className={isFocusMode ? "app-shell app-shell--focus" : "app-shell"}>
        <NotificationCenter />
        {showToolbar && (
          <Toolbar
            current={activeSection}
            onSelect={setSection}
            showGlobalSearch={activeSection !== "mis-modpacks"}
            flags={featureFlags}
            onThemeChange={setTheme}
            theme={theme}
          />
        )}
        <div
          className={
            showSidebar
              ? "app-shell__body"
              : "app-shell__body app-shell__body--no-sidebar"
          }
        >
          {showSidebar && <Sidebar />}
          <main className="main-panel" role="main">
            <Suspense fallback={<div className="panel-loading">Cargando…</div>}>
              {activeSection === "mis-modpacks" && (
                <InstancePanel
                  instances={instances}
                  selectedInstanceId={selectedInstanceId}
                  onSelectInstance={setSelectedInstanceId}
                  onClearSelection={handleClearSelection}
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
              {activeSection === "mis-modpacks" &&
                !selectedInstanceId && (
                  <EmptyState
                    title={t("emptyState").title}
                    description={t("emptyState").description}
                  />
                )}
            </Suspense>
          </main>
        </div>
        {showStatusBar && <StatusBar selectedInstance={selectedInstance} />}
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
