import { IsString, IsUUID, Length } from 'class-validator';

export class CreateImportJobDto {
  @IsUUID()
  periodId!: string;

  @IsString()
  @Length(1, 50)
  source!: string;
}
