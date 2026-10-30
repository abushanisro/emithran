import { apiClient } from './client';

export type UserProfile = {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  jobTitle: string | null;
  phone: string | null;
  timezone: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

export type UpdateProfileData = {
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  jobTitle?: string;
  phone?: string;
  timezone?: string;
};

export const profileApi = {
  getProfile: (): Promise<UserProfile> =>
    apiClient.get<UserProfile>('/profile'),

  updateProfile: (data: UpdateProfileData): Promise<UserProfile> =>
    apiClient.patch<UserProfile>('/profile', data),

  /** The backend checks the image type and size, stores it and returns the profile with a signed photo link. */
  uploadAvatar: (file: File): Promise<UserProfile> => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.uploadFiles<UserProfile>('/profile/avatar', form);
  },
};
