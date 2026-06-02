-- Full-text search for products
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Immutable wrapper so it can drive a generated column
-- (array_to_string / array output funcs are only STABLE on their own).
CREATE OR REPLACE FUNCTION product_search_vector(n text, t text[], b text, d text)
RETURNS tsvector
LANGUAGE sql IMMUTABLE
AS $$
  SELECT setweight(to_tsvector('english'::regconfig, coalesce(n, '')), 'A') ||
         setweight(to_tsvector('english'::regconfig, coalesce(array_to_string(t, ' '), '')), 'B') ||
         setweight(to_tsvector('english'::regconfig, coalesce(b, '')), 'B') ||
         setweight(to_tsvector('english'::regconfig, coalesce(d, '')), 'C')
$$;

ALTER TABLE "Product" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (product_search_vector("name", "tags", "brand", "description")) STORED;

CREATE INDEX "Product_searchVector_idx" ON "Product" USING GIN ("searchVector");
CREATE INDEX "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
