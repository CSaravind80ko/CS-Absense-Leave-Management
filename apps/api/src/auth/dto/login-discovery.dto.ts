import { IsString, Length, Matches } from 'class-validator';

export class LoginDiscoveryDto {
  @IsString()
  @Length(2, 253)
  @Matches(/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/, {
    message: 'organization must be an organization slug or verified domain',
  })
  organization!: string;
}
