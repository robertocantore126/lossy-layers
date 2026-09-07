import type { Filter } from './types';

const filters: Filter[] = [];

export function registerFilter(f: Filter): void {
  if (filters.some((x) => x.id === f.id)) {
    throw new Error(`duplicate filter id: ${f.id}`);
  }
  filters.push(f);
}

export function allFilters(): readonly Filter[] {
  return filters;
}

export function getFilter(id: string): Filter | null {
  return filters.find((f) => f.id === id) ?? null;
}

export function filterGroups(): { group: string; items: Filter[] }[] {
  const out: { group: string; items: Filter[] }[] = [];
  for (const f of filters) {
    let g = out.find((x) => x.group === f.group);
    if (!g) {
      g = { group: f.group, items: [] };
      out.push(g);
    }
    g.items.push(f);
  }
  return out;
}
