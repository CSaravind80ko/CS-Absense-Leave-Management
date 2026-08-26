import { IsBoolean } from 'class-validator';

export class UpdateTenantUserMfaDto {
  @IsBoolean()
  required!: boolean;
}
