import { Injectable, Logger, type LoggerService } from '@nestjs/common';
import { RequestContextService } from '../context/request-context.service';

@Injectable()
export class AppLoggerService implements LoggerService {
  private readonly logger = new Logger('GoVibe');

  constructor(private readonly requestContext: RequestContextService) {}

  private format(message: string): string {
    const correlationId = this.requestContext.getCorrelationId();

    if (!correlationId) {
      return message;
    }

    return `[corr:${correlationId}] ${message}`;
  }

  log(message: string, context?: string): void {
    this.logger.log(this.format(message), context);
  }

  warn(message: string, context?: string): void {
    this.logger.warn(this.format(message), context);
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.error(this.format(message), trace, context);
  }

  debug(message: string, context?: string): void {
    this.logger.debug(this.format(message), context);
  }

  verbose(message: string, context?: string): void {
    this.logger.verbose(this.format(message), context);
  }

  fatal(message: string, trace?: string, context?: string): void {
    this.logger.fatal?.(this.format(message), trace, context);
  }
}