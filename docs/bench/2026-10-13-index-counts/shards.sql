-- Which files are asked for, per UTC day. subjects.json is asked once per `ludion sync` that gets that far,
-- so its row is the closest thing to a count of syncs.
SELECT
  blob1 AS day,
  blob2 AS path,
  SUM(_sample_interval) AS requests
FROM ludion_index_hits
WHERE timestamp > NOW() - INTERVAL '8' DAY
GROUP BY day, path
ORDER BY day, path
FORMAT JSON
