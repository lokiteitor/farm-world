-- Opening entry of a new player (GDD section 117).
--
-- The ledger is auditable because the sum of its entries equals the balance, and
-- the smoke test of plan section 10 asserts exactly that, so the 160 000 a new
-- player opens with needs an entry of its own. Until this value existed the seed
-- used `COMPENSATION` with `meta.reason`, which made the audit depend on reading a
-- JSON field (docs/handoff/NOTES-w2d.md, item 3).
--
-- The value is appended, which is the only thing `ALTER TYPE ... ADD VALUE` does
-- without `BEFORE`/`AFTER`, and it is why `STARTING_CAPITAL` is last in the enum of
-- schema.prisma and in `LedgerType` of shared/domain/enums.ts. The order of the
-- three declarations has to stay identical for the enum parity to remain a
-- mechanical check.
--
-- PostgreSQL 12 and later admit the statement inside a transaction block, which is
-- how Prisma applies a migration, as long as the new value is not used in the same
-- transaction. Nothing here uses it: the first use is the seed, in a later session.

-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE 'STARTING_CAPITAL';
