import { z } from 'zod';
import { EJM_DOMAIN } from '../constants/config.js';

export const emailSchema = z.string().email('Please enter a valid email address');

export const ejemEmailSchema = z
  .string()
  .email('Please enter a valid email address')
  .refine((val) => val.toLowerCase().endsWith(`@${EJM_DOMAIN}`), {
    message: `Email must be an @${EJM_DOMAIN} address`,
  });

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters');

export const verificationCodeSchema = z
  .string()
  .length(6, 'Code must be 6 digits')
  .regex(/^\d{6}$/, 'Code must be 6 digits');

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
