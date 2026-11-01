// Regression (security audit, output hardening): vendor document links and the profile avatar URL accepted any string, so a
// javascript: or data: value reached an <a href> or <img src>. They now accept only http(s) (avatar: https) URLs, or empty to clear.
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateProfileDto } from '../../../modules/profile/dto/profile.dto';
import { UpdateVendorDto } from '../../../modules/vendors/dto/vendor.dto';

async function failedFields<T extends object>(cls: new () => T, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body) as object);
  return errors.map((e) => e.property);
}

describe('vendor document URLs', () => {
  it.each(['https://example.com/profile.pdf', 'http://example.com/machines.xlsx', ''])('accepts %p', async (url) => {
    expect(await failedFields(UpdateVendorDto, { companyProfileUrl: url, machineListUrl: url })).toEqual([]);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>x</script>', 'example.com/no-protocol', 'ftp://example.com/x', `https://e.com/${'a'.repeat(2048)}`])(
    'refuses %p',
    async (url) => {
      expect(await failedFields(UpdateVendorDto, { companyProfileUrl: url, machineListUrl: url })).toEqual(['companyProfileUrl', 'machineListUrl']);
    },
  );
});

describe('profile avatar URL', () => {
  it.each([null, '', 'https://cdn.example.com/a.png'])('accepts %p', async (avatarUrl) => {
    expect(await failedFields(UpdateProfileDto, { avatarUrl })).toEqual([]);
  });

  it.each(['http://cdn.example.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'avatars/other-user', `https://e.com/${'a'.repeat(2048)}`])(
    'refuses %p',
    async (avatarUrl) => {
      expect(await failedFields(UpdateProfileDto, { avatarUrl })).toEqual(['avatarUrl']);
    },
  );
});
