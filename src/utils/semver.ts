const parse = (version: string) =>
  version
    .split(".")
    .map((part) => Number.parseInt(part.replace(/\D/g, ""), 10) || 0);

export const compareSemver = (a: string, b: string) => {
  const partsA = parse(a);
  const partsB = parse(b);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
};

export const shouldUpdate = (current: string, latest: string) =>
  compareSemver(current, latest) < 0;
