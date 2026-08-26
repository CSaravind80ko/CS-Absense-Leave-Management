import { IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateSamlMetadataDto {
  @IsOptional()
  @IsUrl(
    { require_protocol: true, require_tld: false },
    { message: 'metadataUrl must be a URL' },
  )
  metadataUrl?: string;

  @IsOptional()
  @IsString()
  metadataXml?: string;
}
