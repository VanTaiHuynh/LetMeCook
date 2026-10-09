export function mergeSearchFields(params, fields) {
  const merged = new URLSearchParams(params);
  merged.delete("prompt");
  if (!merged.get("keyword") && fields.keyword) merged.set("keyword", String(fields.keyword));
  for (const key of ["cuisines", "ingredients", "allergies", "categories", "dietaryPreferences"]) {
    const values = [...merged.getAll(key), ...(Array.isArray(fields[key]) ? fields[key] : [])]
      .map((value) => key === "dietaryPreferences" ? String(value).replaceAll("-", " ") : value);
    const unique = new Map(values.map((value) => String(value).trim()).filter(Boolean)
      .map((value) => [value.toLocaleLowerCase(), value]));
    merged.delete(key);
    for (const value of unique.values()) merged.append(key, value);
  }
  merged.set("page", "0");
  return merged;
}
