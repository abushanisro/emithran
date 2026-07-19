/**
 * Comprehensive Equipment Types Database
 * Organized by manufacturing process categories
 */

export const EQUIPMENT_CATEGORIES = {
  BENDING: 'Bending',
  CASTING: 'Casting',
  CNC_MACHINE: 'Cnc Machine',
  CUTTING: 'Cutting',
  FABRICATION: 'Fabrication',
  FINISHING_OPTIONS: 'Finishing Options',
  FORGING: 'Forging',
  FORMING: 'Forming',
  GRINDING: 'Grinding',
  HEAT_TREATMENT: 'Heat Treatment',
  HEATING_FURNACE: 'Heating Furnace',
  INJECTION_MOLDING: 'Injection Molding',
  MATERIAL_HANDLING: 'Material Handling',
  MELTING_FURNACE: 'Melting Furnace',
  RAW_MATERIAL: 'Raw Material',
  SHEARING: 'Shearing',
  WELDING: 'Welding',
} as const;

export type EquipmentCategory = typeof EQUIPMENT_CATEGORIES[keyof typeof EQUIPMENT_CATEGORIES];

export interface EquipmentType {
  id: string;
  name: string;
  category: EquipmentCategory;
}

export const EQUIPMENT_TYPES: EquipmentType[] = [
  // Bending
  { id: 'press-brake-bending', name: 'Press Brake', category: EQUIPMENT_CATEGORIES.BENDING },
  { id: 'bending-machine', name: 'Bending Machine', category: EQUIPMENT_CATEGORIES.BENDING },
  { id: 'plate-bending', name: 'Plate Bending Machine', category: EQUIPMENT_CATEGORIES.BENDING },
  { id: 'section-bending', name: 'Section Bending Machine', category: EQUIPMENT_CATEGORIES.BENDING },
  { id: 'tube-bending', name: 'Tube Bending Machine', category: EQUIPMENT_CATEGORIES.BENDING },
  { id: 'pipe-bending', name: 'Pipe Bending Machine', category: EQUIPMENT_CATEGORIES.BENDING },

  // Casting
  { id: 'die-casting-machine', name: 'Die Casting Machine', category: EQUIPMENT_CATEGORIES.CASTING },
  { id: 'investment-casting', name: 'Investment Casting', category: EQUIPMENT_CATEGORIES.CASTING },
  { id: 'sand-casting', name: 'Sand Casting', category: EQUIPMENT_CATEGORIES.CASTING },
  { id: 'gravity-die-casting', name: 'Gravity Die Casting', category: EQUIPMENT_CATEGORIES.CASTING },
  { id: 'permanent-mold-casting', name: 'Permanent Mold Casting', category: EQUIPMENT_CATEGORIES.CASTING },
  { id: 'shell-molding', name: 'Shell Molding', category: EQUIPMENT_CATEGORIES.CASTING },

  // CNC Machine
  { id: 'broaching-machine', name: 'Broaching Machine', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'cnc-lathe', name: 'Cnc Lathe', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'conventional-lathe', name: 'Conventional Lathe', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'drilling-machine', name: 'Drilling Machine', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'gantry-mill', name: 'Gantry Mill', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'generic-cnc-machine', name: 'Generic Cnc Machine', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'horizontal-boring-machine', name: 'Horizontal Boring Machine', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'horizontal-machining-center', name: 'Horizontal Machining Center', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'laser-cutting', name: 'Laser Cutting', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'magnetic-drilling-machine', name: 'Magnetic Drilling Machine', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'milling-machine', name: 'Milling Machine', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'milling-turning-center', name: 'Milling Turning Center', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'plasma-cutting', name: 'Plasma Cutting', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'poly-turn', name: 'Poly Turn', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'radial-drilling-machine', name: 'Radial Drilling Machine', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'sliding-head', name: 'Sliding Head', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'swiss-lathe', name: 'Swiss Lathe', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'tapping-machine', name: 'Tapping Machine', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'vertical-boring-machine', name: 'Vertical Boring Machine', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'vertical-lathe', name: 'Vertical Lathe', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'vertical-machining-center', name: 'Vertical Machining Center', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'vertical-machining-center-4-axis', name: 'Vertical Machining Center 4 Axis', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'vertical-machining-center-5-axis', name: 'Vertical Machining Center 5 Axis', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'water-jet-cutting', name: 'Water Jet Cutting', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },
  { id: 'wire-cutting', name: 'Wire Cutting', category: EQUIPMENT_CATEGORIES.CNC_MACHINE },

  // Cutting
  { id: 'band-saw', name: 'Band Saw', category: EQUIPMENT_CATEGORIES.CUTTING },
  { id: 'circular-saw', name: 'Circular Saw', category: EQUIPMENT_CATEGORIES.CUTTING },
  { id: 'power-saw', name: 'Power Saw', category: EQUIPMENT_CATEGORIES.CUTTING },
  { id: 'laser-cutter', name: 'Laser Cutter', category: EQUIPMENT_CATEGORIES.CUTTING },
  { id: 'plasma-cutter', name: 'Plasma Cutter', category: EQUIPMENT_CATEGORIES.CUTTING },
  { id: 'oxy-fuel-cutting', name: 'Oxy-Fuel Cutting', category: EQUIPMENT_CATEGORIES.CUTTING },
  { id: 'turret-punch', name: 'Turret Punch Press', category: EQUIPMENT_CATEGORIES.CUTTING },

  // Fabrication
  { id: 'press-brake-fab', name: 'Press Brake', category: EQUIPMENT_CATEGORIES.FABRICATION },
  { id: 'plate-rolling', name: 'Plate Rolling Machine', category: EQUIPMENT_CATEGORIES.FABRICATION },
  { id: 'ironworker', name: 'Ironworker', category: EQUIPMENT_CATEGORIES.FABRICATION },
  { id: 'notching-machine', name: 'Notching Machine', category: EQUIPMENT_CATEGORIES.FABRICATION },
  { id: 'punching-machine', name: 'Punching Machine', category: EQUIPMENT_CATEGORIES.FABRICATION },

  // Finishing Options
  { id: 'acid-tank', name: 'Acid Tank', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'anoblack-anodizing', name: 'Anoblack Anodizing', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'belt-sanding', name: 'Belt Sanding', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'blackening', name: 'Blackening', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'boric-sulfuric-acid-anodizing', name: 'Boric Sulfuric Acid Anodizing', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'chromic-acid-anodizing', name: 'Chromic Acid Anodizing', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'degreasing-tank', name: 'Degreasing Tank', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'dichromating-tank', name: 'Dichromating Tank', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'electroless-plating', name: 'Electroless Plating', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'grit-blasting', name: 'Grit Blasting', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'hard-anodizing', name: 'Hard Anodizing', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'honing', name: 'Honing', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'hot-dip-galvanizing', name: 'Hot Dip Galvanizing', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'metalizing', name: 'Metalizing', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'painting', name: 'Painting', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'passivation', name: 'Passivation', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'plating', name: 'Plating', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'powder-coating', name: 'Powder Coating', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'quenching-tank', name: 'Quenching Tank', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'shot-blasting', name: 'Shot Blasting', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'sulfuric-acid-anodizing', name: 'Sulfuric Acid Anodizing', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'teflon-anodizing', name: 'Teflon Anodizing', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'titanium-anodizing', name: 'Titanium Anodizing', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },
  { id: 'tumbling', name: 'Tumbling', category: EQUIPMENT_CATEGORIES.FINISHING_OPTIONS },

  // Forging
  { id: 'forging-hammer', name: 'Forging Hammer', category: EQUIPMENT_CATEGORIES.FORGING },
  { id: 'forging-press', name: 'Forging Press', category: EQUIPMENT_CATEGORIES.FORGING },
  { id: 'hot-forging-machine', name: 'Hot Forging Machine', category: EQUIPMENT_CATEGORIES.FORGING },
  { id: 'cold-forging-machine', name: 'Cold Forging Machine', category: EQUIPMENT_CATEGORIES.FORGING },
  { id: 'upsetting-machine', name: 'Upsetting Machine', category: EQUIPMENT_CATEGORIES.FORGING },
  { id: 'drop-forging', name: 'Drop Forging', category: EQUIPMENT_CATEGORIES.FORGING },

  // Forming
  { id: 'hydraulic-press', name: 'Hydraulic Press', category: EQUIPMENT_CATEGORIES.FORMING },
  { id: 'mechanical-press', name: 'Mechanical Press', category: EQUIPMENT_CATEGORIES.FORMING },
  { id: 'power-press', name: 'Power Press', category: EQUIPMENT_CATEGORIES.FORMING },
  { id: 'stamping-press', name: 'Stamping Press', category: EQUIPMENT_CATEGORIES.FORMING },
  { id: 'deep-drawing-press', name: 'Deep Drawing Press', category: EQUIPMENT_CATEGORIES.FORMING },
  { id: 'rolling-machine', name: 'Rolling Machine', category: EQUIPMENT_CATEGORIES.FORMING },
  { id: 'stretch-forming', name: 'Stretch Forming Machine', category: EQUIPMENT_CATEGORIES.FORMING },

  // Grinding
  { id: 'centerless-grinding', name: 'Centerless Grinding', category: EQUIPMENT_CATEGORIES.GRINDING },
  { id: 'cylindrical-grinding', name: 'Cylindrical Grinding', category: EQUIPMENT_CATEGORIES.GRINDING },
  { id: 'surface-grinding', name: 'Surface Grinding', category: EQUIPMENT_CATEGORIES.GRINDING },
  { id: 'tool-grinding', name: 'Tool Grinding', category: EQUIPMENT_CATEGORIES.GRINDING },
  { id: 'internal-grinding', name: 'Internal Grinding', category: EQUIPMENT_CATEGORIES.GRINDING },
  { id: 'universal-grinding', name: 'Universal Grinding', category: EQUIPMENT_CATEGORIES.GRINDING },

  // Heat Treatment
  { id: 'annealing-furnace', name: 'Annealing Furnace', category: EQUIPMENT_CATEGORIES.HEAT_TREATMENT },
  { id: 'hardening-furnace', name: 'Hardening Furnace', category: EQUIPMENT_CATEGORIES.HEAT_TREATMENT },
  { id: 'normalizing-furnace', name: 'Normalizing Furnace', category: EQUIPMENT_CATEGORIES.HEAT_TREATMENT },
  { id: 'tempering-furnace', name: 'Tempering Furnace', category: EQUIPMENT_CATEGORIES.HEAT_TREATMENT },
  { id: 'carburizing-furnace', name: 'Carburizing Furnace', category: EQUIPMENT_CATEGORIES.HEAT_TREATMENT },
  { id: 'nitriding-furnace', name: 'Nitriding Furnace', category: EQUIPMENT_CATEGORIES.HEAT_TREATMENT },
  { id: 'vacuum-heat-treatment', name: 'Vacuum Heat Treatment', category: EQUIPMENT_CATEGORIES.HEAT_TREATMENT },

  // Heating Furnace
  { id: 'electric-heating-furnace', name: 'Electric Heating Furnace', category: EQUIPMENT_CATEGORIES.HEATING_FURNACE },
  { id: 'gas-heating-furnace', name: 'Gas Heating Furnace', category: EQUIPMENT_CATEGORIES.HEATING_FURNACE },
  { id: 'oil-heating-furnace', name: 'Oil Heating Furnace', category: EQUIPMENT_CATEGORIES.HEATING_FURNACE },
  { id: 'chamber-furnace', name: 'Chamber Furnace', category: EQUIPMENT_CATEGORIES.HEATING_FURNACE },
  { id: 'pit-furnace', name: 'Pit Furnace', category: EQUIPMENT_CATEGORIES.HEATING_FURNACE },

  // Injection Molding
  { id: 'injection-molding-machine', name: 'Injection Molding Machine', category: EQUIPMENT_CATEGORIES.INJECTION_MOLDING },
  { id: 'blow-molding-machine', name: 'Blow Molding Machine', category: EQUIPMENT_CATEGORIES.INJECTION_MOLDING },
  { id: 'compression-molding', name: 'Compression Molding Machine', category: EQUIPMENT_CATEGORIES.INJECTION_MOLDING },
  { id: 'transfer-molding', name: 'Transfer Molding Machine', category: EQUIPMENT_CATEGORIES.INJECTION_MOLDING },
  { id: 'rotational-molding', name: 'Rotational Molding Machine', category: EQUIPMENT_CATEGORIES.INJECTION_MOLDING },

  // Material Handling
  { id: 'overhead-crane', name: 'Overhead Crane', category: EQUIPMENT_CATEGORIES.MATERIAL_HANDLING },
  { id: 'forklift', name: 'Forklift', category: EQUIPMENT_CATEGORIES.MATERIAL_HANDLING },
  { id: 'conveyor-system', name: 'Conveyor System', category: EQUIPMENT_CATEGORIES.MATERIAL_HANDLING },
  { id: 'hoist', name: 'Hoist', category: EQUIPMENT_CATEGORIES.MATERIAL_HANDLING },
  { id: 'jib-crane', name: 'Jib Crane', category: EQUIPMENT_CATEGORIES.MATERIAL_HANDLING },
  { id: 'gantry-crane', name: 'Gantry Crane', category: EQUIPMENT_CATEGORIES.MATERIAL_HANDLING },

  // Melting Furnace
  { id: 'induction-melting-furnace', name: 'Induction Melting Furnace', category: EQUIPMENT_CATEGORIES.MELTING_FURNACE },
  { id: 'arc-melting-furnace', name: 'Arc Melting Furnace', category: EQUIPMENT_CATEGORIES.MELTING_FURNACE },
  { id: 'cupola-furnace', name: 'Cupola Furnace', category: EQUIPMENT_CATEGORIES.MELTING_FURNACE },
  { id: 'crucible-furnace', name: 'Crucible Furnace', category: EQUIPMENT_CATEGORIES.MELTING_FURNACE },
  { id: 'reverberatory-furnace', name: 'Reverberatory Furnace', category: EQUIPMENT_CATEGORIES.MELTING_FURNACE },

  // Raw Material
  { id: 'metal-sheets', name: 'Metal Sheets', category: EQUIPMENT_CATEGORIES.RAW_MATERIAL },
  { id: 'metal-bars', name: 'Metal Bars', category: EQUIPMENT_CATEGORIES.RAW_MATERIAL },
  { id: 'metal-plates', name: 'Metal Plates', category: EQUIPMENT_CATEGORIES.RAW_MATERIAL },
  { id: 'metal-tubes', name: 'Metal Tubes', category: EQUIPMENT_CATEGORIES.RAW_MATERIAL },
  { id: 'metal-coils', name: 'Metal Coils', category: EQUIPMENT_CATEGORIES.RAW_MATERIAL },
  { id: 'castings', name: 'Castings', category: EQUIPMENT_CATEGORIES.RAW_MATERIAL },
  { id: 'forgings', name: 'Forgings', category: EQUIPMENT_CATEGORIES.RAW_MATERIAL },
  { id: 'plastic-pellets', name: 'Plastic Pellets', category: EQUIPMENT_CATEGORIES.RAW_MATERIAL },

  // Shearing
  { id: 'guillotine-shear', name: 'Guillotine Shear', category: EQUIPMENT_CATEGORIES.SHEARING },
  { id: 'hydraulic-shear', name: 'Hydraulic Shear', category: EQUIPMENT_CATEGORIES.SHEARING },
  { id: 'mechanical-shear', name: 'Mechanical Shear', category: EQUIPMENT_CATEGORIES.SHEARING },
  { id: 'swing-beam-shear', name: 'Swing Beam Shear', category: EQUIPMENT_CATEGORIES.SHEARING },
  { id: 'plate-shear', name: 'Plate Shear', category: EQUIPMENT_CATEGORIES.SHEARING },

  // Welding
  { id: 'arc-welding', name: 'Arc Welding', category: EQUIPMENT_CATEGORIES.WELDING },
  { id: 'mig-welding', name: 'MIG Welding', category: EQUIPMENT_CATEGORIES.WELDING },
  { id: 'tig-welding', name: 'TIG Welding', category: EQUIPMENT_CATEGORIES.WELDING },
  { id: 'spot-welding', name: 'Spot Welding', category: EQUIPMENT_CATEGORIES.WELDING },
  { id: 'robotic-welding', name: 'Robotic Welding', category: EQUIPMENT_CATEGORIES.WELDING },
  { id: 'friction-welding', name: 'Friction Welding', category: EQUIPMENT_CATEGORIES.WELDING },
  { id: 'brazing-equipment', name: 'Brazing Equipment', category: EQUIPMENT_CATEGORIES.WELDING },
  { id: 'laser-welding', name: 'Laser Welding', category: EQUIPMENT_CATEGORIES.WELDING },
  { id: 'resistance-welding', name: 'Resistance Welding', category: EQUIPMENT_CATEGORIES.WELDING },
];

// Helper function to get equipment types by category
export const getEquipmentTypesByCategory = (category: EquipmentCategory): EquipmentType[] => {
  return EQUIPMENT_TYPES.filter(type => type.category === category);
};

// Helper function to get all categories
export const getAllCategories = (): EquipmentCategory[] => {
  return Object.values(EQUIPMENT_CATEGORIES);
};

// Helper function to search equipment types
export const searchEquipmentTypes = (query: string): EquipmentType[] => {
  const lowerQuery = query.toLowerCase();
  return EQUIPMENT_TYPES.filter(
    type =>
      type.name.toLowerCase().includes(lowerQuery) ||
      type.category.toLowerCase().includes(lowerQuery)
  );
};

// Dynamic field configuration for each category
export interface FieldConfig {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select';
  placeholder: string;
  required?: boolean;
  group?: string; // For grouping related fields
  groupLabel?: string; // Label for the group
  options?: string[]; // For select fields
}

export const CATEGORY_FIELD_CONFIGS: Record<EquipmentCategory, FieldConfig[]> = {
  [EQUIPMENT_CATEGORIES.BENDING]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'e.g., Amada' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'e.g., HFE 100-3' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: '1' },
    { name: 'yearOfManufacture', label: 'Year', type: 'number', placeholder: '2020' },
    { name: 'bedSizeLengthMm', label: 'Length (mm)', type: 'number', placeholder: '1000', group: 'bedSize', groupLabel: 'Bed Size' },
    { name: 'bedSizeWidthMm', label: 'Width (mm)', type: 'number', placeholder: '500', group: 'bedSize' },
    { name: 'tonnage', label: 'Tonnage (tons)', type: 'number', placeholder: '40', group: 'selectionCriteria', groupLabel: 'Selection Criteria' },
    { name: 'process', label: 'Process', type: 'text', placeholder: 'Bending', group: 'selectionCriteria' },
    { name: 'marketPrice', label: 'Price ($)', type: 'number', placeholder: '500000' },
  ],
  [EQUIPMENT_CATEGORIES.CASTING]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'tonnage', label: 'Shot Capacity (Tons)', type: 'number', placeholder: 'Enter shot capacity' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.CNC_MACHINE]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'e.g., DMG Mori' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'e.g., DMU 50' },
    { name: 'equipmentSubtype', label: 'Subtype', type: 'text', placeholder: 'VMC-5-Axis' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: '1' },
    { name: 'yearOfManufacture', label: 'Year', type: 'number', placeholder: '2020' },
    { name: 'bedSizeLengthMm', label: 'Length (mm)', type: 'number', placeholder: '1000', group: 'bedSize', groupLabel: 'Bed Size' },
    { name: 'bedSizeWidthMm', label: 'Width (mm)', type: 'number', placeholder: '500', group: 'bedSize' },
    { name: 'bedSizeHeightMm', label: 'Height (mm)', type: 'number', placeholder: '600', group: 'bedSize' },
    { name: 'tonnage', label: 'Tonnage (tons)', type: 'number', placeholder: '40', group: 'selectionCriteria', groupLabel: 'Selection Criteria' },
    { name: 'process', label: 'Process', type: 'text', placeholder: 'Milling', group: 'selectionCriteria' },
    { name: 'marketPrice', label: 'Price ($)', type: 'number', placeholder: '5000000' },
  ],
  [EQUIPMENT_CATEGORIES.CUTTING]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'bedSizeLengthMm', label: 'Cutting Length (mm)', type: 'number', placeholder: 'Enter cutting length' },
    { name: 'bedSizeWidthMm', label: 'Cutting Width (mm)', type: 'number', placeholder: 'Enter cutting width' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.FABRICATION]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'tonnage', label: 'Tonnage', type: 'number', placeholder: 'Enter tonnage' },
    { name: 'bedSizeLengthMm', label: 'Working Length (mm)', type: 'number', placeholder: 'Enter working length' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.FINISHING_OPTIONS]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model/Type', type: 'text', placeholder: 'Enter model or type' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'yearOfManufacture', label: 'Year of Installation', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.FORGING]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'tonnage', label: 'Tonnage', type: 'number', placeholder: 'Enter tonnage' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.FORMING]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'tonnage', label: 'Tonnage', type: 'number', placeholder: 'Enter tonnage' },
    { name: 'bedSizeLengthMm', label: 'Bed Length (mm)', type: 'number', placeholder: 'Enter bed length' },
    { name: 'bedSizeWidthMm', label: 'Bed Width (mm)', type: 'number', placeholder: 'Enter bed width' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.GRINDING]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'bedSizeLengthMm', label: 'Max Length (mm)', type: 'number', placeholder: 'Enter max length' },
    { name: 'bedSizeWidthMm', label: 'Max Diameter (mm)', type: 'number', placeholder: 'Enter max diameter' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.HEAT_TREATMENT]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'bedSizeLengthMm', label: 'Chamber Length (mm)', type: 'number', placeholder: 'Enter chamber length' },
    { name: 'bedSizeWidthMm', label: 'Chamber Width (mm)', type: 'number', placeholder: 'Enter chamber width' },
    { name: 'bedSizeHeightMm', label: 'Chamber Height (mm)', type: 'number', placeholder: 'Enter chamber height' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.HEATING_FURNACE]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'bedSizeLengthMm', label: 'Chamber Length (mm)', type: 'number', placeholder: 'Enter chamber length' },
    { name: 'bedSizeWidthMm', label: 'Chamber Width (mm)', type: 'number', placeholder: 'Enter chamber width' },
    { name: 'bedSizeHeightMm', label: 'Chamber Height (mm)', type: 'number', placeholder: 'Enter chamber height' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.INJECTION_MOLDING]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'tonnage', label: 'Clamping Force (Tons)', type: 'number', placeholder: 'Enter clamping force' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.MATERIAL_HANDLING]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'tonnage', label: 'Load Capacity (Tons)', type: 'number', placeholder: 'Enter load capacity' },
    { name: 'bedSizeHeightMm', label: 'Max Height (mm)', type: 'number', placeholder: 'Enter max height' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.MELTING_FURNACE]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'tonnage', label: 'Capacity (Tons)', type: 'number', placeholder: 'Enter capacity' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.RAW_MATERIAL]: [
    { name: 'manufacturer', label: 'Supplier', type: 'text', placeholder: 'Enter supplier name' },
    { name: 'model', label: 'Material Grade/Type', type: 'text', placeholder: 'Enter material grade' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'marketPrice', label: 'Price per Unit', type: 'number', placeholder: 'Enter price per unit' },
  ],
  [EQUIPMENT_CATEGORIES.SHEARING]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'tonnage', label: 'Tonnage', type: 'number', placeholder: 'Enter tonnage' },
    { name: 'bedSizeLengthMm', label: 'Cutting Length (mm)', type: 'number', placeholder: 'Enter cutting length' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
  [EQUIPMENT_CATEGORIES.WELDING]: [
    { name: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Enter manufacturer' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'Enter model' },
    { name: 'quantity', label: 'Quantity', type: 'number', placeholder: 'Enter quantity' },
    { name: 'yearOfManufacture', label: 'Year of Manufacture', type: 'number', placeholder: 'e.g., 2020' },
    { name: 'marketPrice', label: 'Market Price', type: 'number', placeholder: 'Enter market price' },
  ],
};

// Helper function to get field config for a category
export const getFieldsForCategory = (category: EquipmentCategory): FieldConfig[] => {
  return CATEGORY_FIELD_CONFIGS[category] || [];
};
