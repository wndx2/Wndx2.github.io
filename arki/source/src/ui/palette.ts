// Curve colours, each tuned for a white and a near-black canvas.
export const PALETTE = [
  { name: 'Blue', light: '#007aff', dark: '#0a84ff' },
  { name: 'Red', light: '#ff3b30', dark: '#ff453a' },
  { name: 'Green', light: '#28a745', dark: '#30d158' },
  { name: 'Orange', light: '#ff9500', dark: '#ff9f0a' },
  { name: 'Purple', light: '#af52de', dark: '#bf5af2' },
  { name: 'Graphite', light: '#2c2c2e', dark: '#e5e5ea' },
];

// A curve's colour is either a palette entry (by index), which adapts to light and
// dark, or a custom hex colour, which is used as given.
export type CurveColor = number | string;

export const colorOf = (color: CurveColor, dark: boolean) => {
  if (typeof color === 'string') return color;
  const entry = PALETTE[color % PALETTE.length];
  return dark ? entry.dark : entry.light;
};

// Reads "#1a2b3c", "1a2b3c" or the short "#abc" form; returns "#rrggbb", or undefined
// if the text isn't a hex colour (yet).
export function parseHex(text: string): string | undefined {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!match) return undefined;
  const digits = match[1].toLowerCase();
  return `#${digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits}`;
}
