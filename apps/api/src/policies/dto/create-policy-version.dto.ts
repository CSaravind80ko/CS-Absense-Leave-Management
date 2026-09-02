import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PolicyScopeType } from '@prisma/client';
import { PolicyRulesDto } from './policy-rules.dto';

export class CreatePolicyVersionDto {
  @IsEnum(PolicyScopeType)
  scopeType!: PolicyScopeType;

  // Required unless scopeType is TENANT, where the service forces scopeId = tenantId.
  @IsOptional()
  @IsUUID()
  scopeId?: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsDateString({ strict: true })
  effectiveFrom!: string;

  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  @ArrayMinSize(0)
  @ArrayMaxSize(7)
  workingWeekdays!: number[];

  @ValidateNested()
  @Type(() => PolicyRulesDto)
  rules!: PolicyRulesDto;
}
