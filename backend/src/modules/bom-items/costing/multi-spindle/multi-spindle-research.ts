// What memory/Multi-Spindle Maching and memory/Machining do not hold for Multi-Spindle Machining, from web research (2026-11-20).

/**
 * The cycle of a multi-spindle: every station cuts at once, so one part comes off per index and the cycle is set by the slowest station, plus
 * the index; long operations are split across stations to balance them.
 */
export const MULTI_SPINDLE_CYCLE_SOURCE = 'A multi-spindle\'s cycle is its longest station plus the index; long operations are split across stations '
  + '(Production Machining, "Cam-driven lathe questions"; MMS, "Can this new CNC multispindle work for your shop?" and "When four spindles make '
  + 'sense"; American Machinist, "Seeing multiple"; SME, "One spindle, two spindles, three spindles, more")';

/**
 * The bar end a bar feeder cannot use: the remnant left when the bar no longer reaches the stop, typically 2 to 6 in (50 to 150 mm), with no
 * builder standard (Production Machining, "Bar feeder basics"; US patent 3,147,653, stock feeding apparatus). The conservative end of the
 * range is taken: 6 in.
 */
export const BAR_REMNANT_MM = 152.4;
export const BAR_REMNANT_SOURCE = 'Bar end the feeder cannot use: 2-6 in is typical, 6 in taken (Production Machining, "Bar feeder basics"; US 3,147,653)';
