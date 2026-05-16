import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';

@Injectable()
export class SignatureKeyStoreService {
  constructor(private readonly configService: AppConfigService) {}

  getHmacSecret(keyId: string): string {
    const currentKeyId = this.configService.getOrThrow('QR_HMAC_ACTIVE_KID');

    if (keyId !== currentKeyId) {
      const rotated = this.configService.get(`QR_HMAC_SECRET_${keyId}`);

      if (!rotated || typeof rotated !== 'string') {
        throw new Error(`Unknown HMAC key id: ${keyId}`);
      }

      return rotated;
    }

    return this.configService.getOrThrow('QR_HMAC_ACTIVE_SECRET');
  }

  getEd25519PublicKey(keyId: string): string {
    const key = this.configService.get(`QR_ED25519_PUBLIC_KEY_${keyId}`);

    if (!key || typeof key !== 'string') {
      throw new Error(`Unknown Ed25519 public key id: ${keyId}`);
    }

    return key;
  }
}