-- Seed the address allowlist for local development / demos.
-- Run: npm run db:seed:local
INSERT OR IGNORE INTO addresses (id, label, created_at) VALUES
  ('addr-0001', '10 Maple Court', '2025-01-01T00:00:00.000Z'),
  ('addr-0002', '12 Maple Court', '2025-01-01T00:00:00.000Z'),
  ('addr-0003', '42 Oak Street', '2025-01-01T00:00:00.000Z'),
  ('addr-0004', '7 Birch Lane', '2025-01-01T00:00:00.000Z'),
  ('addr-0005', '221 Cedar Avenue', '2025-01-01T00:00:00.000Z');
