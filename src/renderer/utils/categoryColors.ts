// Category color palette — avoids green (#34C759), orange (#FF9500), red (#FF3B30)
// which are reserved for availability status indicators
export const CATEGORY_PALETTE = [
  '#007AFF', // blue
  '#5856D6', // purple
  '#AF52DE', // violet
  '#FF2D55', // pink
  '#00C7BE', // teal
  '#5AC8FA', // sky blue
  '#BF5AF2', // magenta
  '#64D2FF', // cyan
  '#A2845E', // brown
  '#30B0C7', // dark teal
];

export function getCategoryColor(
  name: string,
  colors: Record<string, string>,
  categories: string[],
): string {
  if (colors[name]) return colors[name];
  const idx = categories.indexOf(name);
  return CATEGORY_PALETTE[(idx >= 0 ? idx : name.length) % CATEGORY_PALETTE.length];
}

export function categoryTagStyle(color: string): React.CSSProperties {
  return {
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 8,
    background: `${color}40`,
    color: color,
    border: `1px solid ${color}55`,
    display: 'inline-block',
  };
}
