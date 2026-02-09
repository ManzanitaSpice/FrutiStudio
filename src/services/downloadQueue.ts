import { downloadWithHash, type DownloadRequest } from "./downloadService";

type QueueItem = DownloadRequest & { retries?: number };

const queue: QueueItem[] = [];
let running = false;

export const enqueueDownload = async (item: QueueItem) => {
  queue.push(item);
  if (!running) {
    running = true;
    while (queue.length) {
      const next = queue.shift();
      if (!next) {
        continue;
      }
      const retries = next.retries ?? 2;
      let attempt = 0;
      while (attempt <= retries) {
        try {
          await downloadWithHash(next);
          break;
        } catch (error) {
          attempt += 1;
          if (attempt > retries) {
            console.error("Error en descarga", error);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
          }
        }
      }
    }
    running = false;
  }
};
