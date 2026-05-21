import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://selfbase:selfbase@localhost:5432/selfbase',
  },
  strict: true,
  verbose: false,
} satisfies Config;
