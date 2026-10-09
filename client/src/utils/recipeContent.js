const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  deg: "°", frac12: "½", frac14: "¼", frac34: "¾", times: "×",
};

// Returns text only. Render it as a React child, never as innerHTML.
export function recipeText(value) {
  return String(value ?? "")
    .replace(/<!--[^]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|ul|ol|h[1-6])\s*>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>|<![^>]*>/gi, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, name) => {
      if (!name.startsWith("#")) return ENTITIES[name.toLowerCase()] ?? entity;
      const codePoint = name[1].toLowerCase() === "x"
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10);
      return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint) : "�";
    })
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n")
    .trim();
}

export function recipeSteps(value) {
  const source = String(value ?? "");
  const listItems = [...source.matchAll(/<li\b[^>]*>([^]*?)<\/li\s*>/gi)];
  return (listItems.length ? listItems.map((item) => recipeText(item[1])) : recipeText(source).split("\n"))
    .map((step) => step.trim()).filter(Boolean);
}

export function ingredientQuantity(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const number = Number(raw);
  return Number.isFinite(number) ? (number > 0 ? String(number) : '') : raw;
}
