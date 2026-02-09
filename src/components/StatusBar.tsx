import { useBaseDir } from "../hooks/useBaseDir";

export const StatusBar = () => {
  const { baseDir, status } = useBaseDir();

  return (
    <footer className="status-bar">
      <div className="status-bar__section">
        <strong>Estado</strong>
        <span>
          {status === "valid"
            ? "✅ Carpeta base lista"
            : "⚠️ Falta configurar la carpeta base"}
        </span>
        {baseDir && <span className="status-bar__path">📁 {baseDir}</span>}
      </div>
      <div className="status-bar__section">
        <strong>Descargas</strong>
        <span>2 activas · 8 completadas</span>
      </div>
      <div className="status-bar__section">
        <strong>Instancias</strong>
        <span>RAM 6.2 GB · TPS 19.8</span>
      </div>
      <div className="status-bar__section">
        <strong>Mensajes</strong>
        <span>Todo listo para ejecutar instancias.</span>
      </div>
    </footer>
  );
};
