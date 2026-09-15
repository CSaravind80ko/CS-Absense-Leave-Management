import { IsEnum, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { AttendanceSourceType } from '@prisma/client';

export class CreateConnectionDto {
  @IsEnum(AttendanceSourceType)
  type!: AttendanceSourceType;

  @IsString()
  @Length(3, 200)
  name!: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  credentialReference?: string;
}
