export type ModSource = "curseforge" | "modrinth" | "private";

export interface ModCandidate {
  id: string;
  name: string;
  summary?: string;
  source: ModSource;
}

export interface DependencyCandidate {
  id: string;
  source: ModSource;
  required: boolean;
}

export interface DownloadedArtifact {
  fileName: string;
  url: string;
  hash?: string;
}

export interface ContentSearchFilters {
  query: string;
  loader?: string;
  gameVersion?: string;
  tags?: string[];
}

export interface ContentSourceProvider {
  source: ModSource;
  search(filters: ContentSearchFilters): Promise<ModCandidate[]>;
  download(id: string, versionId?: string): Promise<DownloadedArtifact | null>;
  resolveDependencies(id: string, versionId?: string): Promise<DependencyCandidate[]>;
}
