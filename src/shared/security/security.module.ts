import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { QrTokenVerifierService } from './qr-token-verifier.service';
import { SignatureKeyStoreService } from './signature-key-store.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    SignatureKeyStoreService,
    QrTokenVerifierService,
    {
      provide: 'QR_TOKEN_VERIFIER',
      useExisting: QrTokenVerifierService,
    },
  ],
  exports: ['QR_TOKEN_VERIFIER', QrTokenVerifierService, SignatureKeyStoreService],
})
export class SecurityModule {}