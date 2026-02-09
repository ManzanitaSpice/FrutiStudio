# Arquitectura interna

## Frontend

- **Contextos**
  - `BaseDirContext`: gestiona la carpeta base y su validación.
  - `UIContext`: centraliza zoom, tema, sección activa y modo foco.
  - `NotificationContext`: cola de notificaciones in-app.
- **Servicios**
  - `configService`: carga/guarda configuración con retry y cache.
  - `instanceService`: obtiene instancias desde fixtures y cache.
  - `apiClients`: cliente con rate limiting y cache para APIs externas.
  - `downloadQueue`: cola de descargas con reintentos y verificación de hash.

## Backend (Tauri)

- `load_config` / `save_config`: migraciones y persistencia en `config.json`.
- `validate_base_dir`: validación con dry-run y chequeo de espacio.
- `append_log`: escritura con rotación de archivos.
- `list_instances` / `manage_modpack`: CRUD básico usando SQLite.

## Tests

- Snapshot tests para componentes clave.
- Pruebas de integración para flujo de selección de carpeta base.
