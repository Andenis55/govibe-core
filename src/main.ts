import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfigService } from './shared/config/config.service';
import { CorrelationInterceptor } from './shared/interceptors/correlation.interceptor';
import { AppLoggerService } from './shared/logging/logger.service';
import { LoggingInterceptor } from './shared/logging/logging.interceptor';
import { PrismaService } from './shared/prisma/prisma.service';
import { RedisService } from './shared/redis/redis.service';
import { TelemetryService } from './shared/telemetry/telemetry.service';
import { TimingInterceptor } from './shared/telemetry/timing.interceptor';

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create(AppModule, {
		bufferLogs: true,
	});

	const config = app.get(AppConfigService);
	const logger = app.get(AppLoggerService);
	const telemetry = app.get(TelemetryService);
	const prisma = app.get(PrismaService);
	const redis = app.get(RedisService);
	const loggingInterceptor = app.get(LoggingInterceptor);
	const correlationInterceptor = app.get(CorrelationInterceptor);
	const timingInterceptor = app.get(TimingInterceptor);

	app.useLogger(logger);
	app.enableCors();
	app.enableShutdownHooks();
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
			forbidNonWhitelisted: true,
		}),
	);
	app.useGlobalInterceptors(
		loggingInterceptor,
		correlationInterceptor,
		timingInterceptor,
	);

	app.setGlobalPrefix('api');
	telemetry.record('app.bootstrap.initialized', {
		environment: config.get('NODE_ENV'),
	});
	await prisma.connect();
	await redis.connect();
	await redis.checkHealth();

	const port = config.getNumber('PORT');
	await app.listen(port);

	logger.log(`HTTP server listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
