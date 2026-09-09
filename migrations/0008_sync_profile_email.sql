-- Migration 0008 (RH-42): keep profiles.email in step with "user".email.
--
-- `"user".email` is the login identity. Since RH-42 the row that moves it is
-- written by Better Auth's own `/api/auth/verify-email` handler, with no
-- application code on the stack, so `profiles.email` cannot be updated "next to
-- it" by our SQL. A database hook would fire only after the user row is already
-- committed-visible to that statement, which re-creates exactly the divergence
-- F12 warns about; a trigger runs in the SAME transaction as the UPDATE, so the
-- two identity rows cannot disagree - whoever writes the auth row (Better Auth,
-- a future admin tool, a psql session during an incident), the profile follows
-- atomically or neither moves.
--
-- Both objects are guarded so re-applying this file is a no-op.

CREATE OR REPLACE FUNCTION sync_profile_email() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE profiles SET email = NEW.email WHERE id = NEW.id;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_email_on_user_update ON "user";

CREATE TRIGGER sync_profile_email_on_user_update
    AFTER UPDATE OF email ON "user"
    FOR EACH ROW
    WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION sync_profile_email();

-- One-shot backfill of any drift that predates the trigger (the two-statement
-- write this migration replaces could leave the rows disagreeing only if it
-- failed between them, but a database that has been edited by hand can).
UPDATE profiles p SET email = u.email
FROM "user" u WHERE p.id = u.id AND p.email IS DISTINCT FROM u.email;
