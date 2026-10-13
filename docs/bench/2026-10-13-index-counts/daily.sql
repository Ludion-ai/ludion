-- Distinct clients per UTC day and per CLI label, with the shard requests behind them.
-- A client is one (IP address, User-Agent) pair on one day: the key is rotated daily, so the same machine is a new client each day.
-- index1 is the key, so Analytics Engine's sampling is per client and the distinct count is not thinned by it.
SELECT
  blob1 AS day,
  blob3 AS client,
  COUNT(DISTINCT index1) AS clients,
  SUM(_sample_interval) AS requests
FROM ludion_index_hits
WHERE timestamp > NOW() - INTERVAL '8' DAY
GROUP BY day, client
ORDER BY day, client
FORMAT JSON
