-- Existing seed/legacy rows have no person; do not invent a principal for them.
ALTER TABLE appthrust_demo_messages
  ADD COLUMN IF NOT EXISTS author_principal TEXT,
  ADD COLUMN IF NOT EXISTS author_display_name TEXT;
