import { useEffect, useState } from "react";

import type { SectionKey } from "../Toolbar";

const targetTitle = "INTERFACE";
const flapGlyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

interface HomePanelProps {
  onSelectSection: (section: SectionKey) => void;
}

interface HeroGlyph {
  id: string;
  value: string;
  settled: boolean;
}

const buildInitialGlyphs = () =>
  targetTitle.split("").map((char, index) => ({
    id: `${char}-${index}`,
    value: char === " " ? " " : flapGlyphs[Math.floor(Math.random() * flapGlyphs.length)],
    settled: char === " ",
  }));

export const HomePanel = ({ onSelectSection: _onSelectSection }: HomePanelProps) => {
  const [glyphs, setGlyphs] = useState<HeroGlyph[]>(() => buildInitialGlyphs());

  useEffect(() => {
    const intervals: number[] = [];

    targetTitle.split("").forEach((char, index) => {
      if (char === " ") {
        return;
      }

      let ticks = 0;
      const settleAfter = 8 + index * 2;
      const interval = window.setInterval(() => {
        ticks += 1;
        setGlyphs((prev) =>
          prev.map((glyph, glyphIndex) => {
            if (glyphIndex !== index) {
              return glyph;
            }
            if (ticks >= settleAfter) {
              return { ...glyph, value: char, settled: true };
            }
            return {
              ...glyph,
              value: flapGlyphs[Math.floor(Math.random() * flapGlyphs.length)],
              settled: false,
            };
          }),
        );

        if (ticks >= settleAfter) {
          window.clearInterval(interval);
        }
      }, 62);

      intervals.push(interval);
    });

    return () => {
      intervals.forEach((interval) => window.clearInterval(interval));
    };
  }, []);


  return (
    <section className="panel-view home-panel">
      <div className="home-panel__hero">
        <p className="home-panel__kicker">Menú principal</p>
        <div className="home-panel__flap" aria-label="Interface">
          {glyphs.map((glyph) => (
            <span
              key={glyph.id}
              className={
                glyph.settled
                  ? "home-panel__flap-cell is-settled"
                  : "home-panel__flap-cell"
              }
            >
              {glyph.value}
            </span>
          ))}
        </div>
        <p>Centro de control principal con navegación por categorías en la barra superior.</p>
      </div>
    </section>
  );
};
