-- Carrier: fill in the model (table previously held only id + timestamps).
ALTER TABLE "Carrier"
  ADD COLUMN "name" TEXT NOT NULL,
  ADD COLUMN "code" TEXT NOT NULL,
  ADD COLUMN "trackingUrlTemplate" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Carrier_code_key" ON "Carrier"("code");
CREATE INDEX "Carrier_isActive_sortOrder_idx" ON "Carrier"("isActive", "sortOrder");

-- Warehouse: fill in the model (table previously held only id + manager + timestamps).
ALTER TABLE "Warehouse"
  ADD COLUMN "name" TEXT NOT NULL,
  ADD COLUMN "code" TEXT NOT NULL,
  ADD COLUMN "address" JSONB NOT NULL,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notes" TEXT;

CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");
