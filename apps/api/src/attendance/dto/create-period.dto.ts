import { IsDateString, IsString, Length } from 'class-validator';

export class CreatePeriodDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsDateString({ strict: true })
  startsOn!: string;

  @IsDateString({ strict: true })
  endsOn!: string;
}
