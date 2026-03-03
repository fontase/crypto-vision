-- Create the crypto_vision dataset
-- This is the top-level BigQuery dataset that contains all tables.
-- Run once:
--   bq mk --dataset --location=us-central1 --description="Crypto Vision data warehouse" PROJECT_ID:crypto_vision

CREATE SCHEMA IF NOT EXISTS crypto_vision
OPTIONS (
  location = 'us-central1',
  description = 'Crypto Vision — production crypto data warehouse',
  default_table_expiration_days = NULL,
  labels = [('env', 'production'), ('team', 'data')]
);
