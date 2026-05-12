import { IsBoolean } from 'class-validator';

export class SetDriverPresenceDto {
  @IsBoolean()
  online!: boolean;
}
