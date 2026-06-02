-- AlterTable
ALTER TABLE "User" ADD COLUMN     "featureFlags" JSONB,
ADD COLUMN     "preferences" JSONB,
ADD COLUMN     "wishlist" TEXT[] DEFAULT ARRAY[]::TEXT[];
