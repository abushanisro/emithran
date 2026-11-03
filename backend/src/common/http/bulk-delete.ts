import { BadRequestException } from '@nestjs/common';

/** What a caller sends as ?confirm= to delete every row of a rate or master-data table. */
export const BULK_DELETE_CONFIRMATION = 'delete-all';

/** A delete-everything route does nothing unless the caller says so on purpose: a stray DELETE can never wipe a table. */
export function requireBulkDeleteConfirmation(confirm: string | undefined): void {
  if (confirm !== BULK_DELETE_CONFIRMATION) {
    throw new BadRequestException(`This deletes every record. Send ?confirm=${BULK_DELETE_CONFIRMATION} to confirm.`);
  }
}
