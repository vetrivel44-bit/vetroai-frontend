/**
 * dataNormalizer.js
 * Robust utility for cleaning and validating AI-generated datasets for visualization.
 */

export const normalizeDataset = (raw) => {
  if (!Array.isArray(raw)) return [];

  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') return null;

    // 1. Resolve Label
    let label = item.label || item.name || item.category || item.title || item.x;
    if (!label) {
      // Find the first string property
      const stringProp = Object.entries(item).find(([k, v]) => typeof v === 'string' && k !== 'type');
      label = stringProp ? stringProp[1] : `Item ${index + 1}`;
    }

    // 2. Resolve Value
    let value = item.value || item.amount || item.count || item.score || item.y;
    if (value === undefined) {
      // Find the first numeric property
      const numProp = Object.entries(item).find(([k, v]) => {
        if (typeof v === 'number') return true;
        if (typeof v === 'string' && !isNaN(parseFloat(v.replace(/[^0-9.-]/g, '')))) return true;
        return false;
      });
      value = numProp ? numProp[1] : 0;
    }

    // 3. Clean numeric value (remove %, $, commas)
    if (typeof value === 'string') {
      const cleaned = parseFloat(value.replace(/[^0-9.-]/g, ''));
      value = isNaN(cleaned) ? 0 : cleaned;
    }

    return {
      ...item,
      label: String(label).trim() || `Item ${index + 1}`,
      value: Number(value)
    };
  }).filter(Boolean);
};

export const inferChartType = (data, userIntent = 'auto') => {
  if (userIntent !== 'auto') return userIntent;
  if (!Array.isArray(data) || data.length === 0) return 'bar';

  const count = data.length;

  // Time series detection
  const isTime = data.every(d => 
    /^\d{4}$/.test(d.label) || // Year
    !isNaN(Date.parse(d.label)) || // Date string
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(d.label) // Month
  );
  if (isTime && count > 1) return 'line';

  // Proportions detection (e.g. Sum ~ 100)
  const total = data.reduce((acc, curr) => acc + curr.value, 0);
  if (total >= 95 && total <= 105 && count <= 6) return 'donut';

  // Many items detection
  if (count > 10) return 'area';

  // Default
  return 'bar';
};

export const getColorPalette = (theme = 'dark') => {
  return [
    '#6366F1', // Indigo
    '#10B981', // Emerald
    '#F59E0B', // Amber
    '#EF4444', // Red
    '#8B5CF6', // Violet
    '#EC4899', // Pink
    '#3B82F6', // Blue
    '#14B8A6'  // Teal
  ];
};
