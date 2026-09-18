import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { RoutesClientService } from './routes-client.service';

@Module({
  imports: [HttpModule],
  providers: [RoutesClientService],
  exports: [RoutesClientService],
})
export class GoogleModule {}
