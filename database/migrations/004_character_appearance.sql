-- Per-agent character appearance. model_key = key in static/assets.json "characters" ('' -> 'agent'); texture_variant = tint hex ('' -> name hash).
ALTER TABLE agents ADD COLUMN model_key TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN texture_variant TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN outfit_variant TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN animation_profile TEXT NOT NULL DEFAULT 'default';
ALTER TABLE agents ADD COLUMN scale REAL NOT NULL DEFAULT 1.0;
ALTER TABLE agents ADD COLUMN voice_profile TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN expression_profile TEXT NOT NULL DEFAULT 'neutral';
UPDATE agents SET texture_variant='#c9a227', outfit_variant='executive_suit',  scale=1.04, expression_profile='stern'    WHERE name LIKE '%Solis%';
UPDATE agents SET texture_variant='#e8eef5', outfit_variant='lab_coat',        scale=1.00, expression_profile='curious'  WHERE name='Atlas';
UPDATE agents SET texture_variant='#35e0ff', outfit_variant='futuristic_guide',scale=0.97, expression_profile='friendly' WHERE name='Nova';
UPDATE agents SET texture_variant='#3a3f4b', outfit_variant='engineer_hoodie', scale=1.02, expression_profile='dry'      WHERE name='Cipher';
UPDATE agents SET texture_variant='#7a2e3b', outfit_variant='coordinator_blazer',scale=1.05, expression_profile='calm'    WHERE name='Orion';
UPDATE agents SET texture_variant='#6b8e5a', outfit_variant='librarian_cardigan',scale=0.96, expression_profile='gentle' WHERE name='Luna';
