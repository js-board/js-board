// Start-up SNTP (network time) client
// Copyright © 2023 by Thorsten von Eicken

import config from "mc/config"
import Preference from "preference"
import Net from "net"
import SNTP from "sntp"
import Time from "time"
import Timer from "timer"

// In order to pull-in any DHCP settings this function must be called after the network
// (e.g. WiFi) is up/connected
export function start() {
  let servers: string[] = []
  if (globalThis.mcsim) return // mcsim doesn't do this stuff...

  // update saved preferences with any config passed in
  if (config.ntp) {
    Preference.set("ntp", "servers", config.ntp)
    servers = config.ntp.split(",")
  } else {
    servers = Preference.get("ntp", "servers")?.toString().split(",") || []
  }

  if (!servers.length) {
    servers = Net.get("DNS").concat("pool.ntp.org")
  }

  start_ntp(servers)
}

function start_ntp(servers: string[]) {
  const server = servers[0]
  if (!server) return

  new SNTP({ host: server }, function (message, value) {
    if (message === SNTP.time && value) {
      const old = Date.now()
      Time.set(value)
      const now = Date.now()
      trace(`SNTP: ${new Date().toISOString()} (delta ${now - old}s) from ${server}\n`)
      Timer.set(() => start_ntp(servers), 3600_000)
    } else {
      trace("SNTP: querying ${server} failed\n")
      servers.push(servers.shift()!)
      Timer.set(() => start_ntp(servers), 60_000)
    }
  })
}
