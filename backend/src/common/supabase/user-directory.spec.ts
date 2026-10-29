import { UserDirectory } from './user-directory';

const ID = '11111111-1111-4111-8111-111111111111';

describe('UserDirectory', () => {
  it('on plain Postgres asks the service-only functions, for exactly the ids given (deduplicated)', async () => {
    const rpc = jest.fn(async () => ({ data: [{ id: ID, email: 'a@x.com', full_name: 'A' }], error: null }));
    const dir = new UserDirectory({ usesPostgrest: () => true, getPrivilegedClient: () => ({ rpc }) } as never);
    const found = await dir.findByIds([ID, ID, '']);
    expect(rpc).toHaveBeenCalledWith('directory_users', { p_ids: [ID] });
    expect(found.get(ID)).toEqual({ id: ID, email: 'a@x.com', fullName: 'A' });
  });

  it('asks nothing for no ids, and fails loudly (not with empty names) when the directory is unreachable', async () => {
    const rpc = jest.fn(async () => ({ data: null, error: { message: 'down' } }));
    const dir = new UserDirectory({ usesPostgrest: () => true, getPrivilegedClient: () => ({ rpc }) } as never);
    expect((await dir.findByIds([])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    await expect(dir.findByIds([ID])).rejects.toThrow('user directory unavailable');
  });

  it('on Supabase reads each id through the admin API and never lists every user for an id lookup', async () => {
    const getUserById = jest.fn(async () => ({ data: { user: { email: 'a@x.com', user_metadata: { full_name: 'A' } } } }));
    const listUsers = jest.fn();
    const dir = new UserDirectory({ usesPostgrest: () => false, getPrivilegedClient: () => ({ auth: { admin: { getUserById, listUsers } } }) } as never);
    expect((await dir.findByIds([ID])).get(ID)?.fullName).toBe('A');
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('finds an id by email and updates a name on both backends', async () => {
    const rpc = jest.fn(async () => ({ data: ID, error: null }));
    const pg = new UserDirectory({ usesPostgrest: () => true, getPrivilegedClient: () => ({ rpc }) } as never);
    expect(await pg.findIdByEmail('A@x.com')).toBe(ID);
    await pg.setFullName(ID, 'New');
    expect(rpc).toHaveBeenLastCalledWith('directory_set_full_name', { p_user_id: ID, p_full_name: 'New' });

    const updateUserById = jest.fn(async () => ({}));
    const sb = new UserDirectory({ usesPostgrest: () => false, getPrivilegedClient: () => ({ auth: { admin: { listUsers: async () => ({ data: { users: [{ id: ID, email: 'a@x.com' }] } }), updateUserById } } }) } as never);
    expect(await sb.findIdByEmail('A@X.com')).toBe(ID);
    await sb.setFullName(ID, 'New');
    expect(updateUserById).toHaveBeenCalledWith(ID, { user_metadata: { full_name: 'New' } });
  });
});
