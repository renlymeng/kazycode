import { IsString, Length, Matches, IsOptional, IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  gameSlug: string;

  @IsUUID()
  packageId: string;

  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  playerId: string;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  playerServer?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\s-]{6,20}$/, { message: 'Invalid phone number format' })
  contactPhone?: string;
}
