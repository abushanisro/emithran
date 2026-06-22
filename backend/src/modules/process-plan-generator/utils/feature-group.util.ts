export function featureGroupFromType(type: string | null | undefined): string {
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
