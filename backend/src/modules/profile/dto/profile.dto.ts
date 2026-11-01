import { IsString, IsOptional, IsUrl, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Display name shown across the app', example: 'Jane Smith' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  displayName?: string;

  // Uploads record the stored key server-side (POST /profile/avatar); here only clearing (null or '') or an https image URL is accepted.
  @ApiPropertyOptional({ description: 'https URL of an avatar image, or null/empty to clear it', nullable: true })
  @ValidateIf((_dto, value) => value !== '' && value != null)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  avatarUrl?: string | null;

  @ApiPropertyOptional({ description: 'Short bio', example: 'Senior Manufacturing Engineer' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({ description: 'Job title', example: 'Principal Engineer' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  jobTitle?: string;

  @ApiPropertyOptional({ description: 'Contact phone number' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ description: 'IANA timezone string', example: 'Asia/Kolkata' })
  @IsString()
  @IsOptional()
  timezone?: string;
}

export class ProfileResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiPropertyOptional() displayName: string | null;
  @ApiPropertyOptional() avatarUrl: string | null;
  @ApiPropertyOptional() bio: string | null;
  @ApiPropertyOptional() jobTitle: string | null;
  @ApiPropertyOptional() phone: string | null;
  @ApiProperty() timezone: string;
  @ApiProperty() email: string;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
