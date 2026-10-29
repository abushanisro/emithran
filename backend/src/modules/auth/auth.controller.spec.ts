import { AuthController } from './auth.controller';

describe('AuthController', () => {
  it('returns only the id and email of the authorised user', () => {
    expect(new AuthController().me({ id: 'u1', email: 'a@x.com', role: 'authenticated', secret: 'x' })).toEqual({ id: 'u1', email: 'a@x.com' });
  });
});
