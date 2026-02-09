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
      </div>
    </BaseDirProvider>
  );
}

export default App;
