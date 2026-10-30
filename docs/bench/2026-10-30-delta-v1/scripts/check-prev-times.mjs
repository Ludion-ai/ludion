// After the result (README, "A substitute publish time"): does the registry's packument `time` hold each previous
// version Software Heritage was asked about? Registry metadata only; package names are the only thing sent.
// First run 2026-10-30 07:48Z; committed after review and run again. Usage: node check-prev-times.mjs
for (const [name, version] of [["dialogflow-es", "1.1.0"], ["dashboard-empty-state", "1.0.2"], ["rxnt-healthchecks-nestjs", "1.0.1-alpha-1609"], ["amazon-chime-sdk-js-exp", "10.10.11"]]) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { headers: { "user-agent": "Ludion-Backtest (read-only)" } });
  const doc = res.ok ? await res.json() : null;
  console.log(name, version, res.status, "time:", doc?.time?.[version] ?? "absent", "versions listed:", Object.keys(doc?.versions ?? {}).length);
}
