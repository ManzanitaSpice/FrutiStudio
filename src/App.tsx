import { useState } from "react";

import { BaseDirProvider } from "./context/BaseDirContext";
import { InstanceProvider } from "./context/instanceContext";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Toolbar, type SectionKey } from "./components/Toolbar";
import { InstancePanel } from "./components/panels/InstancePanel";
import "./App.css";

function App() {
  const [activeSection, setActiveSection] =
    useState<SectionKey>("mis-modpacks");
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    "vmodrit",
  );

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
    },
  ];

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
              <InstancePanel
                instances={instanceData}
                selectedInstanceId={selectedInstanceId}
                onSelectInstance={setSelectedInstanceId}
              />
            </main>
          </div>
          <StatusBar />
        </div>
      </InstanceProvider>
    </BaseDirProvider>
  );
}

export default App;
