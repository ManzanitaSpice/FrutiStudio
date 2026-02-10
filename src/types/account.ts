export type AccountType = "msa" | "offline";
export type AccountStatus = "ready" | "expired" | "error" | "loading";

export interface AccountSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface LauncherAccount {
  id: string;
  type: AccountType;
  username: string;
  uuid: string;
  status: AccountStatus;
  avatarUrl?: string;
  skinUrl?: string;
  session?: AccountSession;
  errorMessage?: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface AccountStore {
  activeAccountId: string | null;
  accounts: LauncherAccount[];
}
