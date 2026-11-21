-- Aether City playable area 100 -> 250 (client zones.js bound must match; server uses it to clamp saved positions).
UPDATE world_zones SET bound=250 WHERE id='aether_city';
