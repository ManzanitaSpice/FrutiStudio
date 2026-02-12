export const fontFamilyMap = {
  inter: '"Inter", "Segoe UI", system-ui, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  poppins: '"Poppins", "Inter", "Segoe UI", system-ui, sans-serif',
  jetbrains: '"JetBrains Mono", "Fira Code", "Cascadia Mono", monospace',
  fira: '"Fira Sans", "Inter", "Segoe UI", system-ui, sans-serif',
  rajdhani: '"Rajdhani", "Inter", "Segoe UI", system-ui, sans-serif',
} as const;

export type FontFamilyOption = keyof typeof fontFamilyMap;

export const normalizeFontFamily = (
  value: string | null | undefined,
): FontFamilyOption => {
  if (!value) {
    return "inter";
  }
  return value in fontFamilyMap ? (value as FontFamilyOption) : "inter";
};
