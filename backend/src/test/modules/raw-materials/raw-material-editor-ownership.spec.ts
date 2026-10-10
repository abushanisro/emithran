import { ForbiddenException } from '@nestjs/common';

import { assertCanEditMaterial } from '../../../modules/raw-materials/services/raw-material-editor.service';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

describe('assertCanEditMaterial', () => {
  it('lets the owning organization edit its material', () => {
    expect(() => assertCanEditMaterial(ORG_A, ORG_A)).not.toThrow();
  });

  it('refuses a shared catalog material (no organization) to everyone', () => {
    expect(() => assertCanEditMaterial(null, ORG_A)).toThrow(ForbiddenException);
    expect(() => assertCanEditMaterial(null, undefined)).toThrow(ForbiddenException);
  });

  it('refuses another organization\'s material', () => {
    expect(() => assertCanEditMaterial(ORG_B, ORG_A)).toThrow(ForbiddenException);
  });

  it('refuses a caller whose organization could not be resolved', () => {
    expect(() => assertCanEditMaterial(ORG_A, undefined)).toThrow(ForbiddenException);
  });
});
