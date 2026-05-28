interface User { id: string; email: string; [key: string]: any; }
import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProfileService } from './profile.service';
import { UpdateProfileDto, ProfileResponseDto } from './dto/profile.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';

@ApiTags('Profile')
@ApiBearerAuth()
@Controller({ path: 'api/profile', version: '1' })
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  async getProfile(
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProfileResponseDto> {
    return this.profileService.getProfile(user.id, token);
  }

  @Patch()
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  async updateProfile(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProfileResponseDto> {
    return this.profileService.updateProfile(user.id, dto, token);
  }
}
