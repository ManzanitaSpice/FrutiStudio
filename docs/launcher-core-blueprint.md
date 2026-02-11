# Launcher Core Blueprint (Rust)

Este documento define el flujo determinístico y la separación modular del core del launcher, desacoplado completamente de la UI.

## Módulos del core

```text
src-tauri/src/core/
 ├─ auth/
 ├─ version_resolver/
 ├─ java_manager/
 ├─ modloader_resolver/
 ├─ downloader/
 ├─ instance_runner/
 └─ validator/
```

Cada módulo mantiene contratos (`trait`) y modelos propios para permitir pruebas aisladas y reemplazo de implementación.

## Fuentes oficiales

- Manifest global Mojang: `https://launchermeta.mojang.com/mc/game/version_manifest_v2.json`
- Libraries Mojang: `https://libraries.minecraft.net`
- Assets Mojang: `https://resources.download.minecraft.net`
- Fabric meta API: `https://meta.fabricmc.net/v2`
- Quilt meta API: `https://meta.quiltmc.org/v3`
- Forge Maven: `https://maven.minecraftforge.net`
- NeoForge Maven: `https://maven.neoforged.net/releases`
- Adoptium API: `https://api.adoptium.net/v3/assets/latest`
- Minecraft Services: `https://api.minecraftservices.com`

## Flujo absoluto de ejecución

1. Resolver versión
2. Descargar `version.json`
3. Resolver modloader
4. Merge de `version.json` (si aplica)
5. Descargar client jar
6. Descargar libraries
7. Descargar assets
8. Resolver Java
9. Extraer natives
10. Construir args
11. Ejecutar
12. Monitorear runtime

## Estados del pipeline

- `RESOLVING`
- `DOWNLOADING`
- `VERIFYING`
- `READY`
- `RUNNING`

## Validaciones críticas pre-launch

- SHA1 válido para artefactos
- Runtime Java compatible con versión de Minecraft
- `version.json` parseado correctamente
- Classpath no vacío
- `mainClass` presente
- `accessToken` válido

## Estructura de carpetas objetivo

```text
Launcher/
 ├─ java/
 ├─ assets/
 ├─ libraries/
 ├─ versions/
 ├─ instances/
 │    └─ <instance>/
 │         ├─ .minecraft/
 │         ├─ natives/
 │         └─ logs/
 └─ cache/
```

## Requisitos de nivel profesional

- Descarga paralela con límite de threads
- Caché de SHA1
- Reintentos exponenciales
- Verificación de espacio en disco
- Resolución de dependencias estilo DAG
