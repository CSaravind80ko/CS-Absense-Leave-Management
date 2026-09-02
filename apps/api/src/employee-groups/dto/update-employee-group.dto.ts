import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class UpdateEmployeeGroupDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;
}
