'use strict';

/**
 * The format of memory/Electronics: the assembly reference data (SMT, reflow, line changeover,
 * harness, footprint lookup) the electronics engines are waiting for. Header-only files are valid:
 * the folder is a format, and the values are supplied from outside the repo.
 *
 * Rules that apply to every file:
 *  - every data row carries source_url (http/https) and source_date (a real ISO date, not in the
 *    future); a row without a source is rejected, never accepted as "unknown";
 *  - numbers are plain positive numbers in the unit the column name states;
 *  - package_class comes from the contract vocabulary (ecad-engine/contract/schemas), never free text;
 *  - the footprint lookup is by exact footprint name, one row per name.
 *
 * `inputKeys` ties each file to the engine inputs it can close
 * (backend/src/modules/electronics-costing/domain/reference/engine-inputs.ts); a spec keeps the two in step.
 */

const fs = require('fs');
const path = require('path');

const SOURCE_COLUMNS = [
  { name: 'source_url', type: 'url', required: true },
  { name: 'source_date', type: 'date', required: true },
  { name: 'source_note', type: 'text', required: false },
];

const text = (name, required = false) => ({ name, type: 'text', required });
const positive = (name, required = false) => ({ name, type: 'positive', required });
const integer = (name, required = false) => ({ name, type: 'integer', required });
const nonNegative = (name, required = false) => ({ name, type: 'nonNegative', required });
const oneOf = (name, values, required = false) => ({ name, type: 'enum', values, required });

function packageClasses() {
  const schema = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../ecad-engine/contract/schemas/board_feature_graph.v1.schema.json'), 'utf8'),
  );
  return schema.properties.placements.items.properties.packageClass.enum.filter((c) => c !== 'unknown');
}

const MACHINE_TYPES = ['printer', 'spi', 'placer', 'reflow', 'aoi', 'xray', 'selective_solder', 'wave_solder', 'tester', 'depaneler', 'coater', 'other'];

function fileSpecs() {
  const classes = packageClasses();
  return [
    {
      file: 'smt_placement_rates.csv',
      description: 'Placements per hour by machine and package class',
      inputKeys: ['smt_placement.rated_cph', 'smt_placement.cph_derating'],
      columns: [
        text('machine_name', true), text('manufacturer'), oneOf('package_class', classes, true),
        positive('rated_cph', true), positive('effective_cph'), text('conditions'), ...SOURCE_COLUMNS,
      ],
      uniqueKey: ['machine_name', 'package_class'],
    },
    {
      file: 'smt_machines.csv',
      description: 'Machine economics for the SMT line, in the same columns as the PCBA machine files',
      inputKeys: [],
      columns: [
        text('machine_name', true), oneOf('machine_type', MACHINE_TYPES, true), text('manufacturer'),
        nonNegative('machine_price_usd'), positive('machine_length_mm'), positive('machine_width_mm'),
        nonNegative('machine_power_kw'), nonNegative('number_of_operators'), nonNegative('setup_time_hr'),
        positive('machine_life_yr'), positive('machine_uptime_pct'), ...SOURCE_COLUMNS,
      ],
      uniqueKey: ['machine_name'],
    },
    {
      file: 'reflow_ovens.csv',
      description: 'Reflow oven conveyor speed range by machine',
      inputKeys: ['reflow.conveyor_speed'],
      columns: [
        text('machine_name', true), text('manufacturer'), integer('zones'),
        positive('conveyor_speed_min_mm_per_min', true), positive('conveyor_speed_max_mm_per_min', true),
        positive('max_board_width_mm'), text('profile'), ...SOURCE_COLUMNS,
      ],
      uniqueKey: ['machine_name', 'profile'],
      rules: [
        (row) =>
          Number(row.conveyor_speed_max_mm_per_min) < Number(row.conveyor_speed_min_mm_per_min)
            ? 'conveyor_speed_max_mm_per_min is below conveyor_speed_min_mm_per_min'
            : null,
      ],
    },
    {
      file: 'line_changeover.csv',
      description: 'SMT line changeover and feeder load times',
      inputKeys: ['setup.line_changeover', 'setup.feeder_load'],
      columns: [text('line_description', true), positive('changeover_min', true), positive('feeder_load_min_per_feeder', true), ...SOURCE_COLUMNS],
      uniqueKey: ['line_description'],
    },
    {
      file: 'harness_cut_strip.csv',
      description: 'Wire cut and strip cycle time by machine, gauge and length',
      inputKeys: ['harness_cut_strip.cycle_time'],
      columns: [
        text('machine_name', true), text('manufacturer'), positive('awg_min', true), positive('awg_max', true),
        positive('length_min_mm', true), positive('length_max_mm', true), positive('cycle_time_s', true), ...SOURCE_COLUMNS,
      ],
      uniqueKey: ['machine_name', 'awg_min', 'awg_max', 'length_min_mm', 'length_max_mm'],
      rules: [
        (row) => (Number(row.awg_max) < Number(row.awg_min) ? 'awg_max is below awg_min' : null),
        (row) => (Number(row.length_max_mm) < Number(row.length_min_mm) ? 'length_max_mm is below length_min_mm' : null),
      ],
    },
    {
      file: 'harness_crimp.csv',
      description: 'Crimp cycle time by machine and mode, and applicator price',
      inputKeys: ['harness_crimp.cycle_time', 'harness_crimp.applicator_nre'],
      columns: [
        text('machine_name', true), text('manufacturer'), oneOf('mode', ['automatic', 'bench'], true),
        positive('cycle_time_s', true), nonNegative('applicator_nre'), text('currency'), ...SOURCE_COLUMNS,
      ],
      uniqueKey: ['machine_name', 'mode'],
      rules: [(row) => (row.applicator_nre !== '' && row.currency === '' ? 'currency is required when applicator_nre is given' : null)],
    },
    {
      file: 'gerber_file_roles.csv',
      description: 'File extension to board-file role (Gerber layers, drill data, drill report). Classifies files whose content carries no layer attribute.',
      inputKeys: [],
      columns: [
        text('extension', true),
        oneOf('role', ['copper_top', 'copper_bottom', 'soldermask_top', 'soldermask_bottom', 'silkscreen_top', 'silkscreen_bottom', 'paste_top', 'paste_bottom', 'board_outline', 'pad_master_top', 'pad_master_bottom', 'drill_drawing', 'drill_guide', 'drill_data', 'drill_report'], true),
        oneOf('family', ['gerber', 'excellon', 'report'], true),
        ...SOURCE_COLUMNS,
      ],
      uniqueKey: ['extension'],
      rules: [
        (row) => (row.extension === '' || /^[a-z0-9]{1,5}$/.test(row.extension) ? null : 'extension must be lower case letters and digits only, without the dot'),
        (row) => (row.family === 'excellon' && row.role !== 'drill_data' ? 'an excellon file has the role drill_data' : null),
        (row) => (row.family === 'report' && row.role !== 'drill_report' ? 'a report file has the role drill_report' : null),
      ],
    },
    {
      file: 'placement_layers.csv',
      description: 'Pick Place layer name to board side. Names are matched case-insensitively, whole.',
      inputKeys: [],
      columns: [text('layer_name', true), oneOf('side', ['top', 'bottom'], true), ...SOURCE_COLUMNS],
      uniqueKey: ['layer_name'],
      rules: [(row) => (row.layer_name === row.layer_name.toLowerCase() ? null : 'layer_name is stored in lower case')],
    },
    {
      file: 'package_class_lookup.csv',
      description: 'Exact footprint name to package class (KiCad / IPC-7351 names). A lookup by name, never a pattern.',
      inputKeys: [],
      columns: [
        text('footprint_name', true), oneOf('standard', ['KiCad', 'IPC-7351', 'vendor'], true),
        oneOf('package_class', classes), oneOf('mount_type', ['smd', 'tht', 'mark'], true), integer('pin_count'), ...SOURCE_COLUMNS,
      ],
      uniqueKey: ['footprint_name', 'standard'],
      rules: [
        (row) => (row.mount_type === 'smd' && row.package_class === '' ? 'package_class is required for an smd footprint' : null),
        (row) => (row.mount_type === 'tht' && row.package_class !== '' ? 'a tht footprint has no package_class (through-hole parts are not in the SMT vocabulary)' : null),
        (row) => (row.mount_type === 'mark' && row.package_class !== '' ? 'a mark (fiducial or tooling mark, not a placed part) has no package_class' : null),
      ],
    },
  ];
}

// ---- parsing and checking -------------------------------------------------

function parseCsv(textContent) {
  const source = textContent.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

function isRealIsoDate(value, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value && value <= today;
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

function checkCell(column, value, today) {
  if (value === '') return column.required ? `${column.name} is required` : null;
  switch (column.type) {
    case 'url': return isHttpUrl(value) ? null : `${column.name} must be an http(s) URL`;
    case 'date': return isRealIsoDate(value, today) ? null : `${column.name} must be a real ISO date (YYYY-MM-DD) not in the future`;
    case 'positive': return Number.isFinite(Number(value)) && Number(value) > 0 ? null : `${column.name} must be a number greater than 0`;
    case 'nonNegative': return Number.isFinite(Number(value)) && Number(value) >= 0 ? null : `${column.name} must be a number of 0 or more`;
    case 'integer': return Number.isInteger(Number(value)) && Number(value) > 0 ? null : `${column.name} must be a whole number greater than 0`;
    case 'enum': return column.values.includes(value) ? null : `${column.name} must be one of: ${column.values.join(', ')}`;
    default: return null;
  }
}

/** Returns a list of { file, line, message }. An empty list means the file is valid. */
function validateFile(spec, content, today = new Date().toISOString().slice(0, 10)) {
  const problems = [];
  const add = (line, message) => problems.push({ file: spec.file, line, message });
  const [header, ...rows] = parseCsv(content);
  const expected = spec.columns.map((c) => c.name);
  if (!header) {
    add(1, 'file is empty: it must at least contain the header row');
    return problems;
  }
  const names = header.map((h) => h.trim());
  if (names.join(',') !== expected.join(',')) {
    add(1, `header must be exactly: ${expected.join(',')}`);
    return problems;
  }
  const seen = new Map();
  rows.forEach((cells, index) => {
    const line = index + 2;
    if (cells.length !== expected.length) {
      add(line, `expected ${expected.length} columns, found ${cells.length}`);
      return;
    }
    const row = Object.fromEntries(expected.map((name, i) => [name, cells[i].trim()]));
    for (const column of spec.columns) {
      const message = checkCell(column, row[column.name], today);
      if (message) add(line, message);
    }
    for (const rule of spec.rules ?? []) {
      const message = rule(row);
      if (message) add(line, message);
    }
    const key = spec.uniqueKey.map((k) => row[k].toLowerCase()).join('|');
    if (seen.has(key)) add(line, `duplicate of line ${seen.get(key)} (${spec.uniqueKey.join(' + ')})`);
    else seen.set(key, line);
  });
  return problems;
}

function validateDirectory(dir, today) {
  const problems = [];
  const specs = fileSpecs();
  for (const spec of specs) {
    const full = path.join(dir, spec.file);
    if (!fs.existsSync(full)) {
      problems.push({ file: spec.file, line: 0, message: 'file is missing' });
      continue;
    }
    problems.push(...validateFile(spec, fs.readFileSync(full, 'utf8'), today));
  }
  const known = new Set(specs.map((s) => s.file).concat('README.md'));
  for (const name of fs.readdirSync(dir)) {
    if (!known.has(name)) problems.push({ file: name, line: 0, message: 'unknown file in memory/Electronics (add it to the format first)' });
  }
  return problems;
}

module.exports = { fileSpecs, validateFile, validateDirectory, parseCsv, packageClasses };
