import { useEffect, useMemo, useState } from "react";

import type { SectionKey } from "../Toolbar";

const targetTitle = "FRUTI LAUNCHER";
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

export const HomePanel = ({ onSelectSection }: HomePanelProps) => {
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

  const menuCards = useMemo(
    () =>
      [
        {
          key: "mis-modpacks",
          title: "Instancias / Mis modpacks",
          text: "Crea, organiza y lanza tus perfiles con un clic.",
        },
        {
          key: "features",
          title: "Features",
          text: "Novedades del launcher, mejoras y cambios recientes.",
        },
        {
          key: "explorador",
          title: "Explorador",
          text: "Descubre mods, modpacks, recursos y contenido útil.",
        },
        {
          key: "servers",
          title: "Servidores",
          text: "Conexión rápida, estado y acceso directo a tus servidores.",
        },
        {
          key: "comunidad",
          title: "Comunidad",
          text: "Guías, actividad y contenido compartido por jugadores.",
        },
        {
          key: "configuracion",
          title: "Configuración",
          text: "Ajusta tema, fuente, rendimiento y comportamiento general.",
        },
      ] as Array<{ key: SectionKey; title: string; text: string }>,
    [],
  );

  return (
    <section className="panel-view home-panel">
      <div className="home-panel__hero">
        <p className="home-panel__kicker">Menú principal</p>
        <div className="home-panel__flap" aria-label="Fruti Launcher">
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
        <p>
          Todo en una sola experiencia visual continua: transiciones suaves, misma
          atmósfera, secciones conectadas.
        </p>
      </div>

      <div className="home-panel__menu">
        {menuCards.map((card, index) => (
          <button
            key={card.key}
            type="button"
            className="home-panel__card"
            style={{ animationDelay: `${index * 0.05}s` }}
            onClick={() => onSelectSection(card.key)}
          >
            <strong>{card.title}</strong>
            <span>{card.text}</span>
          </button>
        ))}
      </div>
    </section>
  );
};
