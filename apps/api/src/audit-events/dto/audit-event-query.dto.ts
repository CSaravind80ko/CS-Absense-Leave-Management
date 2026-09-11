import { IsDateString, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PageQueryDto } from '../../common/dto/page-query.dto';

export class AuditEventQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  entityType?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  actorSubject?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateTo?: string;
}
