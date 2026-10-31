import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { ObjectStore } from '../../../common/storage/object-store';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { UserDirectory } from '../../../common/supabase/user-directory';
import { AVATAR_BUCKET, avatarKey, detectAvatarType } from '../../../modules/profile/avatar';
import { ProfileService } from '../../../modules/profile/profile.service';
import { FakePostgrest } from '../../support/fake-postgrest';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'user-token';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);

/** In-memory ObjectStore: records writes and signs predictable URLs. */
class MemoryObjects implements ObjectStore {
  readonly stored = new Map<string, { body: Buffer; contentType?: string }>();
  put(bucket: string, key: string, body: Buffer, options?: { contentType?: string }): Promise<void> {
    this.stored.set(`${bucket}/${key}`, { body, contentType: options?.contentType });
    return Promise.resolve();
  }
  get(bucket: string, key: string): Promise<Buffer | null> {
    return Promise.resolve(this.stored.get(`${bucket}/${key}`)?.body ?? null);
  }
  remove(): Promise<void> {
    return Promise.resolve();
  }
  list(): Promise<string[]> {
    return Promise.resolve([]);
  }
  exists(bucket: string, key: string): Promise<boolean> {
    return Promise.resolve(this.stored.has(`${bucket}/${key}`));
  }
  signedGetUrl(bucket: string, key: string, ttlSeconds: number): Promise<string> {
    return Promise.resolve(`https://files.test/${bucket}/${key}?ttl=${ttlSeconds}`);
  }
}

describe('detectAvatarType', () => {
  it('recognises JPEG, PNG and WebP by their bytes, not by the file name', () => {
    expect(detectAvatarType(JPEG)).toBe('image/jpeg');
    expect(detectAvatarType(PNG)).toBe('image/png');
    expect(detectAvatarType(WEBP)).toBe('image/webp');
  });

  it('refuses anything else, including SVG, which can carry script', () => {
    expect(detectAvatarType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectAvatarType(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectAvatarType(Buffer.alloc(0))).toBeNull();
  });
});

describe('ProfileService avatar', () => {
  let db: FakePostgrest;
  let objects: MemoryObjects;
  let service: ProfileService;

  beforeEach(async () => {
    db = new FakePostgrest();
    await db.start();
    const supabase = new SupabaseService(
      new ConfigService({ POSTGREST_URL: db.url, DB_JWT_SECRET: 'x'.repeat(32) }),
    );
    objects = new MemoryObjects();
    service = new ProfileService(supabase, new UserDirectory(supabase), objects);
    db.reply('POST', '/rpc/directory_users', [{ id: USER, email: 'me@acme.com', full_name: null }]);
  });

  afterEach(() => db.stop());

  const profileRow = (avatar: string | null) => ({ id: 'p1', user_id: USER, avatar_url: avatar, timezone: 'UTC' });

  it("stores the image under the caller's own key with its detected type, and records the key", async () => {
    db.reply('POST', '/user_profiles', [profileRow(avatarKey(USER))]);

    const profile = await service.uploadAvatar(USER, PNG, TOKEN);

    expect(objects.stored.get(`${AVATAR_BUCKET}/${USER}/avatar`)).toEqual({ body: PNG, contentType: 'image/png' });
    const [write] = db.seen.filter((s) => s.method === 'POST' && s.path === '/user_profiles');
    expect(write?.body).toEqual({ user_id: USER, avatar_url: avatarKey(USER) });
    expect(write?.auth).toBe(`Bearer ${TOKEN}`);
    expect(profile.avatarUrl).toBe(`https://files.test/${AVATAR_BUCKET}/${USER}/avatar?ttl=43200`);
  });

  it('refuses an upload that is not an image, before storing anything', async () => {
    await expect(service.uploadAvatar(USER, Buffer.from('%PDF-1.7'), TOKEN)).rejects.toBeInstanceOf(BadRequestException);
    expect(objects.stored.size).toBe(0);
    expect(db.seen.filter((s) => s.path === '/user_profiles')).toHaveLength(0);
  });

  it("signs only the caller's own avatar key; a stored key of someone else is not signed", async () => {
    db.reply('GET', '/user_profiles', [profileRow(avatarKey(OTHER))]);
    expect((await service.getProfile(USER, TOKEN)).avatarUrl).toBeNull();
  });

  it('passes an older full URL through unchanged', async () => {
    db.reply('GET', '/user_profiles', [profileRow('https://old.example/avatars/me.png')]);
    expect((await service.getProfile(USER, TOKEN)).avatarUrl).toBe('https://old.example/avatars/me.png');
  });
});
