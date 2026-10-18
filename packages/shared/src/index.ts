// zod-схемы документов пользователя и API-контрактов, общие типы (разделы 5, 14).
// Полный набор схем — этап M2.
import { z } from 'zod';

export const ServerIdSchema = z.enum(['asia', 'tw_hk_mo', 'europe', 'america']);
export type ServerId = z.infer<typeof ServerIdSchema>;
