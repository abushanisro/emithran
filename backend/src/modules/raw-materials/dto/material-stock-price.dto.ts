// Stock forms and locations, the vocabulary the stock-price table and the edit form share.
// Writes go through the single editor save (raw-material-editor.dto.ts).
export const STOCK_FORMS = [
  'round_bar', 'hex_bar', 'rectangular_bar', 'square_bar', 'round_tube', 'square_tube',
  'rectangular_tube', 'plate', 'angle_bar', 'channel_bar', 'i_beam', 't_beam', 'sheet',
] as const;
export const STOCK_LOCATIONS = ['USA', 'India'] as const;
