-- Initialisation of the PostgreSQL cluster.
--
-- The official entrypoint runs this file exactly once, when the data volume is
-- empty, against the database named by POSTGRES_DB. It must therefore contain
-- only cluster-level settings: the schema itself belongs to Prisma migrations
-- (backend/prisma/migrations), which are the single source of truth for tables,
-- constraints and triggers.

-- Every instant with simulation or economic meaning is stored as gameMs, a
-- BigInt (plan section 6.1). The few real-world instants kept for tracing are
-- read back in UTC so that a server relocation cannot reinterpret them.
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
    EXECUTE format('ALTER DATABASE %I SET default_transaction_isolation TO %L',
                   current_database(), 'read committed');
END
$$;

-- READ COMMITTED is deliberate, not a default left untouched: the hard
-- constraints of plan section 5.4 rely on PostgreSQL serialising the writers of
-- a single row and re-evaluating the CHECK against the committed value. A
-- stricter level would turn those into serialisation failures that the
-- application would have to retry for no gain.

-- No geospatial extension is installed. All geometry is grid aligned and the
-- chunk key is the natural spatial index (plan section 5.1).
