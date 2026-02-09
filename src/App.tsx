import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

function App() {
  const [folder, setFolder] = useState("");
  const [error, setError] = useState("");

  const openFolderPicker = async () => {
    setError("");
    try {
      const path = await invoke<string>("select_folder");
      setFolder(path);
    } catch {
      setError("No se seleccionó ninguna carpeta");
    }
  };

  return (
    <div>
      <h1>FrutiStudio</h1>

      <button onClick={openFolderPicker}>
        Seleccionar carpeta base
      </button>

      {folder && <p>📁 {folder}</p>}
      {error && <p>{error}</p>}
    </div>
  );
}

export default App;