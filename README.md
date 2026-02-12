# Interface

Interface es una app de escritorio construida con Tauri, React y TypeScript
para gestionar instancias, modpacks, mods y versiones con una UX moderna y
extensible.

## Resumen técnico

- Se reorganizó la obtención de instancias con fixtures y un servicio dedicado,
  junto con un contexto UI global (zoom, sección activa, modo foco, tema).
- Se añadieron feature flags, lazy loading de paneles, error boundaries, sistema
  de notificaciones, y un panel de configuración para la carpeta base y la
  telemetría opcional.
- Se implementaron utilidades compartidas (formatters, retry, semver, i18n),
  junto con caching, rate limiting y modo offline para clientes de APIs.
- El backend en Tauri incorpora migraciones de config, dry-run de validación,
  verificación de espacio libre, logs con rotación, y comandos para gestionar
  modpacks/instancias usando SQLite.

## Comandos útiles

- `npm run dev` inicia Vite para desarrollo.
- `npm run tauri dev` inicia Tauri + Vite automáticamente (recomendado para desarrollo de escritorio).
- `npm run build` compila el frontend.
- `npm run lint` corre ESLint.
- `npm run format` aplica Prettier.
- `npm run typecheck` ejecuta TypeScript sin emitir.
- `npm test` corre Vitest.

## Arquitectura

Consulta `docs/architecture.md` para la descripción de servicios, contextos y
comandos Tauri.


## Integración CurseForge (Prism-style)

Se documentó e implementó una base para fingerprints + resolución de descarga legal con fallback manual: `docs/curseforge-prism-flow.md`.


## Investigación de APIs para loaders y .env

Documento técnico con APIs recomendadas (Fabric/Forge/NeoForge/Quilt/CurseForge), estrategia de versionado e instalación, y estructura de variables de entorno: `docs/apis-loaders-research.md`.

## Roadmap de innovación (AI Repair, compatibilidad predictiva, sandbox, sync)

Plan incremental para integrar funciones avanzadas sin romper la base actual: `docs/innovacion-launcher-roadmap.md`.

## Diagnóstico de arranque (código 1 / loaders)

Guía operativa y plan de hardening para fallos de arranque de Minecraft (Fabric/Forge/Quilt): `docs/fabric-startup-diagnostics-plan.md`.

## Prompt maestro de backend de instancias

Documento operativo para implementar y reparar el flujo end-to-end (Vanilla/Fabric/Forge/NeoForge/Quilt + modpacks): `docs/prompt-maestro-backend-instances.md`.



## Solución rápida a `ERR_CONNECTION_REFUSED`

Si abres el binario de debug y ves `127.0.0.1 rechazó la conexión`, normalmente faltaba levantar el frontend de Vite.

- Para desarrollo de escritorio, usa `npm run tauri dev` (levanta backend y frontend juntos).
- Para ejecutar sin servidor dev, primero compila frontend con `npm run build` para generar `dist/`.

En esta configuración, Tauri carga `dist` por defecto y evita depender de `http://127.0.0.1:1420` al ejecutar el binario local.
