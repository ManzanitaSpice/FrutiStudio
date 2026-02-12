import { useEffect, useMemo, useState } from "react";

import type { SectionKey } from "../Toolbar";

const targetTitle = "Fruti Launcher";
const chars = "FRUTILAUNCHER0123456789";

interface HomePanelProps {
  onSelectSection: (section: SectionKey) => void;
}

export const HomePanel = ({ onSelectSection }: HomePanelProps) => {
  const [displayTitle, setDisplayTitle] = useState("".padEnd(targetTitle.length, " "));

  useEffect(() => {
    let frame = 0;
    const interval = window.setInterval(() => {
      frame += 1;
      const reveal = Math.min(targetTitle.length, Math.floor(frame / 2));
      const next = targetTitle
        .split("")
        .map((letter, index) => {
          if (letter === " ") {
            return " ";
          }
          if (index < reveal) {
            return letter;
          }
          return chars[Math.floor(Math.random() * chars.length)];
        })
        .join("");
      setDisplayTitle(next);
      if (reveal === targetTitle.length) {
        window.clearInterval(interval);
      }
    }, 65);

    return () => window.clearInterval(interval);
  }, []);

  const menuCards = useMemo(
    () =>
      [
        {
          key: "mis-modpacks",
          title: "Instancias / Mis modpacks",
          text: "Administra y juega tus mundos.",
        },
        {
          key: "features",
          title: "Features",
          text: "Descubre novedades y mejoras del launcher.",
        },
        {
          key: "explorador",
          title: "Explorador",
          text: "Busca mods, modpacks y recursos.",
        },
        {
          key: "servers",
          title: "Servidores",
          text: "Conéctate rápido a tus servidores favoritos.",
        },
        {
          key: "comunidad",
          title: "Comunidad",
          text: "Ve actividad, guías y contenido compartido.",
        },
        {
          key: "configuracion",
          title: "Configuración",
          text: "Personaliza tema, fuente y experiencia.",
        },
      ] as Array<{ key: SectionKey; title: string; text: string }>,
    [],
  );

  return (
    <section className="panel-view home-panel">
      <div className="home-panel__hero">
        <p className="home-panel__kicker">Bienvenido a</p>
        <h1 aria-label={targetTitle}>{displayTitle}</h1>
        <p>
          Todo conectado en una sola experiencia visual: sin cortes bruscos entre
          secciones.
        </p>
      </div>

      <div className="home-panel__menu">
        {menuCards.map((card) => (
          <button
            key={card.key}
            type="button"
            className="home-panel__card"
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
