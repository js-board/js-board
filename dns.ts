// Set-up the DNS resolver to use
// Copyright © 2023 by Thorsten von Eicken

import config from "mc/config"
import Preference from "preference"
import UDP from "embedded:io/socket/udp"
import Resolver from "embedded:network/dns/resolver/udp"
import Net from "net"

// In order to pull-in any DHCP servers this function must be called after the network
// (e.g. WiFi) is up/connected
export function start() {
  let servers: string[] = []
  if (globalThis.mcsim) return // mcsim doesn't do this stuff...

  // update saved preferences with any config passed in
  if (config.dns) {
    Preference.set("dns", "servers", config.dns)
    servers = config.dns.split(",")
  } else {
    servers = Preference.get("dns", "servers")?.toString().split(",") || []
  }

  if (!servers.length) {
    servers = Net.get("DNS")
  }

  globalThis.device.network!.dns = {
    io: Resolver,
    servers,
    socket: {
      io: UDP,
    },
  }
}
