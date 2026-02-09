import { selectFolder } from "../../services/tauri";
import { useBaseDir } from "../../hooks/useBaseDir";
import "./styles.css";

export const SelectFolderButton = () => {
  const { baseDir, setBaseDir } = useBaseDir();

  const seleccionarCarpeta = async () => {
    try {
      const path = await selectFolder();
      setBaseDir(path);
    } catch (error) {
      console.error("No se seleccionó carpeta", error);
    }
  };

  return (
    <div className="select-folder">
      <button type="button" onClick={seleccionarCarpeta}>
        Seleccionar carpeta base
      </button>
      {baseDir && <p className="select-folder__path">📁 {baseDir}</p>}
    </div>
  );
};
