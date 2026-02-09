import { selectFolder } from "../../services/tauri";
import { useBaseDir } from "../../hooks/useBaseDir";
import "./styles.css";

export const SelectFolderButton = () => {
  const { baseDir, setBaseDir, status, validation } = useBaseDir();

  const seleccionarCarpeta = async () => {
    try {
      const path = await selectFolder();
      await setBaseDir(path);
    } catch (error) {
      console.error("No se seleccionó carpeta", error);
    }
  };

  return (
    <div className="select-folder">
      <button
        type="button"
        onClick={seleccionarCarpeta}
        disabled={status === "loading"}
      >
        {status === "loading" ? "Validando carpeta..." : "Seleccionar carpeta base"}
      </button>
      {baseDir && <p className="select-folder__path">📁 {baseDir}</p>}
      {status === "valid" && (
        <p className="select-folder__status select-folder__status--ok">
          Carpeta base lista para usar.
        </p>
      )}
      {status === "invalid" && validation?.errors?.length ? (
        <div className="select-folder__status select-folder__status--error">
          <p>La carpeta seleccionada tiene problemas:</p>
          <ul>
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};
