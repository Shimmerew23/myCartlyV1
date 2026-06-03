-- Recreate PaymentMethod enum as paypal | gcash | cod (drop stripe + bank_transfer, add gcash).
-- PostgreSQL can't drop enum values in place, so swap the type. Safe: no rows use the
-- removed values (Order.paymentMethod has no default to migrate).
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
CREATE TYPE "PaymentMethod" AS ENUM ('paypal', 'gcash', 'cod');
ALTER TABLE "Order" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod" USING ("paymentMethod"::text::"PaymentMethod");
DROP TYPE "PaymentMethod_old";

-- Remove Stripe-specific seller field.
ALTER TABLE "SellerProfile" DROP COLUMN "stripeAccountId";
