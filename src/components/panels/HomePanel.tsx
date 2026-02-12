import { useCallback, useEffect, useRef, useState } from "react";

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
  const [animationFinished, setAnimationFinished] = useState(false);
  const intervalsRef = useRef<number[]>([]);

  const clearAnimationIntervals = useCallback(() => {
    intervalsRef.current.forEach((interval) => window.clearInterval(interval));
    intervalsRef.current = [];
  }, []);

  const runFlapAnimation = useCallback(() => {
    clearAnimationIntervals();
    setAnimationFinished(false);
    setGlyphs(buildInitialGlyphs());

    targetTitle.split("").forEach((char, index) => {
      if (char === " ") {
        return;
      }

      let ticks = 0;
      const settleAfter = 12 + index * 3;
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
          intervalsRef.current = intervalsRef.current.filter((item) => item !== interval);
          if (index === targetTitle.length - 1) {
            setAnimationFinished(true);
          }
        }
      }, 82);

      intervalsRef.current.push(interval);
    });
  }, [clearAnimationIntervals]);

  useEffect(() => {
    runFlapAnimation();

    return () => {
      clearAnimationIntervals();
    };
  }, [clearAnimationIntervals, runFlapAnimation]);

  return (
    <section className="panel-view home-panel">
      <div className="home-panel__hero">
        <div
          className={
            animationFinished
              ? "home-panel__flap is-animation-finished"
              : "home-panel__flap"
          }
          aria-label="Interface"
          onMouseEnter={runFlapAnimation}
        >
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
      </div>
    </section>
  );
};
