import { IsEnum, IsOptional } from 'class-validator';
import { PolicyRecomputeStatus } from '@prisma/client';
import { PageQueryDto } from '../../common/dto/page-query.dto';

export class RecomputeJobQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(PolicyRecomputeStatus)
  status?: PolicyRecomputeStatus;
}
