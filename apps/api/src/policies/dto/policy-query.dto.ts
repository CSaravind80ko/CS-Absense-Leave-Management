import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PolicyScopeType, PolicyVersionStatus } from '@prisma/client';
import { PageQueryDto } from '../../common/dto/page-query.dto';

export class PolicyQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(PolicyScopeType)
  scopeType?: PolicyScopeType;

  @IsOptional()
  @IsUUID()
  scopeId?: string;

  @IsOptional()
  @IsEnum(PolicyVersionStatus)
  status?: PolicyVersionStatus;
}
