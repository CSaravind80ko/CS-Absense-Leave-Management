import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ExceptionStatus } from '@prisma/client';

export class DecideExceptionDto {
  @IsEnum(ExceptionStatus)
  decision!: ExceptionStatus;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  note?: string;
}
