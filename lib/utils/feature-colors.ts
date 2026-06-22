export type FeatureGroup =
  | 'HOLE' | 'THREAD' | 'THREAD_EXT' | 'POCKET' | 'SLOT'
  | 'TURN' | 'GRIND' | 'SURFACE' | 'SHEET_METAL' | 'GENERAL'
  | 'UNDERCUT' | 'THIN_WALL';

export type CameraPreset = 'top' | 'front' | 'right' | 'isometric';

interface GroupMeta {
  dfmType: 'hole' | 'pocket' | 'slot' | 'thin_wall' | 'undercut' | null;
  surfaceOverlay?: boolean;
  hexColor: string;
  label: string;
  cameraPreset: CameraPreset;
}

export const FEATURE_GROUP_META: Record<FeatureGroup, GroupMeta> = {
  HOLE:        { dfmType: 'hole',      hexColor: '#FF4757', label: 'Hole',             cameraPreset: 'top' },
  THREAD:      { dfmType: 'hole',      hexColor: '#FF6B35', label: 'Internal Thread',  cameraPreset: 'top' },
  THREAD_EXT:  { dfmType: null,        hexColor: '#FF8C00', label: 'External Thread',  cameraPreset: 'front' },
  POCKET:      { dfmType: 'pocket',    hexColor: '#1E90FF', label: 'Pocket',           cameraPreset: 'top' },
  SLOT:        { dfmType: 'slot',      hexColor: '#00B4D8', label: 'Slot',             cameraPreset: 'top' },
  TURN:        { dfmType: null,        hexColor: '#2ED573', label: 'Turned Profile',   cameraPreset: 'front' },
  GRIND:       { dfmType: null,        hexColor: '#ECCC68', label: 'Ground/Finish',    cameraPreset: 'isometric' },
  SURFACE:     { dfmType: null, surfaceOverlay: true, hexColor: '#A29BFE', label: 'Surface Treatment', cameraPreset: 'isometric' },
  SHEET_METAL: { dfmType: null,        hexColor: '#74B9FF', label: 'Sheet Metal',      cameraPreset: 'top' },
  GENERAL:     { dfmType: null,        hexColor: '#B2BEC3', label: 'General Op',       cameraPreset: 'isometric' },
  UNDERCUT:    { dfmType: 'undercut',  hexColor: '#9B59B6', label: 'Undercut',         cameraPreset: 'front' },
  THIN_WALL:   { dfmType: 'thin_wall', hexColor: '#FFA502', label: 'Thin Wall',        cameraPreset: 'isometric' },
};

export function featureGroupFromType(type: string | null | undefined): FeatureGroup {
  switch (type) {
    case 'AXIAL_HOLE': case 'CROSS_HOLE': case 'COUNTERBORE':
    case 'COUNTERSINK': case 'ID_BORE': return 'HOLE';
    case 'THREAD_INTERNAL': return 'THREAD';
    case 'THREAD_EXTERNAL': return 'THREAD_EXT';
    case 'POCKET': return 'POCKET';
    case 'SLOT': return 'SLOT';
    case 'OD_TURN': case 'FACE_TURN': case 'SHOULDER_TURN': case 'FLAT_FACE': return 'TURN';
    case 'GRIND': case 'SURFACE_FINISH_FINE': case 'HONE': case 'LAPP': return 'GRIND';
    case 'ANODIZE': case 'PLATE': case 'HEAT_TREAT': return 'SURFACE';
    case 'BEND': case 'LASER_CUT': case 'FORM': return 'SHEET_METAL';
    case 'UNDERCUT': return 'UNDERCUT';
    case 'THIN_WALL': return 'THIN_WALL';
    default: return 'GENERAL';
  }
}

// Convert a backend ManufacturingFeature (from featureGraph) to the viewer-compatible shape.
// The viewer uses 'hole' | 'pocket' | 'slot' | 'thin_wall' | 'undercut' as its type vocabulary.
// Returns null if the feature group has no DFM mesh (TURN, GENERAL, GRIND, THREAD_EXT).
// Returns a surface-overlay sentinel object for SURFACE group (ANODIZE, PLATE, HEAT_TREAT).
export function toViewerFeature(feature: any): any | null {
  if (!feature) return null;
  const group = featureGroupFromType(feature.type);
  const meta  = FEATURE_GROUP_META[group];
  if (meta.surfaceOverlay) {
    return { ...feature, _surfaceOverlay: true, type: 'surface_overlay' };
  }
  if (!meta.dfmType) return null;
  return { ...feature, type: meta.dfmType };
}

// Create a minimal synthetic feature when no real CAD features are available.
// Needed for parts without DFM analysis — ensures DFMColorMesh still renders.
export function syntheticViewerFeature(dfmType: string): any {
  return {
    id: `synth-${dfmType}`,
    type: dfmType,
    position: { x: 0, y: 0, z: 0 },
    dimensions: {},
    manufacturingProcess: '',
    cycleTime: 0,
    tooling: [],
    warnings: [],
    aiRecommendations: [],
  };
}

export function featureMetaFromGroup(group: FeatureGroup | null | undefined): GroupMeta | null {
  if (!group) return null;
  return FEATURE_GROUP_META[group as FeatureGroup] ?? FEATURE_GROUP_META.GENERAL;
}
