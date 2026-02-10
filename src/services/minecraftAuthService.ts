import type { LauncherAccount } from "../types/account";

const MSA_CLIENT_ID = (import.meta.env.VITE_MSA_CLIENT_ID as string | undefined)?.trim();
const MSA_SCOPE = "XboxLive.signin offline_access";

interface DeviceCodeResponse {
  user_code: string;
  device_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

const postForm = async <T>(url: string, payload: Record<string, string>) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(payload),
  });
  if (!response.ok) {
    throw new Error(`Error OAuth (${response.status})`);
  }
  return response.json() as Promise<T>;
};

const postJson = async <T>(url: string, payload: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Error API (${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
};

export const startMicrosoftDeviceLogin = async () => {
  if (!MSA_CLIENT_ID) {
    throw new Error("Falta VITE_MSA_CLIENT_ID para iniciar login real de Microsoft.");
  }

  const device = await postForm<DeviceCodeResponse>(
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode",
    {
      client_id: MSA_CLIENT_ID,
      scope: MSA_SCOPE,
    },
  );

  window.open(device.verification_uri, "_blank", "noopener,noreferrer");
  return device;
};

const exchangeDeviceCode = async (deviceCode: string) => {
  if (!MSA_CLIENT_ID) throw new Error("MSA client id no configurado");

  return postForm<TokenResponse>(
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: MSA_CLIENT_ID,
      device_code: deviceCode,
    },
  );
};

const pollMicrosoftToken = async (device: DeviceCodeResponse): Promise<TokenResponse> => {
  const expiresAt = Date.now() + device.expires_in * 1000;
  while (Date.now() < expiresAt) {
    try {
      return await exchangeDeviceCode(device.device_code);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("authorization_pending")) {
        throw error;
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, Math.max(2, device.interval) * 1000));
  }
  throw new Error("Tiempo de espera agotado durante login Microsoft.");
};

const authenticateXbox = async (msaToken: string) => {
  const auth = await postJson<{ Token: string; DisplayClaims: { xui: Array<{ uhs: string }> } }>(
    "https://user.auth.xboxlive.com/user/authenticate",
    {
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${msaToken}`,
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
    },
  );

  const xsts = await postJson<{ Token: string; DisplayClaims: { xui: Array<{ uhs: string }> } }>(
    "https://xsts.auth.xboxlive.com/xsts/authorize",
    {
      Properties: {
        SandboxId: "RETAIL",
        UserTokens: [auth.Token],
      },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT",
    },
  );

  return { xstsToken: xsts.Token, uhs: xsts.DisplayClaims.xui[0]?.uhs };
};

const loginMinecraft = async (xstsToken: string, uhs: string) => {
  const response = await postJson<{ access_token: string; expires_in: number }>(
    "https://api.minecraftservices.com/authentication/login_with_xbox",
    {
      identityToken: `XBL3.0 x=${uhs};${xstsToken}`,
    },
  );
  return response;
};

const fetchMinecraftProfile = async (mcToken: string) => {
  const response = await fetch("https://api.minecraftservices.com/minecraft/profile", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${mcToken}`,
      accept: "application/json",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 404) {
      throw new Error("La cuenta autenticada no tiene perfil de Minecraft Java activo.");
    }
    if (response.status === 401) {
      throw new Error("Token de Minecraft inválido o expirado al consultar /minecraft/profile.");
    }
    throw new Error(`No se pudo obtener perfil Minecraft (${response.status}): ${body}`);
  }
  return response.json() as Promise<{ id: string; name: string }>;
};

export const loginWithMicrosoftDeviceCode = async (): Promise<LauncherAccount> => {
  const device = await startMicrosoftDeviceLogin();
  const msaToken = await pollMicrosoftToken(device);
  const xbox = await authenticateXbox(msaToken.access_token);
  const minecraft = await loginMinecraft(xbox.xstsToken, xbox.uhs);
  const profile = await fetchMinecraftProfile(minecraft.access_token);

  return {
    id: crypto.randomUUID(),
    type: "msa",
    username: profile.name,
    uuid: profile.id,
    status: "ready",
    session: {
      accessToken: minecraft.access_token,
      refreshToken: msaToken.refresh_token,
      expiresAt: Date.now() + minecraft.expires_in * 1000,
    },
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
};
