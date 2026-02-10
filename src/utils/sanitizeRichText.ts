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
