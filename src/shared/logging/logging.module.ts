import { Global, Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { LoggingInterceptor } from './logging.interceptor';
import { AppLoggerService } from './logger.service';

@Global()
@Module({
  imports: [ContextModule],
  providers: [AppLoggerService, LoggingInterceptor],
  exports: [AppLoggerService, LoggingInterceptor],
})
export class LoggingModule {}