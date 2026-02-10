import { useMemo, useState } from "react";

type CommunityTag = "Staff" | "Creador" | "Builder" | "Modder" | "Tester";

interface CommunityPost {
  id: string;
  title: string;
  content: string;
  author: string;
  likes: number;
  comments: number;
  tags: CommunityTag[];
  category: "modpack" | "mod" | "debate";
}

const initialPosts: CommunityPost[] = [
  {
    id: "post-1",
    title: "Nuevo modpack técnico 1.20.1",
    content: "Incluye Create, AE2 y sistema de quests. Busco testers para balance final.",
    author: "FrutiDev",
    likes: 42,
    comments: 11,
    tags: ["Creador", "Modder"],
    category: "modpack",
  },
  {
    id: "post-2",
    title: "Pack visual optimizado para low-end",
    content: "Shaders suaves + texturas ligeras para equipos con 8 GB RAM.",
    author: "PixelLuna",
    likes: 27,
    comments: 8,
    tags: ["Builder"],
    category: "mod",
  },
  {
    id: "post-3",
    title: "Guía de jerarquías para comunidades",
    content: "Propuesta base: Admin, Moderador, Curador de mods, Mentor y Miembro.",
    author: "CoreAdmin",
    likes: 15,
    comments: 5,
    tags: ["Staff"],
    category: "debate",
  },
];

const communityTemplates = [
  "Survival Vanilla",
  "Modpacks Técnicos",
  "Creativo y Builds",
  "PvP Competitivo",
];

export const CommunityPanel = () => {
  const [posts, setPosts] = useState(initialPosts);
  const [chatMessage, setChatMessage] = useState("");
  const [composerTitle, setComposerTitle] = useState("");
  const [composerBody, setComposerBody] = useState("");
  const [filter, setFilter] = useState<"all" | CommunityPost["category"]>("all");

  const filteredPosts = useMemo(
    () => posts.filter((post) => filter === "all" || post.category === filter),
    [posts, filter],
  );

  return (
    <section className="panel-view panel-view--community">
      <div className="panel-view__header">
        <div>
          <h2>Comunidad</h2>
          <p>Chat, publicaciones, modpacks, mods y gestión de comunidades en un solo espacio.</p>
        </div>
      </div>

      <div className="community-layout">
        <article className="community-card">
          <h3>Comunidad en vivo</h3>
          <p>Canal general para coordinar servidores, buscar equipo y compartir ideas.</p>
          <div className="community-chat-log" role="log" aria-live="polite">
            <p><strong>[Staff]</strong> CoreAdmin: Bienvenidos al hub de comunidad.</p>
            <p><strong>[Creador]</strong> FrutiDev: Publiqué versión RC del modpack técnico.</p>
            <p><strong>[Tester]</strong> NeoKai: Confirmo compatibilidad con Java 21.</p>
          </div>
          <div className="community-chat-input">
            <input
              type="text"
              placeholder="Escribe un mensaje para el chat..."
              value={chatMessage}
              onChange={(event) => setChatMessage(event.target.value)}
            />
            <button type="button" disabled={!chatMessage.trim()}>
              Enviar
            </button>
          </div>
        </article>

        <article className="community-card">
          <h3>Crear comunidad</h3>
          <p>Base para futuras comunidades conectadas a MySQL (perfiles, modpacks y permisos).</p>
          <div className="community-grid community-grid--small">
            {communityTemplates.map((template) => (
              <button key={template} type="button" className="community-pill">
                + {template}
              </button>
            ))}
          </div>
          <ul className="community-hierarchy">
            <li><strong>Admin:</strong> control global y configuración.</li>
            <li><strong>Moderador:</strong> reportes, tags y seguridad.</li>
            <li><strong>Curador:</strong> validación de mods y modpacks.</li>
            <li><strong>Miembro:</strong> publicaciones, comentarios y likes.</li>
          </ul>
        </article>
      </div>

      <article className="community-card">
        <div className="community-toolbar">
          <h3>Publicaciones de la comunidad</h3>
          <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
            <option value="all">Todo</option>
            <option value="modpack">Modpacks</option>
            <option value="mod">Mods</option>
            <option value="debate">Debates</option>
          </select>
        </div>
        <div className="community-post-form">
          <input
            type="text"
            placeholder="Título de publicación"
            value={composerTitle}
            onChange={(event) => setComposerTitle(event.target.value)}
          />
          <textarea
            placeholder="Comparte tu modpack, mod o una idea para la comunidad..."
            value={composerBody}
            onChange={(event) => setComposerBody(event.target.value)}
            rows={3}
          />
          <button
            type="button"
            disabled={!composerTitle.trim() || !composerBody.trim()}
            onClick={() => {
              setPosts((prev) => [
                {
                  id: crypto.randomUUID(),
                  title: composerTitle.trim(),
                  content: composerBody.trim(),
                  author: "TuUsuario",
                  likes: 0,
                  comments: 0,
                  tags: ["Creador"],
                  category: "debate",
                },
                ...prev,
              ]);
              setComposerTitle("");
              setComposerBody("");
            }}
          >
            Publicar
          </button>
        </div>

        <div className="community-grid">
          {filteredPosts.map((post) => (
            <article key={post.id} className="community-post">
              <header>
                <h4>{post.title}</h4>
                <span>@{post.author}</span>
              </header>
              <p>{post.content}</p>
              <div className="community-tags">
                {post.tags.map((tag) => (
                  <span key={`${post.id}-${tag}`}>{tag}</span>
                ))}
              </div>
              <footer>
                <button type="button">👍 {post.likes}</button>
                <button type="button">💬 {post.comments}</button>
                <button type="button">Compartir</button>
              </footer>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
};
