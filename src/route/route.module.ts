import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { GoogleModule } from '../google/google.module';
import { RouteController } from './route.controller';
import { RouteService } from './route.service';

@Module({
  imports: [CompanyModule, GoogleModule],
  controllers: [RouteController],
  providers: [RouteService],
})
export class RouteModule {}
