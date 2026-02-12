# Investigación de APIs para loaders (Fabric / Forge / NeoForge / Quilt) y estructura `.env`

## Objetivo

Definir **qué APIs debemos usar de forma oficial o estable**, cómo consumirlas para:

1. Resolver versiones correctas de loader por versión de Minecraft.
2. Descargar/instalar loaders en instancias de forma consistente.
3. Manejar claves/API keys (especialmente CurseForge) con una estructura de entorno clara.

---

## 1) APIs recomendadas por loader

## Fabric (oficial)

- **Referencia**: `https://fabricmc.net/develop/`.
- **API base**: `https://meta.fabricmc.net/v2`.
- **Endpoint clave para versiones**:
  - `GET /versions/loader/{minecraft_version}`
- **Uso recomendado**:
  - Tomar la lista y seleccionar la versión más reciente compatible (o respetar pin exacto de modpack).
  - Guardar `minecraft_version + loader_version` en metadata de instancia para reproducibilidad.

**Por qué usarla**: es la fuente oficial del ecosistema Fabric para metadatos de loader/installer.

## Quilt (meta estable)

- **API base**: `https://meta.quiltmc.org/v3`.
- **Endpoint clave**:
  - `GET /versions/loader/{minecraft_version}`
- **Uso recomendado**:
  - Misma estrategia que Fabric: resolver compatibilidad por versión MC y persistir versión de loader.

**Nota**: no usar scraping de páginas web; usar endpoints meta versionados.

## Forge (metadata por promotions + maven)

- **Promotions JSON**:
  - `https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json`
- **Maven metadata (fallback)**:
  - `https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml`
- **Uso recomendado**:
  1. Intentar promotions para recomendaciones `latest/recommended` por MC.
  2. Si falla o no existe mapping, usar metadata de Maven y filtrar por prefijo `mcVersion-`.

## NeoForge (API + maven fallback)

- **API releases**:
  - `https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge`
- **Maven metadata fallback**:
  - `https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml`
- **Uso recomendado**:
  - Resolver canal por versión MC (ej. `1.21.1` -> canal `21.1.x`), filtrar versiones y ordenar numéricamente.

## Mojang (base runtime vanilla requerida)

Aunque no es “loader API”, para instalar correctamente cualquier loader se necesita la base de Minecraft:

- **Version manifest** (global):
  - `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`
- **Version JSON específico**: URL dentro del manifest.
- **Assets index + libraries**: URLs dentro del JSON de versión.

**Uso recomendado**: siempre verificar que el runtime base (jar, libraries, assets) exista e integro antes de aplicar loader.

---

## 2) CurseForge API: qué usar y cómo manejar key

- **Referencia oficial de key**: `https://support.curseforge.com/.../about-the-curseforge-api-and-how-to-apply-for-a-key`.
- **API base**: `https://api.curseforge.com/v1`.
- **Header requerido**: `x-api-key: <tu_key>`.

### Política recomendada

1. **Producción**: usar API oficial con key propia.
2. **Desarrollo/fallback**: permitir proxies configurables cuando no exista key.
3. **No hardcodear keys** en repositorio; usar `.env` + override localStorage si el usuario la cambia desde UI.

---

## 3) Flujo recomendado de instalación de loaders por instancia

1. Resolver `minecraft_version` objetivo.
2. Descargar/verificar runtime base de Minecraft (jar + libraries + assets).
3. Resolver loader version con API oficial por tipo:
   - Fabric/Quilt: endpoint `/versions/loader/{mc}`.
   - Forge/NeoForge: promotions/api + fallback maven metadata.
4. Generar perfil/version JSON de launcher para ese loader.
5. Verificar `mainClass`, classpath y librerías antes de primer launch.
6. Persistir en metadata de instancia:
   - `loaderType`
   - `loaderVersion`
   - `minecraftVersion`
   - fuente/endpoint usado

---

## 4) Estructura `.env` propuesta

Se creó `.env` y `.env.example` con variables para separar claves y endpoints:

- `VITE_MSA_CLIENT_ID`
- `VITE_CURSEFORGE_API_KEY`
- `VITE_CURSEFORGE_API_BASE`
- `VITE_CURSEFORGE_PROXY_BASES`
- `VITE_FABRIC_META_BASE`
- `VITE_QUILT_META_BASE`
- `VITE_FORGE_PROMOTIONS_URL`
- `VITE_FORGE_MAVEN_METADATA_URL`
- `VITE_NEOFORGE_API_URL`
- `VITE_NEOFORGE_MAVEN_METADATA_URL`

Con esto podemos:

- Cambiar endpoints sin tocar código.
- Ejecutar entornos dev/staging/prod con distintas configuraciones.
- Inyectar API keys de forma segura y trazable.

---

## 5) Decisiones implementadas en este repo

1. Se centralizó configuración de APIs en `src/config/api.ts`.
2. Los clientes de CurseForge ahora leen base/proxies desde entorno.
3. La resolución de versiones de loader (Fabric/Quilt/Forge/NeoForge) ahora usa endpoints configurables vía `.env`.
4. La key de CurseForge puede venir de:
   - `localStorage` (si usuario la define en UI), o
   - `VITE_CURSEFORGE_API_KEY` como fallback.

---

## 6) Recomendación operativa final

- Para builds internas: configurar `VITE_CURSEFORGE_API_KEY` y deshabilitar proxies no oficiales.
- Para desarrollo: mantener proxies como fallback, con logs explícitos cuando se usen.
- Agregar validación de startup que bloquee instalaciones loader si falta runtime base o si hay mismatch de versión.
