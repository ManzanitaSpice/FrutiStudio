# Arquitectura interna

## Frontend

- **Contextos**
  - `BaseDirContext`: gestiona la carpeta base y su validación.
  - `UIContext`: centraliza zoom, tema, sección activa y modo foco.
  - `NotificationContext`: cola de notificaciones in-app.
- **Servicios**
  - `configService`: carga/guarda configuración con retry y cache.
  - `instanceService`: obtiene instancias desde fixtures y cache.
  - `apiClients`: cliente con rate limiting, headers y cache para APIs externas.
  - `curseService` / `modrinthService` / `atmlService`: integraciones con APIs
    externas para mods y modpacks.
  - `modpackExportService`: genera manifests para exportar instancias.
  - `downloadQueue`: cola de descargas con reintentos y verificación de hash.

## Backend (Tauri)

- `load_config` / `save_config`: migraciones y persistencia en `config.json`.
- `validate_base_dir`: validación con dry-run y chequeo de espacio.
- `append_log`: escritura con rotación de archivos.
- `list_instances` / `manage_modpack`: CRUD básico usando SQLite.

## Tests

- Snapshot tests para componentes clave.
- Pruebas de integración para flujo de selección de carpeta base.

## Nueva capa core (modular)

- `src/core/content`: registro de proveedores con interfaz única (`search`, `download`, `resolveDependencies`).
- Proveedores implementados: `curseforge`, `modrinth`, `private` (packs internos).
- `curseforgeModpackService`: resuelve manifests de modpack y detecta dependencias faltantes por proyecto.
- `profileService`: sincroniza perfiles multiusuario desde cuentas activas (separando cuenta/autenticación de perfil de juego).
- `serverService`: ahora combina capa local y remota mediante `localServerService` + `remoteServerService`.

- Blueprint del pipeline de launcher y contratos del core Rust: `docs/launcher-core-blueprint.md`.
