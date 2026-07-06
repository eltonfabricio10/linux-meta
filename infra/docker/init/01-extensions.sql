-- Habilita extensões necessárias no primeiro boot do Postgres.
-- pg_trgm: busca fuzzy nos nomes de pacotes.
-- citext: emails case-insensitive (Better Auth).
-- vector: embeddings semânticos (Fase 6).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;
