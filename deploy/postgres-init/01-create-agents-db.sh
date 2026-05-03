#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  SELECT 'CREATE DATABASE agents'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agents')\gexec
  GRANT ALL PRIVILEGES ON DATABASE agents TO "$POSTGRES_USER";
EOSQL
