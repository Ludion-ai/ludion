import { formatCents } from "@shared/money";

export function priceBadge(cents: number): string {
  return `<span class="price">${formatCents(cents)}</span>`;
}
