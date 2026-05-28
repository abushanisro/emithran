import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { SupabaseService } from '../../common/supabase/supabase.service';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, SupabaseService],
})
export class ProfileModule {}
