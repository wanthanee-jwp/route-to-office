import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RouteRequestDto } from './dto/route-request.dto';
import { RouteResponseDto } from './dto/route-response.dto';
import { RouteService } from './route.service';

@ApiTags('route')
@Controller('api')
export class RouteController {
  constructor(private readonly routeService: RouteService) {}

  @Post('route')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RouteResponseDto })
  async computeRoute(@Body() body: RouteRequestDto): Promise<RouteResponseDto> {
    return this.routeService.computeRoute(body.lat, body.lng);
  }
}
