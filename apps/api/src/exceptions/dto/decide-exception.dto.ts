import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsString, Length, Min } from 'class-validator';
import { ExceptionStatus } from '@prisma/client';

export class DecideExceptionDto {
  @IsEnum(ExceptionStatus)
  decision!: ExceptionStatus;

  @IsString()
  @Length(3, 1000)
  note!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
