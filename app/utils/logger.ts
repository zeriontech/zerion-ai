// app/utils/logger.ts
export const logger = {
  info:  (msg: string, data?: any) => console.log(`[INFO]  ${new Date().toISOString()} ${msg}`, data || ''),
  error: (msg: string, data?: any) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, data || ''),
  warn:  (msg: string, data?: any) => console.warn(`[WARN]  ${new Date().toISOString()} ${msg}`, data || ''),
}
