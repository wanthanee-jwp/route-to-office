import { ApiProperty } from '@nestjs/swagger';

// Shape matches requirement.md §6 exactly. Frozen once the frontend team
// starts building against it — changes must be announced to both sides.

class DistanceDto {
  @ApiProperty({ example: 12400 }) meters!: number;
  @ApiProperty({ example: '12.4 km' }) text!: string;
}

class DurationDto {
  @ApiProperty({ example: 1680 }) seconds!: number;
  @ApiProperty({ example: '28 min' }) text!: string;
}

class LatLngDto {
  @ApiProperty({ example: 13.7465 }) lat!: number;
  @ApiProperty({ example: 100.535 }) lng!: number;
}

export class RouteResponseDto {
  @ApiProperty({ type: DistanceDto }) distance!: DistanceDto;
  @ApiProperty({ type: DurationDto }) duration!: DurationDto;
  @ApiProperty({
    type: DurationDto,
    description: 'Duration without traffic — lets the frontend show how much worse traffic is now.',
  })
  staticDuration!: DurationDto;
  @ApiProperty({ example: 480 }) trafficDelaySeconds!: number;
  @ApiProperty({ example: 'ktp~AqvyhVrAaB...' }) polyline!: string;
  @ApiProperty({ type: LatLngDto }) origin!: LatLngDto;
  @ApiProperty({ type: LatLngDto }) destination!: LatLngDto;
  @ApiProperty({ example: '2026-09-18T14:32:10+07:00' }) computedAt!: string;
  @ApiProperty({ example: false }) cached!: boolean;
}
