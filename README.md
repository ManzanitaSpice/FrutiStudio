# INTERFACE Launcher

INTERFACE es un launcher de escritorio orientado a rendimiento, estabilidad y control avanzado de instancias.
Está diseñado para centralizar instalación, actualización, reparación y ejecución de entornos moddeados y vanilla con una interfaz moderna y un backend robusto.

## ¿Qué es INTERFACE?

INTERFACE es el nombre oficial del launcher y combina:

- **Frontend multiplataforma** con UX reactiva.
- **Backend nativo** para tareas pesadas (descargas, validación, reparación, ejecución de procesos).
- **Arquitectura híbrida** que prioriza tiempos de respuesta rápidos en UI y operaciones confiables en segundo plano.

## Funciones principales

- Gestión de instancias (crear, editar, duplicar, eliminar y lanzar).
- Soporte para perfiles vanilla y moddeados.
- Descarga y resolución de versiones, assets, librerías y runtimes.
- Integración con fuentes de metadata y repositorios para loaders.
- Herramientas de reparación e integridad (assets, librerías, versiones y configuración).
- Descarga resiliente con reintentos, fallback y validación por hash.
- Diagnóstico de errores de arranque y trazabilidad por logs.
- Configuración de rutas, telemetría opcional y comportamiento de ejecución.

## Lenguajes y stack usado

- **Rust**: núcleo backend, pipeline de lanzamiento, validaciones, reparación y operaciones de sistema.
- **TypeScript + React**: interfaz gráfica, estado de la app, paneles de configuración y experiencia de usuario.
- **Tauri**: puente seguro entre frontend y backend para construir app de escritorio.
- **SQLite**: persistencia local de datos operativos.

## Métodos técnicos implementados

INTERFACE aplica métodos de ingeniería orientados a confiabilidad:

- **Resolución determinística de dependencias** y metadata por versión.
- **Validación de integridad** por tamaño/hash antes de usar artefactos.
- **Flujo de reparación por módulos** para aislar fallos (assets, libs, runtime, loaders, mundos).
- **Estrategias de red tolerantes a fallos** (retry, fallback, chequeos previos y límites).
- **Normalización de metadata** para reducir inconsistencias entre fuentes.
- **Persistencia estructurada** de estado para recuperar sesiones y errores.

## Rendimiento y seguridad (comparativa general)

Sin referenciar marcas concretas, INTERFACE se diseñó para competir con launchers tradicionales en dos ejes:

### Rendimiento

- Menor tiempo percibido en operaciones repetidas por uso de cache local y validaciones incrementales.
- Menor bloqueo de UI al mover tareas intensivas al backend nativo.
- Mejor recuperación de descargas interrumpidas mediante reanudación y fallback.

### Seguridad

- Validación previa de artefactos antes de ejecución para reducir riesgo de archivos corruptos.
- Superficie de ataque acotada usando comandos controlados vía Tauri.
- Manejo de rutas y archivos con reglas de saneamiento y validación defensiva.
- Telemetría opcional y controlable por configuración del usuario.

## Instalación (desarrollo)

### Requisitos

- **Node.js** 18+
- **npm** 9+
- **Rust** estable (rustup)
- Dependencias del sistema requeridas por Tauri (según tu SO)

### Pasos

```bash
npm install
npm run tauri dev
```

## Compilación

### Frontend

```bash
npm run build
```

### Aplicación de escritorio

```bash
npm run tauri build
```

El binario/instalador se genera en los directorios de salida de Tauri dentro de `src-tauri/target`.

## Comandos útiles

- `npm run dev` → desarrollo de frontend con Vite.
- `npm run tauri dev` → desarrollo completo (UI + backend).
- `npm run build` → build de frontend.
- `npm run tauri build` → build final de escritorio.
- `npm run lint` → ESLint.
- `npm run format` → Prettier.
- `npm run typecheck` → chequeo de tipos TypeScript.
- `npm test` → pruebas con Vitest.

## Documentación técnica

- Arquitectura general: `docs/architecture.md`
- Flujo de integración CurseForge (estilo Prism): `docs/curseforge-prism-flow.md`
- Investigación de APIs y variables de entorno: `docs/apis-loaders-research.md`
- Roadmap de innovación: `docs/innovacion-launcher-roadmap.md`
- Diagnóstico de arranque y loaders: `docs/fabric-startup-diagnostics-plan.md`
- Prompt maestro backend de instancias: `docs/prompt-maestro-backend-instances.md`
