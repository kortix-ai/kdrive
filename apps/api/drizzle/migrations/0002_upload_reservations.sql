ALTER TABLE "uploads" ADD COLUMN "added_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "action_paths_blocks_gin" ON "action_paths" USING gin ("block_hashes");