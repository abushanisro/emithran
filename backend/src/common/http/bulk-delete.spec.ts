import { BadRequestException } from '@nestjs/common';

import { BULK_DELETE_CONFIRMATION, requireBulkDeleteConfirmation } from './bulk-delete';

describe('requireBulkDeleteConfirmation', () => {
  it('lets the call through only with the exact confirmation', () => {
    expect(() => requireBulkDeleteConfirmation(BULK_DELETE_CONFIRMATION)).not.toThrow();
  });

  it.each([undefined, '', 'yes', 'true', 'DELETE-ALL'])('refuses %p', (value) => {
    expect(() => requireBulkDeleteConfirmation(value)).toThrow(BadRequestException);
  });
});
