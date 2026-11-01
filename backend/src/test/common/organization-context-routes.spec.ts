import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FxController } from '../../common/fx/fx.controller';
import { OrganizationContextGuard } from '../../common/guards/organization-context.guard';
import { RawMaterialsController } from '../../modules/raw-materials/raw-materials.controller';

// Routes that act for "the caller's organization" must resolve it (OrganizationContextGuard); without the guard
// @CurrentOrganization() is undefined and the handler either fails every call or has no organization to scope to.
const guarded = (controller: { prototype: object }, method: string): unknown[] =>
  Reflect.getMetadata(GUARDS_METADATA, (controller.prototype as Record<string, any>)[method]) ?? [];

describe('routes that act for the caller\'s organization resolve it', () => {
  it.each([
    [FxController, 'listExchangeRates'],
    [FxController, 'setExchangeRate'],
    [FxController, 'getRate'],
    [RawMaterialsController, 'saveEditor'],
  ] as const)('%p.%s', (controller, method) => {
    expect(guarded(controller, method)).toContain(OrganizationContextGuard);
  });

  it('the global reference lists and the provider refresh need no organization', () => {
    for (const method of ['listCurrencies', 'listFactories', 'refresh']) expect(guarded(FxController, method)).toEqual([]);
  });
});
