import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import type { UpdateProfileDto, ProfileResponseDto } from './dto/profile.dto';

@Injectable()
export class ProfileService {
  constructor(private readonly supabase: SupabaseService) {}

  async getProfile(userId: string, accessToken: string): Promise<ProfileResponseDto> {
    const client = this.supabase.getClient(accessToken);

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

    const adminClient = this.supabase.getAdminClient();
    const { data: authData } = await adminClient.auth.admin.getUserById(userId);

    return this.mapProfile(data, authData?.user?.email);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto, accessToken: string): Promise<ProfileResponseDto> {
    const client = this.supabase.getClient(accessToken);

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

    // Keep Supabase auth user_metadata in sync so the sidebar shows the correct name
    if (dto.displayName !== undefined) {
      const adminClient = this.supabase.getAdminClient();
      await adminClient.auth.admin.updateUserById(userId, {
        user_metadata: { full_name: dto.displayName },
      });
    }

    const adminClient = this.supabase.getAdminClient();
    const { data: authData } = await adminClient.auth.admin.getUserById(userId);

    return this.mapProfile(data, authData?.user?.email);
  }

  private mapProfile(data: any, email?: string): ProfileResponseDto {
    return {
      id: data.id,
      userId: data.user_id,
      displayName: data.display_name ?? null,
      avatarUrl: data.avatar_url ?? null,
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
