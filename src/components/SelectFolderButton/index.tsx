import { useBaseDir } from "../../hooks/useBaseDir";
import { useI18n } from "../../i18n/useI18n";
import { selectFolder } from "../../services/tauri";
import "./styles.css";

export const SelectFolderButton = () => {
  const { baseDir, setBaseDir, status, validation } = useBaseDir();
  const { t } = useI18n();

  const seleccionarCarpeta = async () => {
    try {
      const result = await selectFolder();
      if (result.ok && result.path) {
        await setBaseDir(result.path);
      }
    } catch (error) {
      console.error("No se seleccionó carpeta", error);
    }
  };

  return (
    <div className="select-folder">
      <button
        type="button"
        onClick={seleccionarCarpeta}
        disabled={status === "validating"}
      >
        {status === "validating"
          ? t("baseDir").statusLoading
          : t("baseDir").action}
      </button>
      {baseDir && <p className="select-folder__path">📁 {baseDir}</p>}
      {status === "valid" && (
        <p className="select-folder__status select-folder__status--ok">
          {t("baseDir").statusValid}
        </p>
      )}
      {validation?.warnings?.length ? (
        <div className="select-folder__status select-folder__status--warning">
          <p>Advertencias detectadas:</p>
          <ul>
            {validation.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
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
