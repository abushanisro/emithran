import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type AlertKind =
  | 'rfq_pending'
  | 'cost_spike'
  | 'stale_lot'
  | 'missing_plan'
  | 'cost_outlier'
  | 'missing_drawing';

export type AlertSeverity = 'info' | 'warn' | 'urgent';

export class AlertDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  kind!: AlertKind;

  @ApiProperty({ enum: ['info', 'warn', 'urgent'] })
  severity!: AlertSeverity;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional()
  body?: string;

  @ApiPropertyOptional()
  linkRoute?: string;

  @ApiPropertyOptional({ description: 'AI-suggested next action' })
  nextAction?: string;

  @ApiPropertyOptional()
  sourceEntityType?: string;

  @ApiPropertyOptional()
  sourceEntityId?: string;

  @ApiProperty()
  createdAt!: string;
}
