import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileApi, type UpdateProfileData } from '../profile';
import { toast } from 'sonner';

export const profileKeys = {
  profile: ['profile'] as const,
};

export function useProfile() {
  return useQuery({
    queryKey: profileKeys.profile,
    queryFn: () => profileApi.getProfile(),
    staleTime: 1000 * 60 * 5,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateProfileData) => profileApi.updateProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.profile });
      toast.success('Profile updated');
    },
    onError: () => {
      toast.error('Failed to update profile');
    },
  });
}
