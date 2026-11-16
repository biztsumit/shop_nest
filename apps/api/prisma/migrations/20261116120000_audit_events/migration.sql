-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(40) NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" VARCHAR(64) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_id_idx" ON "audit_events"("entity_type", "entity_id", "id" DESC);

-- CreateIndex
CREATE INDEX "audit_events_actor_id_id_idx" ON "audit_events"("actor_id", "id" DESC);

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Added by hand ----------

-- "variant.update", "order.ship": a kind of thing, a dot, what happened to it
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_format" CHECK ("action" ~ '^[a-z_]+\.[a-z_]+$');
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_entity_type_known"
  CHECK ("entity_type" IN ('product', 'category', 'order', 'coupon', 'review', 'user'));

-- APPEND-ONLY: a log that can be edited proves nothing. This trigger refuses every UPDATE and
-- DELETE of a row, whoever sends it (a bug in the app, a script, a person in psql). Adding rows
-- is the only change allowed. (TRUNCATE, which the tests use to start from an empty database,
-- doesn't run row triggers.)
CREATE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: rows can be added, never changed or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_or_delete
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
