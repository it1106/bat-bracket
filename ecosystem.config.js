// PM2 config for ezebat.com. Cluster mode + `pm2 reload` gives zero-downtime
// restarts. Pointing at next/dist/bin/next directly (instead of `npm start`)
// so PM2 can fork via the Node cluster module — npm-spawned children would
// each try to bind port 3000 independently and the second would EADDRINUSE.
//
// max_memory_restart: the LXC container is capped at 3 GB; restart a worker
// before it can OOM-kill the whole pm2 daemon (which takes the app fully
// offline — recovery requires a container reboot).
module.exports = {
  apps: [{
    name: "bat-bracket",
    script: "./node_modules/next/dist/bin/next",
    args: "start",
    cwd: "/root/app",
    instances: 2,
    exec_mode: "cluster",
    max_memory_restart: "2000M",
    env: { NODE_ENV: "production" },
  }],
}
