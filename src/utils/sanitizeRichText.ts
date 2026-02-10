const ALLOWED_TAGS = new Set([
  "div",
  "p",
  "h1",
  "h2",
  "h3",
  "a",
  "img",
  "ul",
  "li",
  "strong",
  "em",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel"]),
  img: new Set(["src", "alt", "title"]),
};

const isUnsafeUrl = (value: string) => /^(javascript|data):/i.test(value.trim());

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeMarkdownInline = (line: string) => {
  let html = escapeHtml(line);
  html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" />');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<em>$1</em>");
  return html;
};

const parseMarkdownToHtml = (raw: string) => {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.join("")}</ul>`);
    listItems = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = Math.min(6, headingMatch[1].length);
      blocks.push(`<h${level}>${normalizeMarkdownInline(headingMatch[2])}</h${level}>`);
      return;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      listItems.push(`<li>${normalizeMarkdownInline(bulletMatch[1])}</li>`);
      return;
    }

    flushList();
    blocks.push(`<p>${normalizeMarkdownInline(trimmed)}</p>`);
  });

  flushList();
  return blocks.join("\n");
};

const hasMarkdownSyntax = (value: string) =>
  /(^|\n)#{1,6}\s|\[[^\]]+\]\([^\)]+\)|!\[[^\]]*\]\([^\)]+\)/m.test(value);

const hasHtmlSyntax = (value: string) => /<\s*(div|img|h[1-6]|p|a|ul|ol|li|br)\b/i.test(value);

const sanitizeElement = (node: Element) => {
  const tag = node.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    const text = node.ownerDocument.createTextNode(node.textContent ?? "");
    node.replaceWith(text);
    return;
  }

  Array.from(node.attributes).forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;
    const allowed = ALLOWED_ATTRS[tag]?.has(name) ?? false;
    if (!allowed || name === "style" || name.startsWith("on")) {
      node.removeAttribute(attribute.name);
      return;
    }

    if ((name === "href" || name === "src") && isUnsafeUrl(value)) {
      node.removeAttribute(attribute.name);
    }
  });

  if (tag === "a") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
};

export const sanitizeLauncherHtml = (raw: string): string => {
  const normalized = raw?.trim() ?? "";
  if (!normalized) {
    return "<p>Sin descripción.</p>";
  }

  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return `<p>${normalized.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${normalized}</div>`, "text/html");
  const nodes = Array.from(doc.body.querySelectorAll("*"));
  nodes.forEach((node) => sanitizeElement(node));

  const html = doc.body.innerHTML.trim();
  return html.length ? html : "<p>Sin descripción.</p>";
};

export const parseAndSanitizeRichText = (raw: string): string => {
  const normalized = raw?.trim() ?? "";
  if (!normalized) {
    return sanitizeLauncherHtml(normalized);
  }

  if (hasMarkdownSyntax(normalized) && !hasHtmlSyntax(normalized)) {
    return sanitizeLauncherHtml(parseMarkdownToHtml(normalized));
  }

  return sanitizeLauncherHtml(normalized);
};
