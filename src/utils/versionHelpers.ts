import type { MinecraftVersion } from "../services/versionService";

export const isVersionCompatible = (
  version: string,
  supportedVersions: string[],
) => supportedVersions.includes(version);

export const filterVersionsByType = (
  versions: MinecraftVersion[],
  type: MinecraftVersion["type"],
) => versions.filter((version) => version.type === type);

export const sortVersionsDesc = (versions: MinecraftVersion[]) =>
  [...versions].sort((a, b) => (a.releaseTime ?? "").localeCompare(b.releaseTime ?? "")).reverse();
