interface User { id: string; email: string; [key: string]: any; }
import { BadRequestException, Body, Controller, Get, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { AVATAR_MAX_BYTES } from './avatar';
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

  @Post('avatar')
  @ApiOperation({ summary: 'Upload a new profile photo (JPEG, PNG or WebP, at most 2 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, type: ProfileResponseDto })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }))
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<ProfileResponseDto> {
    if (!file) throw new BadRequestException('Attach the photo as "file".');
    return this.profileService.uploadAvatar(user.id, file.buffer, token);
  }
}
