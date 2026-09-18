import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber } from 'class-validator';

// The global ValidationPipe is configured with forbidNonWhitelisted: true
// (requirement.md §6), so extra fields on the request are rejected outright
// rather than silently ignored — that keeps the contract explicit.

export class RouteRequestDto {
  @ApiProperty({ example: 13.7465, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 100.535, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  lng!: number;
}
