import pg from 'pg';

export async function applyProvisionDefaults(client: pg.Client): Promise<void> {
  await client.query('ALTER DATABASE postgres SET statement_timeout = 8000;');
}
