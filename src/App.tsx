import { useState } from "react";

import { BaseDirProvider } from "./context/BaseDirContext";
import { InstanceProvider } from "./context/instanceContext";
import { ModProvider } from "./context/modContext";
import { ModpackProvider } from "./context/modpackContext";
import { ServerProvider } from "./context/serverContext";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Toolbar, type SectionKey } from "./components/Toolbar";
import { InstancePanel } from "./components/panels/InstancePanel";
import { ModpackPanel } from "./components/panels/ModpackPanel";
import { ModPanel } from "./components/panels/ModPanel";
import { ResourcesPanel } from "./components/panels/ResourcesPanel";
import { ServerPanel } from "./components/panels/ServerPanel";
import "./App.css";

function App() {
  const [activeSection, setActiveSection] =
    useState<SectionKey>("instancias");

  const instanceData = [
    {
      id: "alpha",
      name: "Survival Vanilla+",
      version: "1.20.4",
      mods: 32,
      memory: "6 GB",
      status: "En ejecución",
    },
    {
      id: "beta",
      name: "Create Factory",
      version: "1.19.2",
      mods: 78,
      memory: "8 GB",
      status: "Detenida",
    },
    {
      id: "gamma",
      name: "Skyblock Pro",
      version: "1.18.2",
      mods: 54,
      memory: "5 GB",
      status: "Actualizando",
    },
  ];

  const modpackData = [
    {
      id: "euphoria",
      name: "Euphoria FX",
      source: "Modrinth",
      version: "2.4.1",
      status: "Actualizado",
    },
    {
      id: "forgecraft",
      name: "ForgeCraft Plus",
      source: "CurseForge",
      version: "5.1.0",
      status: "Descarga pendiente",
    },
    {
      id: "local",
      name: "Colección Local",
      source: "Local",
      version: "1.0.0",
      status: "Sincronizado",
    },
  ];

  const modData = [
    { id: "sodium", name: "Sodium", version: "0.5.8", enabled: true },
    { id: "iris", name: "Iris", version: "1.7.1", enabled: true },
    { id: "xaero", name: "Xaero's Minimap", version: "23.9.2", enabled: false },
    { id: "create", name: "Create", version: "0.5.1", enabled: true },
  ];

  const serverData = [
    {
      id: "lobby",
      name: "Fruti Lobby",
      address: "play.fruti.gg",
      lastSeen: "hace 1 día",
    },
    {
      id: "minigames",
      name: "PixelCraft",
      address: "mc.pixelcraft.net",
      lastSeen: "hace 3 días",
    },
    {
      id: "friends",
      name: "Survival Amigos",
      address: "192.168.1.22",
      lastSeen: "hace 2 horas",
    },
  ];

  const resourcesData = [
    { id: "shader1", name: "Complementary Shaders", type: "Shader", status: "Activo" },
    { id: "shader2", name: "BSL Shaders", type: "Shader", status: "Instalado" },
    { id: "resource1", name: "Faithful 32x", type: "Resource Pack", status: "Activo" },
    { id: "resource2", name: "Stay True", type: "Resource Pack", status: "Instalado" },
  ];

  const renderPanel = () => {
    switch (activeSection) {
      case "modpacks":
        return <ModpackPanel modpacks={modpackData} />;
      case "mods":
        return <ModPanel mods={modData} />;
      case "servers":
        return <ServerPanel servers={serverData} />;
      case "recursos":
        return <ResourcesPanel resources={resourcesData} />;
      case "instancias":
      default:
        return <InstancePanel instances={instanceData} />;
    }
  };

  return (
    <BaseDirProvider>
      <InstanceProvider>
        <ModpackProvider>
          <ModProvider>
            <ServerProvider>
              <div className="app-shell">
                <Toolbar
                  current={activeSection}
                  onSelect={setActiveSection}
                />
                <div className="app-shell__body">
                  <Sidebar
                    current={activeSection}
                    onSelect={setActiveSection}
                  />
                  <main className="main-panel">{renderPanel()}</main>
                </div>
                <StatusBar />
              </div>
            </ServerProvider>
          </ModProvider>
        </ModpackProvider>
      </InstanceProvider>
    </BaseDirProvider>
  );
}

export default App;
