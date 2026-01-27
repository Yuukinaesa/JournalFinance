-- Migration to add token_version for global logout functionality
ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 1;
