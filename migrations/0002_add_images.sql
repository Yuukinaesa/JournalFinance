-- Migration: Add image_data column
ALTER TABLE entries ADD COLUMN image_data TEXT;
