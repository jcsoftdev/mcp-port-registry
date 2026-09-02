export const DEFAULT_TECHNOLOGIES: Record<string, number> = {
  postgresql: 5432,
  mysql: 3306,
  redis: 6379,
  mongodb: 27017,
  nextjs: 3000,
  vite: 5173,
  express: 3000,
  fastapi: 8000,
  django: 8000,
  flask: 5000,
  minio: 9000,
  grafana: 3000,
  rabbitmq: 5672,
  elasticsearch: 9200,
  nginx: 8080,
};

import type { Database } from "bun:sqlite";

/** Base port for a built-in or user-added technology; undefined when unknown. */
export function resolveBasePort(db: Database, technology: string): number | undefined {
  const builtin = DEFAULT_TECHNOLOGIES[technology];
  if (builtin !== undefined) return builtin;
  const row = db
    .query<{ base_port: number }, [string]>("SELECT base_port FROM custom_technologies WHERE name = ?")
    .get(technology);
  return row?.base_port;
}
