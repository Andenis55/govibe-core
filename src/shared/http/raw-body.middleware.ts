import { Injectable, NestMiddleware } from '@nestjs/common';
import { json } from 'express';

@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  use(req: unknown, res: unknown, next: () => void): void {
    json({
      verify: (request, _response, buffer) => {
        (request as { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      },
    })(req as never, res as never, next);
  }
}