-- Remove bands.created_by — redundant with band_members.role = 'admin'.
-- Admin membership already tracks who created/owns the band.

-- Drop policy and index that reference the column
DROP POLICY IF EXISTS "bands: authenticated can insert" ON bands;
DROP POLICY IF EXISTS "bands: creator can delete" ON bands;
DROP INDEX IF EXISTS idx_bands_created_by;

-- Drop FK and column
ALTER TABLE bands DROP CONSTRAINT IF EXISTS bands_created_by_fkey;
ALTER TABLE bands DROP COLUMN IF EXISTS created_by;

-- Replace delete policy: any band admin can delete
CREATE POLICY "bands: admins can delete"
  ON bands FOR DELETE
  USING (
    id IN (
      SELECT band_id FROM band_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Insert no longer needs created_by check — any authenticated user can create a band
CREATE POLICY "bands: authenticated can insert"
  ON bands FOR INSERT
  WITH CHECK (true);
