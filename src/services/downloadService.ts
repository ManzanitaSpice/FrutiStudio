export interface DownloadRequest {
  url: string;
  expectedSha256: string;
}

const bufferToHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const downloadWithHash = async ({
  url,
  expectedSha256,
}: DownloadRequest) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("No se pudo descargar el archivo");
  }
  const data = await response.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hash = bufferToHex(hashBuffer);
  if (hash !== expectedSha256.toLowerCase()) {
    throw new Error("Hash inválido en la descarga");
  }
  return data;
};
