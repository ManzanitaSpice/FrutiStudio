# Prompt maestro: backend de instancias Minecraft (nivel PrismLauncher/CurseForge)

Este documento formaliza un **prompt operativo** para que una IA (o equipo de backend) implemente y repare el sistema de instancias del launcher con foco en confiabilidad de ejecución.

## Objetivo

Implementar, corregir y endurecer el flujo backend completo de creación, instalación, gestión y arranque de instancias Minecraft para:

- Vanilla
- Fabric
- Forge
- NeoForge
- Quilt
- Modpacks (CurseForge/Modrinth)

El resultado esperado es que una instancia creada desde el launcher llegue al menú principal sin intervención manual en los casos compatibles.

---

## Prompt maestro (listo para copiar)

```text
Eres un ingeniero backend experto en Minecraft Launchers, con conocimiento profundo del código de PrismLauncher, CurseForge Launcher y el launcher oficial de Mojang.

Tu tarea es diagnosticar, corregir e implementar el flujo completo de instancias en nuestro launcher desarrollado en Rust + Tauri, asegurando compatibilidad total con Minecraft Vanilla, Fabric, Forge, NeoForge, Quilt y modpacks.

Objetivo funcional: todas las instancias deben poder crearse, validarse, repararse y ejecutarse correctamente, con logs útiles y detección de errores accionable.

Sistemas obligatorios:
1) Creación aislada de instancia
2) Descarga de versión base Mojang
3) Generación/fusión robusta de version.json (inheritsFrom)
4) Construcción correcta de classpath
5) Detección automática de Java por versión Minecraft
6) Instalación de Fabric
7) Instalación de Quilt
8) Instalación de Forge (installer + processors + patches)
9) Instalación de NeoForge (installer + processors + patches)
10) Gestión de mods
11) Resolución automática de dependencias de mods
12) Importación de modpacks CurseForge/Modrinth
13) Gestión de shaders
14) Gestión de resourcepacks
15) Auth Microsoft + modo offline
16) Ejecución (expansión de variables, args, logs)
17) Debug + autorreparación

Reglas críticas:
- Nunca depender de .minecraft global para datos de instancia.
- Respetar y fusionar correctamente inheritsFrom.
- Classpath con separador por OS y rutas válidas.
- Forge/NeoForge no se instala copiando librerías; ejecutar installer/processors.
- Verificar hashes (SHA1) para assets/libs.
- Detectar Java recomendado: <=1.16 -> Java 8; >=1.17 -> Java 17; >=1.20.5 -> Java 21.

Validación automática mínima:
- Crear y arrancar instancia Vanilla funcional.
- Crear y arrancar instancia Fabric funcional.
- Crear y arrancar instancia Forge funcional.
- Crear y arrancar instancia NeoForge funcional.
- Crear y arrancar instancia Quilt funcional.
- Ejecutar al menos un modpack real (CurseForge o Modrinth).

Cuando detectes errores:
- version.json roto -> regenerar
- classpath inválido -> reconstruir
- Java incorrecto -> reasignar runtime
- assets/libraries incompletos -> re-descargar
- processors no ejecutados -> ejecutar instalación oficial
- inheritsFrom ignorado -> rehacer merge
- mods incompatibles -> alertar y sugerir corrección

Entrega esperada:
- Código backend modular en Rust
- Logs estructurados por etapa
- Reporte de validación por instancia
- Modo “repair” para autorreparación de fallos frecuentes
```

---

## Flujos backend por sistema

### 1) Creación de instancia

1. Crear carpeta raíz de instancia.
2. Escribir `instance.cfg` o metadato equivalente.
3. Crear subcarpetas mínimas:
   - `minecraft/`
   - `mods/`
   - `resourcepacks/`
   - `shaderpacks/`
   - `libraries/`
   - `assets/`
4. Verificar permisos de lectura/escritura.
5. Registrar metadata en JSON/DB.

### 2) Descarga de Minecraft Vanilla

1. Descargar `version_manifest.json`.
2. Resolver versión objetivo.
3. Descargar `version.json`.
4. Descargar `client.jar`.
5. Descargar librerías filtradas por reglas de OS/arch.
6. Descargar y extraer `natives` según plataforma.
7. Descargar assets por `assetIndex`.
8. Validar SHA1.

### 3) `version.json` robusto

1. Cargar JSON base Mojang.
2. Si hay loader, resolver JSON loader.
3. Si existe `inheritsFrom`, fusionar cadena completa de herencia.
4. Unificar `arguments.jvm`, `arguments.game`, `mainClass`, `libraries`, `logging`.
5. Persistir versión final de ejecución.

### 4) Classpath (crítico)

1. Recolectar librerías válidas por reglas.
2. Agregar `client.jar`.
3. Agregar jars del loader.
4. Concatenar con `;` en Windows, `:` en Linux/macOS.
5. Validar existencia de cada entrada antes de ejecutar.

### 5) Java runtime

- Política mínima:
  - `<= 1.16` -> Java 8
  - `>= 1.17` -> Java 17
  - `>= 1.20.5` -> Java 21
- Flujo:
  1. Descubrir runtimes instalados.
  2. Ejecutar `java -version` para cada candidato.
  3. Detectar arquitectura y compatibilidad.
  4. Seleccionar runtime por versión MC + loader.

### 6) Fabric

1. Consultar metadata oficial Fabric.
2. Resolver versión de loader + intermediary.
3. Generar perfil con herencia sobre Vanilla.
4. Fusionar JSON final.
5. Validar `mainClass` y librerías.

### 7) Quilt

1. Resolver quilt-loader desde metadata oficial.
2. Generar perfil heredado.
3. Instalar librerías adicionales (QSL cuando aplique).
4. Validar classpath final.

### 8) Forge

1. Descargar `forge-installer.jar`.
2. Ejecutar `--installClient`.
3. Ejecutar processors/parches requeridos.
4. Validar `version.json` generado y librerías Maven.
5. Confirmar artefactos finales de arranque.

### 9) NeoForge

1. Descargar installer oficial.
2. Ejecutar instalación cliente.
3. Ejecutar processors/parches.
4. Validar perfil final y librerías.

### 10) Mods

1. Escanear `mods/`.
2. Leer metadatos (`fabric.mod.json`, `mods.toml`, etc.).
3. Detectar loader objetivo.
4. Bloquear o advertir incompatibilidades.

### 11) Dependencias de mods

1. Construir grafo de dependencias.
2. Buscar faltantes en Modrinth/CurseForge.
3. Descargar versión compatible con loader + MC.
4. Revalidar grafo y conflictos.

### 12) Modpacks

1. Leer `manifest.json` (CF/MR).
2. Resolver versión MC + loader.
3. Crear instancia limpia.
4. Descargar mods listados.
5. Aplicar `overrides/`.
6. Validar integridad.

### 13) Shaders

1. Detectar `shaderpacks/`.
2. Verificar presencia de Iris/OptiFine/Oculus según loader.
3. Instalar faltantes sugeridos.
4. Validar compatibilidad de versión.

### 14) Resourcepacks

1. Descargar ZIP.
2. Validar `pack.mcmeta`.
3. Copiar a `resourcepacks/`.
4. Actualizar configuración si aplica.

### 15) Auth

1. Login Microsoft OAuth.
2. Persistencia segura de tokens.
3. Refresh automático.
4. Fallback offline controlado.

### 16) Ejecución

1. Verificar integridad de instancia.
2. Construir comando JVM.
3. Expandir placeholders `${...}`.
4. Ejecutar `mainClass` correcta.
5. Capturar `stdout/stderr` y persistir logs.

### 17) Debug + autorreparación

1. Detectar crash y parsear `latest.log`.
2. Clasificar causa: libs/assets/java/mods/loader.
3. Aplicar reparación automática.
4. Reintentar ejecución con límite de intentos.

---

## Lista de verificación de implementación

- [ ] Instancias aisladas sin dependencia de `.minecraft` global.
- [ ] Merge de `inheritsFrom` probado con múltiples niveles.
- [ ] Classpath validado por OS.
- [ ] Resolución de Java por versión MC implementada.
- [ ] Instalación real de Forge/NeoForge vía installer/processors.
- [ ] Validación SHA1 de assets/libs.
- [ ] Grafo de dependencias de mods + resolución automática.
- [ ] Importador de modpacks CF/MR con overrides.
- [ ] Logs estructurados por etapa.
- [ ] Modo `repair` ejecutable desde backend.

---

## Criterio de aceptación

Se considera exitoso cuando el launcher puede crear y ejecutar sin crash (hasta menú principal) instancias representativas de Vanilla, Fabric, Forge, NeoForge y Quilt, incluyendo al menos un modpack real importado, con validación y trazabilidad de errores.
