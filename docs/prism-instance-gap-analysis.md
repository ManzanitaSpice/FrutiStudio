# Análisis de brechas para instancias funcionales (referencia PrismLauncher)

Este documento resume qué necesita un launcher para que una instancia de Minecraft sea **ejecutable de extremo a extremo** y cómo queda cubierto en FrutiLauncher.

## Flujo mínimo para una instancia funcional

1. Crear estructura base de instancia (metadata + carpetas de juego).
2. Descargar metadata oficial de versión desde `launchermeta`/`piston-meta`.
3. Descargar `client.jar` de la versión seleccionada.
4. Descargar `asset index` y objetos de assets.
5. Resolver y descargar bibliotecas (`libraries`) + nativos por OS/arquitectura.
6. Resolver Java compatible con la versión MC (8/16/17/21 según versión).
7. Construir `launch-plan.json` y comando final con placeholders de autenticación.
8. Validación preflight de artefactos críticos antes de ejecutar.
9. Lanzamiento del proceso Java con logs stdout/stderr por instancia.

## Estado en FrutiLauncher (implementado)

- **Bootstrap completo en backend Tauri** (`bootstrap_instance_runtime`): descarga versión, assets, librerías y nativos.
- **Preflight obligatorio** en `launch_instance`: valida `launch-plan` y existencia de artefactos antes de arrancar.
- **Repair/reinstall** por comando dedicado (`repair_instance`) para reconstruir runtime.
- **Resolución de Java** por versión de Minecraft (`resolve_java_for_minecraft`).
- **Persistencia del comando de lanzamiento** (`launch-command.txt`) para inspección/debug.

## Brechas típicas frente a Prism y cómo cubrirlas

- **Opciones avanzadas de settings** (carpetas, metadata de mods, dependencias): ahora expuestas en UI y persistidas en config.
- **Descubrimiento Java multi-instalación**: se ajustó para listar *todas* las instalaciones detectadas (no solo una por major).
- **Feedback de arranque**: checklist con barra global y barra por paso para evitar sensación de congelamiento.

## Sobre "iniciar con launcher oficial"

En el ecosistema Java Edition, el requisito real para jugar online es obtener token válido de cuenta Microsoft/Xbox y pasarlo al runtime. Eso se puede hacer:

1. Integrando autenticación MSA en el propio launcher (flujo recomendado).
2. O usando sesiones obtenidas por el launcher oficial (menos robusto y más frágil).

FrutiLauncher ya pasa `username/uuid/accessToken/userType` al plan de lanzamiento; el siguiente paso de producto es endurecer el flujo MSA para que siempre haya sesión válida cuando se quiera jugar online.
