-- Change Better Auth user/account/session id columns from text to uuid.
--
-- Better Auth is configured with generateId: () => crypto.randomUUID() so all
-- IDs are valid UUIDs. Changing the column type enables a real FK from
-- profiles.id → "user".id ON DELETE CASCADE (uuid↔uuid, no type mismatch).

-- Drop FKs that reference "user".id before altering the column type
ALTER TABLE "account" DROP CONSTRAINT IF EXISTS "account_userId_fkey";
ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "session_userId_fkey";
ALTER TABLE profiles  DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Cast id columns to uuid (values are already valid UUID strings)
ALTER TABLE "account" ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid;
ALTER TABLE "session" ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid;
ALTER TABLE "user"    ALTER COLUMN id        TYPE uuid USING id::uuid;

-- Restore internal Better Auth FKs
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE;
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE;

-- Add proper profiles → "user" FK (now both sides are uuid)
ALTER TABLE profiles ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES "user"(id) ON DELETE CASCADE;
