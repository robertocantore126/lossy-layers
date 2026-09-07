import type { Tool } from './types';

const tools: Tool[] = [];

export function registerTool(t: Tool): void {
  if (tools.some((x) => x.id === t.id)) {
    throw new Error(`duplicate tool id: ${t.id}`);
  }
  tools.push(t);
}

export function allTools(): readonly Tool[] {
  return tools;
}

export function getTool(id: string): Tool | null {
  return tools.find((t) => t.id === id) ?? null;
}

export function toolForShortcut(key: string): Tool | null {
  const k = key.toLowerCase();
  return tools.find((t) => t.shortcut?.toLowerCase() === k) ?? null;
}
