import { useEffect } from "react";

interface ZoomOptions {
  scale: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export const useUiZoom = ({
  scale,
  onChange,
  min = 0.6,
  max = 1.8,
  step = 0.08,
}: ZoomOptions) => {
  useEffect(() => {
    const handleZoom = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const nextScale = Math.min(
        max,
        Math.max(min, scale + (event.deltaY > 0 ? -step : step)),
      );
      onChange(Number(nextScale.toFixed(2)));
    };

    window.addEventListener("wheel", handleZoom, { passive: false });
    return () => window.removeEventListener("wheel", handleZoom);
  }, [max, min, onChange, scale, step]);
};
