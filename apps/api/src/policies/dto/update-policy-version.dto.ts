import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PolicyRulesDto } from './policy-rules.dto';

export class UpdatePolicyVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  effectiveFrom?: string;

  @IsOptional()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  @ArrayMinSize(0)
  @ArrayMaxSize(7)
  workingWeekdays?: number[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PolicyRulesDto)
  rules?: PolicyRulesDto;
}
