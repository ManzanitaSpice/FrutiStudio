import { BaseDirProvider } from "./context/BaseDirContext";
import { SelectFolderButton } from "./components/SelectFolderButton";
import "./App.css";

function App() {
  return (
    <BaseDirProvider>
      <div className="app">
        <header className="app__header">
          <h1>FrutiStudio</h1>
          <p>
            Configura tu carpeta base para comenzar a gestionar instancias y
            modpacks.
          </p>
        </header>
        <SelectFolderButton />
        <section className="app__panels">
          <article className="panel">
            <h2>Instancias</h2>
            <p>
              Panel inicial para crear, duplicar y abrir instancias cuando la
              gestión esté lista.
            </p>
            <button type="button" disabled>
              Próximamente
            </button>
          </article>
          <article className="panel">
            <h2>Mods</h2>
            <p>
              Espacio reservado para sincronizar y administrar mods por
              instancia.
            </p>
            <button type="button" disabled>
              Próximamente
            </button>
          </article>
          <article className="panel">
            <h2>Modpacks</h2>
            <p>
              Panel para descargar, importar y exportar modpacks en futuras
              versiones.
            </p>
            <button type="button" disabled>
              Próximamente
            </button>
          </article>
        </section>
      </div>
    </BaseDirProvider>
  );
}

export default App;
