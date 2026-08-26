import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateSamlConnectionDto {
  @IsUUID()
  identityConnectionId!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,32}$/)
  cognitoProviderName!: string;

  @IsOptional()
  @IsObject()
  attributeMapping?: Record<string, string>;
}
