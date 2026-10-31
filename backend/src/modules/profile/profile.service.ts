import { BadRequestException, Inject, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { OBJECT_STORE, type ObjectStore } from '../../common/storage/object-store';
import { UserDirectory } from '../../common/database/user-directory';
import { DatabaseService } from '../../common/database/database.service';
import { AVATAR_BUCKET, AVATAR_MAX_BYTES, AVATAR_URL_TTL_SECONDS, avatarKey, detectAvatarType } from './avatar';
import type { UpdateProfileDto, ProfileResponseDto } from './dto/profile.dto';

@Injectable()
export class ProfileService {
  constructor(
    private readonly database: DatabaseService,
    private readonly directory: UserDirectory,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
  ) {}

  async getProfile(userId: string, accessToken: string): Promise<ProfileResponseDto> {
    const client = this.database.getClient(accessToken);

    let { data, error } = await client
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      const { data: created, error: insertError } = await client
        .from('user_profiles')
        .insert({ user_id: userId })
        .select('*')
        .single();

      if (insertError) throw new Error(insertError.message);
      data = created;
    }

    return this.mapProfile(data, await this.emailOf(userId));
  }

  async updateProfile(userId: string, dto: UpdateProfileDto, accessToken: string): Promise<ProfileResponseDto> {
    const client = this.database.getClient(accessToken);

    const updateData: Record<string, any> = {};
    if (dto.displayName !== undefined) updateData.display_name = dto.displayName;
    if (dto.avatarUrl !== undefined)   updateData.avatar_url   = dto.avatarUrl;
    if (dto.bio !== undefined)         updateData.bio          = dto.bio;
    if (dto.jobTitle !== undefined)    updateData.job_title    = dto.jobTitle;
    if (dto.phone !== undefined)       updateData.phone        = dto.phone;
    if (dto.timezone !== undefined)    updateData.timezone     = dto.timezone;

    const { data, error } = await client
      .from('user_profiles')
      .upsert({ user_id: userId, ...updateData }, { onConflict: 'user_id' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);

    // Keep the user directory name in sync so the sidebar shows the correct name
    if (dto.displayName !== undefined) {
      await this.directory.setFullName(userId, dto.displayName);
    }

    return this.mapProfile(data, await this.emailOf(userId));
  }

  /** Stores a JPEG, PNG or WebP as the caller's photo (replacing the previous one) and records its key on the profile. */
  async uploadAvatar(userId: string, bytes: Buffer, accessToken: string): Promise<ProfileResponseDto> {
    if (bytes.length > AVATAR_MAX_BYTES) throw new PayloadTooLargeException('A profile photo can be at most 2 MB.');
    const contentType = detectAvatarType(bytes);
    if (!contentType) throw new BadRequestException('A profile photo must be a JPEG, PNG or WebP image.');

    await this.objects.put(AVATAR_BUCKET, avatarKey(userId), bytes, { contentType, upsert: true });
    const { data, error } = await this.database
      .getClient(accessToken)
      .from('user_profiles')
      .upsert({ user_id: userId, avatar_url: avatarKey(userId) }, { onConflict: 'user_id' })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return this.mapProfile(data, await this.emailOf(userId));
  }

  /**
   * The photo link the browser can show. The caller's own stored key becomes a time-limited signed link; a full URL from before the
   * object store is passed through; any other value (such as another user's key) is not signed.
   */
  private async avatarUrl(userId: string, stored: unknown): Promise<string | null> {
    if (typeof stored !== 'string' || stored === '') return null;
    if (stored === avatarKey(userId)) return this.objects.signedGetUrl(AVATAR_BUCKET, stored, AVATAR_URL_TTL_SECONDS);
    return /^https?:\/\//.test(stored) ? stored : null;
  }

  private async emailOf(userId: string): Promise<string | undefined> {
    const found = await this.directory.findByIds([userId]);
    return found.get(userId)?.email ?? undefined;
  }

  private async mapProfile(data: any, email?: string): Promise<ProfileResponseDto> {
    return {
      id: data.id,
      userId: data.user_id,
      displayName: data.display_name ?? null,
      avatarUrl: await this.avatarUrl(data.user_id, data.avatar_url),
      bio: data.bio ?? null,
      jobTitle: data.job_title ?? null,
      phone: data.phone ?? null,
      timezone: data.timezone || 'UTC',
      email: email || '',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}
