// Build a bounded window without allocating the full result-page count.
export function paginationPages(page, totalPages) {
  if (!Number.isSafeInteger(totalPages) || totalPages < 1) return [];
  const current = Number.isSafeInteger(page) ? Math.min(totalPages, Math.max(1, page)) : 1;
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages]);
  for (let value = Math.max(1, current - 1); value <= Math.min(totalPages, current + 1); value++) pages.add(value);
  if (current <= 3) { pages.add(2); pages.add(3); }
  if (current >= totalPages - 2) { pages.add(totalPages - 2); pages.add(totalPages - 1); }
  return [...pages].sort((first, second) => first - second);
}
