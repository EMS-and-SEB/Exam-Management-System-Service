export default () => ({
  app: {
    port: Number(process.env.PORT ?? 3000),
    environment: process.env.NODE_ENV ?? 'development',
    staffPortalUrl: process.env.STAFF_PORTAL_URL ?? 'http://localhost:5173',
    corsOrigins: (process.env.CORS_ORIGIN ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresInMs: Number(process.env.JWT_REFRESH_EXPIRES_IN_MS ?? 7 * 24 * 60 * 60 * 1000),
  },

  throttle: {
    ttlMs: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
    limit: Number(process.env.THROTTLE_LIMIT ?? 100),
  },

  email: {
    from: process.env.EMAIL_FROM,
    smtp: {
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1025),
    },
    resendApiKey: process.env.RESEND_API_KEY,
  },
  
  seb: {
    clientKey: process.env.SEB_CLIENT_KEY,
    handshakeSecret: process.env.SEB_HANDSHAKE_SECRET,
  },
});