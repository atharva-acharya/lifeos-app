const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

/** Formats pence as pounds, e.g. 123456 → "£1,234.56". */
export function pounds(pence: number): string {
  return GBP.format(pence / 100);
}

/** Reads a pounds amount typed by the owner ("12.5", "£1,200") into pence. */
export function toPence(text: string): number | null {
  const clean = text.replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
