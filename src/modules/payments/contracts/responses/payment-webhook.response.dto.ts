export class PaymentWebhookResponseDto {
  acknowledged!: boolean;
  paymentIntentId!: string | null;
  processingStatus!: string;
}