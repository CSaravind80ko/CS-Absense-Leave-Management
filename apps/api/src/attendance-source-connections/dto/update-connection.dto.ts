import { IsObject, IsOptional, IsString, Length } from 'class-validator';

export class UpdateConnectionDto {
  @IsOptional()
  @IsString()
  @Length(3, 200)
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  credentialReference?: string;
}
