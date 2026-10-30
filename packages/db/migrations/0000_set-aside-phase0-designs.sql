-- Phase 0's sync server kept test designs in a "designs" table with no org or client. Set it
-- aside so the designs table below can be created; nothing reads it.
ALTER TABLE IF EXISTS "designs" RENAME TO "phase0_designs";
--> statement-breakpoint
ALTER INDEX IF EXISTS "designs_pkey" RENAME TO "phase0_designs_pkey";
