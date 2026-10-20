// The written inventory of what every planned electronics engine needs before it may price
// anything. This is the "real inputs or a written gap" ledger: an input with no sourced row
// in electronics_reference_data is a gap, and `requiredSource` says what would close it.
// It is requirements only. No value lives here; values are rows with a source and a status.

export interface EngineInput {
  /** electronics_reference_data.key */
  key: string;
  unit: string;
  /** What real data would close the gap: a datasheet figure, an EMS line measurement, ... */
  requiredSource: string;
}

export interface PlannedEngine {
  id: string;
  label: string;
  family: 'pcba' | 'harness';
  inputs: EngineInput[];
}

const datasheet = (what: string) => `${what}: machine datasheet (ideally IPC-9850 rated) or EMS partner line data`;
const measured = (what: string) => `${what}: measured on a partner EMS or harness shop line, with the shop and date`;

export const PLANNED_ENGINES: readonly PlannedEngine[] = [
  {
    id: 'stencil_print_spi',
    label: 'Stencil print + SPI',
    family: 'pcba',
    inputs: [
      { key: 'stencil_print.cycle_time', unit: 's/panel', requiredSource: datasheet('Printer cycle time per panel') },
      { key: 'spi.cycle_time', unit: 's/panel', requiredSource: datasheet('SPI cycle time per panel') },
    ],
  },
  {
    id: 'pick_and_place',
    label: 'Pick and place',
    family: 'pcba',
    inputs: [
      { key: 'smt_placement.rated_cph', unit: 'placements/h', requiredSource: datasheet('Rated placements per hour per machine') },
      { key: 'smt_placement.cph_derating', unit: 'ratio, per package class', requiredSource: measured('Effective CPH derating per package class') },
    ],
  },
  {
    id: 'reflow',
    label: 'Reflow',
    family: 'pcba',
    inputs: [{ key: 'reflow.conveyor_speed', unit: 'mm/min', requiredSource: datasheet('Oven conveyor speed per thermal profile and zone count') }],
  },
  {
    id: 'aoi',
    label: 'AOI (post-reflow)',
    family: 'pcba',
    inputs: [{ key: 'aoi.inspection_speed', unit: 'mm2/s', requiredSource: datasheet('Assembly AOI inspection rate') }],
  },
  {
    id: 'xray',
    label: 'X-ray sampling',
    family: 'pcba',
    inputs: [{ key: 'xray.inspection_time', unit: 's/location', requiredSource: measured('X-ray inspection time per BGA/QFN location') }],
  },
  {
    id: 'tht_insertion',
    label: 'THT insertion (manual)',
    family: 'pcba',
    inputs: [{ key: 'tht_insertion.time_per_part', unit: 's/part, per lead type', requiredSource: measured('Manual insertion time per lead type') }],
  },
  {
    id: 'solder',
    label: 'Selective / wave / hand solder',
    family: 'pcba',
    inputs: [
      { key: 'solder.time_per_joint', unit: 's/joint', requiredSource: measured('Selective and hand solder time per joint') },
      { key: 'wave_solder.pallet_pass_time', unit: 's/pallet', requiredSource: datasheet('Wave solder conveyor speed and pallet pitch') },
      { key: 'wave_solder.pallet_cost', unit: 'currency/pallet', requiredSource: 'Wave pallet price: supplier quote' },
    ],
  },
  {
    id: 'wash_coat_potting',
    label: 'Wash, coat, potting',
    family: 'pcba',
    inputs: [
      { key: 'coat.rate', unit: 'mm2/s', requiredSource: measured('Conformal coat application rate') },
      { key: 'potting.fill_rate', unit: 'ml/s', requiredSource: measured('Potting dispense rate') },
    ],
  },
  {
    id: 'test_ict',
    label: 'In-circuit test (bed of nails)',
    family: 'pcba',
    inputs: [
      { key: 'test_ict.time_per_test_point', unit: 's/test point', requiredSource: measured('ICT test time per test point') },
      { key: 'test_ict.fixture_nre', unit: 'currency', requiredSource: 'ICT fixture price: supplier quote' },
    ],
  },
  {
    id: 'test_flying_probe',
    label: 'Flying probe test',
    family: 'pcba',
    inputs: [{ key: 'test_flying_probe.measurement_speed', unit: 'cycles/s', requiredSource: datasheet('Flying-probe measurement rate on assembled boards') }],
  },
  {
    id: 'test_fct',
    label: 'Functional test',
    family: 'pcba',
    inputs: [{ key: 'test_fct.time_per_step', unit: 's/step', requiredSource: measured('Functional test time per test step') }],
  },
  {
    id: 'depanel',
    label: 'Depanel (router / V-score)',
    family: 'pcba',
    inputs: [
      { key: 'depanel_router.cutting_speed', unit: 'mm/s', requiredSource: datasheet('Depaneling router feed rate on assembled boards') },
      { key: 'depanel_vscore.feed_speed', unit: 'mm/s', requiredSource: datasheet('V-score cutter feed rate') },
    ],
  },
  {
    id: 'pcba_setup',
    label: 'Line setup',
    family: 'pcba',
    inputs: [
      { key: 'setup.line_changeover', unit: 'min', requiredSource: measured('SMT line changeover time') },
      { key: 'setup.feeder_load', unit: 'min/feeder', requiredSource: measured('Feeder load time per unique part') },
    ],
  },
  {
    id: 'harness_cut_strip',
    label: 'Wire cut and strip',
    family: 'harness',
    inputs: [{ key: 'harness_cut_strip.cycle_time', unit: 's/circuit, by gauge and length', requiredSource: datasheet('Cut and strip machine cycle time') }],
  },
  {
    id: 'harness_crimp',
    label: 'Crimp',
    family: 'harness',
    inputs: [
      { key: 'harness_crimp.cycle_time', unit: 's/terminal', requiredSource: datasheet('Crimp press cycle time, automatic and bench') },
      { key: 'harness_crimp.applicator_nre', unit: 'currency', requiredSource: 'Applicator price: supplier quote' },
    ],
  },
  {
    id: 'harness_seal_insert',
    label: 'Seal fitting and connector insertion',
    family: 'harness',
    inputs: [
      { key: 'harness_seal.fit_time', unit: 's/seal', requiredSource: measured('Seal fitting time') },
      { key: 'harness_connector.insert_time', unit: 's/cavity', requiredSource: measured('Connector cavity insertion time') },
    ],
  },
  {
    id: 'harness_sleeve_grommet',
    label: 'Sleeve, heat-shrink, grommet, tape',
    family: 'harness',
    inputs: [
      { key: 'harness_sleeve.fit_time', unit: 's/cm', requiredSource: measured('Sleeve fitting and shrink time per cm') },
      { key: 'harness_grommet.fit_time', unit: 's/grommet', requiredSource: measured('Grommet fitting time') },
    ],
  },
  {
    id: 'harness_splice_label',
    label: 'Splice and label',
    family: 'harness',
    inputs: [
      { key: 'harness_splice.cycle_time', unit: 's/splice', requiredSource: measured('Splice time') },
      { key: 'harness_label.apply_time', unit: 's/label', requiredSource: measured('Label application time') },
    ],
  },
  {
    id: 'harness_test',
    label: 'Continuity test',
    family: 'harness',
    inputs: [
      { key: 'harness_test.time_per_circuit', unit: 's/circuit', requiredSource: measured('Continuity test time per circuit') },
      { key: 'harness_test.board_nre', unit: 'currency', requiredSource: 'Harness test board price: supplier quote' },
    ],
  },
];
