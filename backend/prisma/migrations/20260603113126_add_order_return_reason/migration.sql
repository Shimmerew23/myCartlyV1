-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "returnReason" TEXT;

-- NOTE: `prisma migrate dev` also auto-generated two spurious statements that were
-- removed by hand: a DROP of "Product_name_trgm_idx" and an ALTER ... DROP DEFAULT
-- on the generated "searchVector" column. Prisma cannot model the pg_trgm index or
-- the GENERATED tsvector column (Unsupported type), so it tries to "correct" them on
-- every migration. Strip those lines whenever they reappear. See migration
-- 20260602055220_product_fts.
