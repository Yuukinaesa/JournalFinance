-- Migration: Add user preferences
ALTER TABLE users ADD COLUMN preferences TEXT;
