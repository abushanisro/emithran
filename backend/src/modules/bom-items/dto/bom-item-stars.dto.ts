import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class BomItemStarsQueryDto {
  @ApiProperty({ format: 'uuid', description: 'The BOM whose starred items to list.' })
  @IsUUID()
  bomId!: string;
}

export class BomItemStarsDto {
  @ApiProperty({ type: [String], description: "The items of the BOM the caller starred (the caller's own stars only)." })
  bomItemIds!: string[];
}

export class BomItemStarDto {
  @ApiProperty({ format: 'uuid' })
  bomItemId!: string;

  @ApiProperty({ description: 'Whether the caller has the item starred after the call.' })
  starred!: boolean;
}
