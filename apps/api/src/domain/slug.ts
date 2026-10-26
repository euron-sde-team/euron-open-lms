/** Company slugs: "Northwind Labs, Inc." -> "northwind-labs-inc". 3 to 60 characters. */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `${base || "company"}-co`.slice(0, 56);
}

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
