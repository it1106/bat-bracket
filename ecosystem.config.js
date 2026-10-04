// PM2 config for ezebat.com. Cluster mode + `pm2 reload` gives zero-downtime
// restarts. Pointing at next/dist/bin/next directly (instead of `npm start`)
// so PM2 can fork via the Node cluster module — npm-spawned children would
// each try to bind port 3000 independently and the second would EADDRINUSE.
//
// max_memory_restart: the LXC container has 6 GB. Restart a worker before it
// can OOM-kill the whole pm2 daemon (which takes the app fully offline —
// recovery requires a container reboot), but keep the limit above Node's own
// ~2.2 GB heap ceiling: at 2000M, PM2 was restarting the worker on spikes that
// Node would have collected. Leave room for a build plus a second worker
// starting up during a reload.
module.exports = {
  apps: [{
    name: "bat-bracket",
    script: "./node_modules/next/dist/bin/next",
    args: "start",
    cwd: "/root/app",
    instances: 2,
    exec_mode: "cluster",
    max_memory_restart: "3000M",
    // Node's own heap ceiling, set above max_memory_restart so that PM2
    // replaces a bloated worker gracefully before Node aborts on its own
    // (which drops the requests in flight). At the default ~2.2 GB the worker
    // was aborting during startup and index rebuilds. If it ever does abort,
    // the report says why — PM2 loses a dying worker's last output.
    node_args: [
      "--max-old-space-size=3584",
      "--report-on-fatalerror",
      "--report-compact",
      "--report-directory=/root/app/.cache/crash-reports",
    ],
    env: { NODE_ENV: "production" },
  }],
}
