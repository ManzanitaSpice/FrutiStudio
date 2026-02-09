import { useEffect, useMemo, useState } from "react";

import { BaseDirProvider } from "./context/BaseDirContext";
import { InstanceProvider } from "./context/instanceContext";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Toolbar, type SectionKey } from "./components/Toolbar";
import { InstancePanel } from "./components/panels/InstancePanel";
import { ExplorerPanel } from "./components/panels/ExplorerPanel";
import { NewsPanel } from "./components/panels/NewsPanel";
import { ServersPanel } from "./components/panels/ServersPanel";
import "./App.css";

function App() {
  const [activeSection, setActiveSection] =
    useState<SectionKey>("mis-modpacks");
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    "vmodrit",
  );
  const [uiScale, setUiScale] = useState(1);

  const instanceData = [
    {
      id: "vmodrit",
      name: "vModrit - All the Mons",
      version: "1.21.1",
      mods: 412,
      memory: "8 GB",
      status: "Listo para jugar",
      group: "No agrupado",
      lastPlayed: "Jugado hace 2 días",
      playtime: "13 d 5 h 10 min",
    },
    {
      id: "atm10",
      name: "All the Mods 10",
      version: "1.21.1",
      mods: 396,
      memory: "10 GB",
      status: "Actualización pendiente",
      group: "No agrupado",
      lastPlayed: "Jugado hoy",
      playtime: "1 d 7 h 42 min",
    },
    {
      id: "create-factory",
      name: "Create Factory",
      version: "1.20.1",
      mods: 178,
      memory: "6 GB",
      status: "Detenida",
      group: "Producción",
      lastPlayed: "Jugado hace 1 semana",
      playtime: "3 h 22 min",
    },
    {
      id: "survival-friends",
      name: "Survival Amigos",
      version: "1.20.4",
      mods: 42,
      memory: "5 GB",
      status: "Listo para jugar",
      group: "Casual",
      lastPlayed: "Jugado hace 4 horas",
      playtime: "9 h 58 min",
    },
  ];

  useEffect(() => {
    const handleZoom = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const nextScale = Math.min(
        1.4,
        Math.max(0.8, uiScale + (event.deltaY > 0 ? -0.05 : 0.05)),
      );
      setUiScale(Number(nextScale.toFixed(2)));
    };

    window.addEventListener("wheel", handleZoom, { passive: false });
    return () => window.removeEventListener("wheel", handleZoom);
  }, [uiScale]);

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", uiScale.toString());
  }, [uiScale]);

  const selectedInstance = useMemo(
    () => instanceData.find((instance) => instance.id === selectedInstanceId) ?? null,
    [instanceData, selectedInstanceId],
  );

  const handleClearSelection = () => setSelectedInstanceId(null);

  return (
    <BaseDirProvider>
      <InstanceProvider>
        <div className="app-shell">
          <Toolbar current={activeSection} onSelect={setActiveSection} />
          <div className="app-shell__body">
            <Sidebar
              instances={instanceData}
              selectedInstanceId={selectedInstanceId}
              onSelectInstance={setSelectedInstanceId}
            />
            <main className="main-panel">
              {activeSection === "mis-modpacks" && (
                <InstancePanel
                  instances={instanceData}
                  selectedInstanceId={selectedInstanceId}
                  onSelectInstance={setSelectedInstanceId}
                  onClearSelection={handleClearSelection}
                />
              )}
              {activeSection === "novedades" && <NewsPanel />}
              {activeSection === "explorador" && <ExplorerPanel />}
              {activeSection === "servers" && <ServersPanel />}
            </main>
          </div>
          <StatusBar selectedInstance={selectedInstance} />
        </div>
      </InstanceProvider>
    </BaseDirProvider>
  );
}

export default App;
