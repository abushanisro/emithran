// Energy drawn (kWh/hr) — connected load including auxiliaries (motor, chiller, controls)
export const ENERGY_KWH_PER_HR: Record<string, number> = {
  fiber_laser:  12.0,   // 6 kW cutting head + chiller + motion system
  turret_punch:  8.0,   // hydraulic CNC turret press
  waterjet:     15.0,   // 37 kW intensifier pump + abrasive system
  press_brake:   4.5,   // hydraulic servo press brake
  tapping:       1.5,   // CNC tapping centre
  deburring:     0.75,  // rotary brush / bench grinder
  // CNC machining — real granular classes, replacing the deleted
  // cnc_3ax_vmc/cnc_4ax_vmc/cnc_5ax_mc/cnc_lathe/cnc_lathe_live/cnc_mill_turn
  // keys (Machining Engine Re-Architecture); each granular class inherits
  // its coarse predecessor's figure verbatim.
  '3_axis_mill':   7.5,   // 3-axis VMC: spindle + coolant + control
  '4_axis_mill':   9.0,   // 4-axis: higher torque for rotary axis
  '5_axis_mill':  12.0,   // 5-axis: multiple servo axes + coolant
  '2_axis_lathe':  5.5,   // CNC lathe: spindle + coolant
  '3_axis_lathe':  5.5,   // CNC lathe: spindle + coolant
  '2_axis_bar_feed_lathe_with_sub_spindle': 7.0, // live tooling: additional spindle power
  '3_axis_bar_feed_lathe_with_sub_spindle': 7.0, // live tooling: additional spindle power
  inspection:    0.5,   // CMM / bench gauge: minimal draw
  cmm:           0.5,   // coordinate measuring machine: probe + controller
  surface_treatment: 2.5, // anodize/plating line share: rectifier + tanks + rinse
  cleaning:      1.0,   // wash / degrease station: pump + heater share
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
