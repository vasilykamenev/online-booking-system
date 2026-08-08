import { z } from "zod";

export const paymentBookingSchema = z.object({
  bookingId: z.guid(),
});

export const confirmBankTransferSchema = z.object({
  paymentId: z.guid(),
});
