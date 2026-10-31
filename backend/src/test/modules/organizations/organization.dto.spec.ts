import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  CreateOrganizationDto,
  InviteMemberDto,
  UpdateOrganizationDto,
  WorkspaceDto,
} from '../../../modules/organizations/dto/organization.dto';

const errors = async <T extends object>(type: new () => T, body: object) =>
  (await validate(plainToInstance(type, body), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

describe('organization DTOs', () => {
  it('needs a name to create an organization', async () => {
    expect(await errors(CreateOrganizationDto, {})).toEqual(['name']);
    expect(await errors(CreateOrganizationDto, { name: 'Acme', useTags: ['oem'], under18: false })).toEqual([]);
  });

  it('refuses fields the API does not own, such as the owner', async () => {
    expect(await errors(UpdateOrganizationDto, { ownerId: 'someone' })).toEqual(['ownerId']);
  });

  it('invites only with a valid email and a known role', async () => {
    expect(await errors(InviteMemberDto, { email: 'a@acme.com', role: 'admin' })).toEqual([]);
    expect(await errors(InviteMemberDto, { email: 'not-an-email', role: 'superuser' })).toEqual(['email', 'role']);
  });

  it('needs a workspace name', async () => {
    expect(await errors(WorkspaceDto, { description: 'x' })).toEqual(['name']);
  });
});
