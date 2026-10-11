import { formatCents } from "@shared/money";

export interface Line { cents: number; qty: number }

export function invoiceTotal(lines: Line[]): number {
  return lines.reduce((sum, l) => sum + l.cents * l.qty, 0);
}

export function invoiceLabel(lines: Line[]): string {
  return `Total ${formatCents(invoiceTotal(lines))}`;
}
