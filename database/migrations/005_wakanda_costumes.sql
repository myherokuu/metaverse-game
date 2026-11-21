-- Wakanda agents wear original red/gold (guards) or bronze/gold (others) costumes; the client draws them from outfit_variant.
UPDATE agents SET outfit_variant = CASE WHEN role LIKE '%Guard%' OR role LIKE '%Security%' THEN 'wakanda_guard' ELSE 'wakanda_royal' END
 WHERE zone = 'wakanda' AND outfit_variant = '';
