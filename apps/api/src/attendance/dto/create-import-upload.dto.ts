import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateImportUploadDto {
  @IsString()
  @Length(1, 255)
  fileName!: string;

  @IsString()
  @Length(1, 100)
  contentType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024 * 1024)
  sizeBytes!: number;

  @Matches(/^[a-f0-9]{64}$/)
  checksumSha256!: string;
}
