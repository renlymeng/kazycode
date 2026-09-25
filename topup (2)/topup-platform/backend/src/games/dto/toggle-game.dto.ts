import { IsBoolean } from 'class-validator';

export class ToggleGameDto {
  @IsBoolean()
  isActive: boolean;
}
