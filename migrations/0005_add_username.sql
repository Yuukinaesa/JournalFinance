-- Migration: Add username column to users table
ALTER TABLE users ADD COLUMN username TEXT UNIQUE;
