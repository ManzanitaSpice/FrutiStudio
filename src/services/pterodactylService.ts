import { apiFetch } from "./apiClients/client";

interface PterodactylAccount {
  attributes?: {
    id?: number;
    username?: string;
    email?: string;
    root_admin?: boolean;
  };
}

interface PterodactylEnvelope {
  attributes?: PterodactylAccount["attributes"];
}

export interface PterodactylStatus {
  ok: boolean;
  panelUrl: string;
  username?: string;
  email?: string;
  rootAdmin?: boolean;
  message: string;
}

export const checkPterodactylStatus = async (
  panelUrl: string,
  apiKey: string,
): Promise<PterodactylStatus> => {
  const base = panelUrl.trim().replace(/\/+$/, "");
  const token = apiKey.trim();
  if (!base || !token) {
    return {
      ok: false,
      panelUrl: base,
      message: "Completa URL y API key para validar Pterodactyl.",
    };
  }

  const response = await apiFetch<PterodactylEnvelope>(`${base}/api/client/account`, {
    init: {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
    ttl: 30_000,
  });

  return {
    ok: true,
    panelUrl: base,
    username: response.attributes?.username,
    email: response.attributes?.email,
    rootAdmin: response.attributes?.root_admin,
    message: "Conexión con Pterodactyl activa.",
  };
};
