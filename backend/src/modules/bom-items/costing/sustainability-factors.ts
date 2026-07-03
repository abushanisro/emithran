// Energy drawn (kWh/hr) — connected load including auxiliaries (motor, chiller, controls)
export const ENERGY_KWH_PER_HR: Record<string, number> = {
  fiber_laser:  12.0,   // 6 kW cutting head + chiller + motion system
  turret_punch:  8.0,   // hydraulic CNC turret press
  waterjet:     15.0,   // 37 kW intensifier pump + abrasive system
  press_brake:   4.5,   // hydraulic servo press brake
  tapping:       1.5,   // CNC tapping centre
  deburring:     0.75,  // rotary brush / bench grinder
  // CNC machining
  cnc_3ax_vmc:   7.5,   // 3-axis VMC: spindle + coolant + control
  cnc_4ax_vmc:   9.0,   // 4-axis: higher torque for rotary axis
  cnc_5ax_mc:   12.0,   // 5-axis: multiple servo axes + coolant
  cnc_lathe:     5.5,   // CNC lathe: spindle + coolant
  cnc_lathe_live: 7.0,  // live tooling: additional spindle power
  cnc_mill_turn: 10.0,  // full mill-turn: two spindles
  inspection:    0.5,   // CMM / bench gauge: minimal draw
};

// India grid CO₂ intensity — CEA 2023 Annual Report (kg CO₂e per kWh consumed)
export const GRID_CO2_KG_PER_KWH = 0.716;

// Embodied carbon (kg CO₂e / kg material) — primary production
// Sources: worldsteel 2023, IAI (aluminium), ICSG (copper)
export const MATERIAL_CO2_KG_PER_KG: Record<string, number> = {
  CRCA:        1.85,
  IS2062:      1.85,
  MS:          1.85,
  SS304:       6.15,
  SS316:       6.80,
  AL6061:      8.50,
  AL5052:      8.20,
  COPPER:      4.50,
  __default__: 2.00,
};

// End-of-life recyclability (%)
export const MATERIAL_RECYCLABILITY_PCT: Record<string, number> = {
  CRCA:        95,
  IS2062:      95,
  MS:          95,
  SS304:       96,
  SS316:       96,
  AL6061:      92,
  AL5052:      92,
  COPPER:      91,
  __default__: 85,
};

export const SUSTAINABILITY_FACTORS_LABEL = 'Sustainability factors v1 (India 2026, CEA 2023)';
