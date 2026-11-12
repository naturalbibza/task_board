import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadServerEnv } from '@task-board/shared';
import * as schema from './schema';

export const env = loadServerEnv();

export const db = drizzle(new Pool({ connectionString: env.DATABASE_URL }), { schema });
