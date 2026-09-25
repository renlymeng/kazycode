import { IsString, Length, Matches, IsOptional } from 'class-validator';

export class ValidatePlayerIdDto {
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: 'Player ID contains invalid characters' })
  playerId: string;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: 'Server/zone ID contains invalid characters' })
  playerServer?: string;
}
