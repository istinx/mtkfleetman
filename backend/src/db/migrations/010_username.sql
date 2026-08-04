-- Run manually against an already-running deployment:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/010_username.sql

ALTER TABLE users RENAME COLUMN email TO username;
