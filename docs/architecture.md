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

## Core Rust de ejecución Minecraft (sin dependencia de UI)


La capa `core/` se divide en 7 módulos independientes y reutilizables:

```text
core/
 ├─ auth/
 ├─ version_resolver/
 ├─ java_manager/
 ├─ modloader_resolver/
 ├─ downloader/
 ├─ instance_runner/
 └─ validator/
```

### 1) `version_resolver/` (versiones oficiales de Minecraft)

**Fuente oficial Mojang**

- Manifest global:
  - `GET https://launchermeta.mojang.com/mc/game/version_manifest_v2.json`
- Flujo:
  1. Descargar `version_manifest_v2.json`.
  2. Buscar la versión solicitada (`versions[].id`) y obtener su `url`.
  3. Descargar el `version.json` concreto de esa versión.

`version.json` es la fuente de verdad y contiene, entre otros:

- `libraries[]`
- `downloads.client.url` / `downloads.client.sha1`
- `assetIndex`
- `mainClass`
- `arguments.jvm`
- `arguments.game`

### 2) `downloader/` (client jar, libraries, assets)

#### Client JAR

- URL: `version_json.downloads.client.url`
- Destino: `versions/{version}/{version}.jar`
- Validación: SHA1 contra `version_json.downloads.client.sha1`

#### Libraries

- Origen: `version.json.libraries[]`
- Fuente preferida: `https://libraries.minecraft.net/`
- Si no hay URL explícita, construir ruta Maven con:
  - `group:artifact:version`
  - `group/artifact/version/artifact-version.jar`

#### Assets

- Índice: `version_json.assetIndex.url`
- Guardar índice en: `assets/indexes/{id}.json`
- Base oficial de objetos:
  - `https://resources.download.minecraft.net/`
- Patrón de descarga por hash:
  - `{first_two_hash}/{full_hash}`
- Destino: `assets/objects/`

### 3) `modloader_resolver/` (Fabric, Forge, NeoForge, Quilt)

#### Fabric (API oficial)

- Base API: `https://meta.fabricmc.net/v2/`
- Obtener loaders compatibles:
  - `GET /versions/loader/{mc_version}`
- Obtener profile final (JSON extendido tipo `version.json`):
  - `GET /versions/loader/{mc_version}/{loader_version}/profile/json`
- Destino sugerido:
  - `versions/fabric-loader-{loader}-{mc}/`

#### Forge (maven oficial)

- Maven oficial: `https://maven.minecraftforge.net/`
- Descubrimiento de versiones:
  - `https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml`
- Installer:
  - `https://maven.minecraftforge.net/net/minecraftforge/forge/{mc_version}-{forge_version}/forge-{mc}-{forge}-installer.jar`
- Instalación silenciosa:
  - `java -jar forge-installer.jar --installClient`

#### NeoForge

- Maven oficial: `https://maven.neoforged.net/releases/`
- Patrón de resolución equivalente a Forge.

#### Quilt

- API oficial: `https://meta.quiltmc.org/v3/`
- Flujo de resolución equivalente a Fabric.

### 4) `java_manager/` (runtime Java gestionado por launcher)

No depender del Java del sistema.

- Fuente recomendada (Temurin/Adoptium):
  - `https://api.adoptium.net/v3/assets/latest/{version}/hotspot`
- Ejemplo Java 17 (Windows x64 JRE):
  - `https://api.adoptium.net/v3/assets/latest/17/hotspot?os=windows&architecture=x64&image_type=jre`
- Destino sugerido:
  - `launcher/java/java-runtime-{major}/`

Matriz mínima de compatibilidad:

- `1.20.5+ -> Java 21`
- `1.18 a 1.20.4 -> Java 17`
- `<=1.16.5 -> Java 8`

### 5) `auth/` (Microsoft + Minecraft Services)

Flujo oficial en cadena:

- Xbox Live auth
- XSTS
- Minecraft Services

Endpoints Minecraft Services:

- Login con Xbox:
  - `POST https://api.minecraftservices.com/authentication/login_with_xbox`
- Perfil:
  - `GET https://api.minecraftservices.com/minecraft/profile`

### 6) `instance_runner/` (classpath, natives, ejecución)

#### Classpath

Orden recomendado:

1. Todas las libraries
2. Version jar
3. Jar de modloader (si aplica)

Separador por OS:

- Windows: `;`
- Linux/macOS: `:`

#### Natives

- Resolver desde `libraries[].classifiers` (`natives-windows`, `natives-linux`, etc.)
- Aplicar reglas por OS (`rules.os.name`)
- Extraer en: `instances/<id>/natives/`

#### Comando final

```text
java_path
+ jvm_args
+ -Djava.library.path=<natives>
+ -cp <classpath>
+ <mainClass>
+ <gameArgs>
```

### 7) `validator/` (preflight y seguridad de ejecución)

Validaciones críticas antes de lanzar:

- SHA1 correcto de binarios descargados
- Java compatible con la versión objetivo
- `version.json` parseado correctamente
- `classpath` no vacío
- `mainClass` presente
- `accessToken` válido

## Orden absoluto de ejecución (determinístico)

1. Resolver versión
2. Descargar `version.json`
3. Resolver modloader (si aplica)
4. Merge de metadatos (`version.json` base + modloader)
5. Descargar client jar
6. Descargar libraries
7. Descargar assets
8. Resolver Java
9. Extraer natives
10. Construir argumentos
11. Ejecutar
12. Monitorear proceso

## Estructura objetivo de carpetas

```text
Launcher/
 ├─ java/
 ├─ assets/
 ├─ libraries/
 ├─ versions/
 ├─ instances/
 │    └─ survival/
 │         ├─ .minecraft/
 │         ├─ natives/
 │         └─ logs/
 └─ cache/
```

## Capacidades de nivel profesional

- Descargas paralelas con límite de hilos.
- Cache local de SHA1 verificados.
- Reintentos exponenciales por origen.
- Verificación de espacio en disco pre-descarga.
- Resolución de dependencias con DAG.
- Máquina de estados operacional:
  - `RESOLVING`
  - `DOWNLOADING`
  - `VERIFYING`
  - `READY`
  - `RUNNING`
