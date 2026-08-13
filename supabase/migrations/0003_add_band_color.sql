-- Migration 0003: Add color column to bands table
ALTER TABLE bands ADD COLUMN IF NOT EXISTS color text DEFAULT '#6b21a8';
