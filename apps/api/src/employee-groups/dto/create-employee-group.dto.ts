import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateEmployeeGroupDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsString()
  @Length(1, 50)
  code!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;
}
