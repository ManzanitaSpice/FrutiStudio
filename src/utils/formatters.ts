export const formatRelativeTime = (value: string) => value;

export const formatPlaytime = (value: string) => value;

export const formatPlaytimeMinutes = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "0 min";
  }
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = Math.floor(minutes % 60);
  const parts = [];
  if (days > 0) {
    parts.push(`${days} d`);
  }
  if (hours > 0) {
    parts.push(`${hours} h`);
  }
  if (mins > 0 || parts.length === 0) {
    parts.push(`${mins} min`);
  }
  return parts.join(" ");
};

export const formatIsoTimestamp = (date = new Date()) =>
  date.toISOString();
