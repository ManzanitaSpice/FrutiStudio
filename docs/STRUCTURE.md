# Estructura del proyecto

Este documento resume la organización del repositorio y la intención de cada
carpeta principal.

```
.
├── public/               # Assets estáticos servidos por Vite.
├── src/                  # Aplicación React (frontend).
│   ├── assets/           # Imágenes e íconos usados en UI.
│   ├── components/       # Componentes reutilizables de UI.
│   ├── context/          # Contextos globales (estado compartido).
│   ├── hooks/            # Hooks personalizados de React.
│   ├── services/         # Servicios para IO, configuración y Tauri.
│   ├── utils/            # Helpers puros sin side-effects.
│   ├── App.tsx           # Layout principal de la aplicación.
│   └── main.tsx          # Punto de entrada de React.
├── src-tauri/            # Backend Tauri (Rust).
│   └── src/lib.rs        # Comandos Tauri expuestos a la UI.
├── docs/                 # Documentación adicional para devs.
└── package.json          # Dependencias y scripts de la app.
```

## Responsabilidades clave

- **BaseDirContext**: carga, valida y persiste la carpeta base para instancias.
- **configService**: lee/escribe `config.json` para recordar la configuración.
- **baseDirService**: valida permisos y subcarpetas requeridas.
- **logService**: centraliza logging futuro para instancias/descargas.

Mantén esta estructura al añadir nuevos módulos (por ejemplo, nuevos servicios
o componentes deben vivir en sus carpetas respectivas).
