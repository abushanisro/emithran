import { BomFileAccess, userIdFromVerifiedToken } from './bom-file-access';

const USER = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const token = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;

function access(owned: boolean) {
  const maybeSingle = jest.fn(async () => ({ data: owned ? { id: PROJECT } : null, error: null }));
  const from = jest.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }));
  return { access: new BomFileAccess({ getUserClient: () => ({ from }) } as never), from };
}

describe('BomFileAccess', () => {
  it('allows a file in the caller\'s own folder of a project they own', async () => {
    expect(await access(true).access.canRead(`${USER}/${PROJECT}/bom-items/i/3d/f.step`, token(USER))).toBe(true);
  });

  it('refuses another user\'s folder without even asking the database', async () => {
    const { access: a, from } = access(true);
    expect(await a.canRead(`33333333-3333-4333-8333-333333333333/${PROJECT}/x/y`, token(USER))).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses a project the caller does not own, and anything that is not a user/project/file path', async () => {
    expect(await access(false).access.canRead(`${USER}/${PROJECT}/x/y`, token(USER))).toBe(false);
    for (const key of ['', USER, `${USER}/${PROJECT}`, `${USER}/not-a-uuid/x`, `${USER}/${PROJECT}/../../etc`, '/etc/passwd', 'https://evil.example.com/x']) {
      expect(await access(true).access.canRead(key, token(USER))).toBe(false);
    }
  });

  it('refuses when there is no usable token', async () => {
    expect(await access(true).access.canRead(`${USER}/${PROJECT}/x/y`, undefined)).toBe(false);
    expect(userIdFromVerifiedToken('garbage')).toBeNull();
    expect(userIdFromVerifiedToken(token('not-a-uuid'))).toBeNull();
  });
});
