// Manage a persistent WiFi connection
// Copyright © 2023 by Thorsten von Eicken

import config from "mc/config"
import Net from "net"
import Preference from "preference"
import Timer from "timer"
import WiFi, { type Modes, type AccessPointOptions } from "wifi"
import DNSServer from "dns/server"

export const MODES = ["off", "on"] // could all low-power later...
export const AP_MODES = ["off", "on", "boot", "alt"]

function trace(msg: string) {
  ;(globalThis as any).trace("Wifi: ")
  ;(globalThis as any).trace(msg)
}

function validatePassword(password: any): boolean {
  if (typeof password != "string" && password != undefined) return false
  return !password || (password.length >= 8 && password.length <= 63)
}

// read preferences for wifi client
let ssid = Preference.get("wifi", "ssid")?.toString()
let password = Preference.get("wifi", "password")?.toString()
let mode = Preference.get("wifi", "mode")?.toString()

// read preferences for wifi AP
let ap_mode = Preference.get("wifi", "ap_mode")?.toString()
let apInfo: AccessPointOptions = {
  ssid: Preference.get("wifi", "ap_ssid")?.toString() ?? "",
  password: Preference.get("wifi", "ap_password")?.toString() ?? "",
  channel: 6,
}
if (!validatePassword(apInfo.password)) apInfo.password = undefined // FIXME: kind'a insecure
{
  let ch = Preference.get("wifi", "ap_channel")
  if (typeof ch == "number" && ch >= 1 && ch <= 14) apInfo.channel = ch
}

// start the wifi manager (using a function here so temp variables can be released)
export function start() {
  // the wifi client params can be set using the config module for backwards compatibility
  // and for initialization purposes when flashing using mcconfig
  if (config.ssid) {
    Preference.set("wifi", "ssid", config.ssid.toString())
    ssid = config.ssid
  }
  if ("password" in config) {
    Preference.set("wifi", "password", config.password.toString())
    password = config.password
  }
  if (!mode || !(mode in MODES)) {
    mode = config.ssid ? "on" : "off"
    Preference.set("wifi", "mode", mode)
  }
  if (!ap_mode || !(ap_mode in AP_MODES)) {
    ap_mode = config.ap_ssid ? "on" : "off"
    Preference.set("wifi", "ap_mode", ap_mode)
  }
  trace(`ssid:${ssid || "-"} password:${password ? "******" : "-"} mode:${mode}\n`)
  trace(
    `AP ssid:${apInfo.ssid || "-"} password:${apInfo.password ? "******" : "-"} mode:${ap_mode}\n`
  )

  if (mode == "on") connect()
  if (1 || ap_mode == "on") startAP()
}

// ===== client/station management

let wifi_failures = 0
let wifi_retry: Timer | null = null
let wifi_isConnected = false
let connectCB: (() => void)[] = []
let disconnectCB: (() => void)[] = []

export function onConnect(cb: () => void) {
  connectCB.push(cb)
  if (wifi_isConnected) cb()
}
export function onDisconnect(cb: () => void) {
  disconnectCB.push(cb)
  if (!wifi_isConnected) cb()
}

// whether the wifi manager thinks it's connected to an AP
export function isConnected() {
  return wifi_isConnected
}

export function getMode() {
  return mode
}

export function setMode(m: string) {
  m = m.toLowerCase()
  if (MODES.indexOf(m) < 0) throw new Error("invalid mode")
  if (mode == m) return
  mode = m
  Preference.set("wifi", "mode", mode)
  // connect/disconnect
  if (mode == "on") connect()
  else disconnect()
}

export function setNetwork(ssid_: string, password_?: string) {
  ssid = ssid_
  password = password_
  // update values saved in flash
  if (ssid != Preference.get("wifi", "ssid")) Preference.set("wifi", "ssid", ssid)
  const old_password = Preference.get("wifi", "password")
  if (password && old_password != password) Preference.set("wifi", "password", password)
  else if (old_password != undefined) Preference.delete("wifi", "password")
  // reconnect if needed
  trace(`set: ssid:${ssid || "-"} password:${password ? "******" : "-"}\n`)
  if (wifi_isConnected) WiFi.disconnect() // will trigger reconnect
  else if (mode == "on") connect()
}

// kick the wifi: should be called when the wifi is thought to be connected but seems to
// not actually be working (e.g. connections time out)
export function kick() {
  if (wifi_isConnected) WiFi.disconnect() // will trigger reconnect
}

function disconnect() {
  //WiFi.mode = (WiFi.mode & ~1) as Modes
  WiFi.disconnect()
  if (wifi_retry) {
    Timer.clear(wifi_retry)
    wifi_retry = null
  }
  // we assume we'll get a disconnected event and that will take care of other stuff
}

// Persist in keeping WiFi connected, and provide callbacks when connected/disconnected.
// If WiFi connection fails, retry with exponential backoff.
function connect() {
  if (!ssid) return
  wifi_retry = null
  if (((WiFi.mode & 1) as number) == 0) WiFi.mode = (WiFi.mode | 1) as Modes

  // Wifi connection timeout
  const conn_timeout = Timer.set(() => {
    trace("connect timeout\n")
    retry()
  }, 20000)

  function retry() {
    if (wifi_retry) return
    wifi_failures++
    try {
      Timer.clear(conn_timeout)
    } catch (e) {}
    // retry... 1.4^19 is 598s
    if (mode == "on") {
      const delay = wifi_failures < 20 ? (1.4 ^ wifi_failures) * 1000 : 600_000 // max 10 mins
      wifi_retry = Timer.set(connect, delay)
    }
    WiFi.disconnect()
    if (wifi_isConnected) {
      wifi_isConnected = false
      for (const cb of disconnectCB) cb()
    }
  }

  try {
    // connect!
    trace(`connecting to "${ssid}"\n`)

    if (Net.get("SSID") == ssid) {
      trace(`already connected to "${ssid}"\n`)
      wifi_failures = 0
      wifi_isConnected = true
      Timer.clear(conn_timeout)
      for (const cb of connectCB) cb()
      return
    }

    const monitor = new WiFi({ ssid, password }, (msg, code) => {
      try {
        switch (msg) {
          case WiFi.gotIP:
            trace(`IP address ${Net.get("IP", "station")}\n`)
            wifi_failures = 0
            wifi_isConnected = true
            Timer.clear(conn_timeout)
            for (const cb of connectCB) cb()
            break

          case WiFi.connected:
            trace(`connected to "${Net.get("SSID")}"\n`)
            break

          case WiFi.disconnected:
            monitor.close()
            if (code == -1) {
              trace(`password ${password ? "rejected" : "required"}\n`)
              retry()
            } else {
              trace("disconnected\n")
              retry()
            }
            break
        }
      } catch (e: any) {
        trace(`: error in event handler: ${e.stack}\n`)
        retry()
      }
    })
  } catch (e: any) {
    trace(`: error connecting: ${e.stack}\n`)
    retry()
  }
}

// ===== AP management

export function getAPInfo() {
  return apInfo
}

export function setAPInfo(options: Record<string, string | number>) {
  if ("ssid" in options) apInfo.ssid = "" + options.ssid
  if ("password" in options && validatePassword(options.password))
    apInfo.password = "" + options.password
  if (
    "channel" in options &&
    typeof options.channel == "number" &&
    options.channel >= 1 &&
    options.channel <= 14
  )
    apInfo.channel = options.channel
  for (const k in apInfo) {
    if (apInfo[k] != Preference.get("wifi", "ap_" + k))
      Preference.set("wifi", "ap_" + k, apInfo[k] ?? "")
  }
}

export function getAPMode() {
  return ap_mode || "off"
}

export function setAPMode(m: string) {
  m = m.toLowerCase()
  if (AP_MODES.indexOf(m) < 0) throw new Error("invalid mode")
  if (ap_mode == m) return
  ap_mode = m
  Preference.set("wifi", "ap_mode", ap_mode)
  // start/stop
  if (ap_mode == "on") startAP()
  else stopAP()
}

function startAP() {
  WiFi.mode = (WiFi.mode | 2) as Modes
  if (!apInfo.ssid) {
    // the wifi AP params need to be initialized to _something_ so one can connect when
    // the device is just freshly flashed using a generic image
    // we'l use the MAC address but need to start the AP first to get it...
    WiFi.accessPoint({ ssid: "_", station: mode != "off" })
    const mac = Net.get("MAC", "ap")
    //trace(`** WiFi AP: MAC=${mac} IP=${Net.get("IP", "ap")}\n`)
    if (mac == "00:00:00:00:00:00") {
      // sometimes esp-idf needs a bit longer to init...
      Timer.set(() => {
        startAP()
      }, 100)
      return
    }
    apInfo.ssid = "ESP_" + Net.get("MAC", "ap").slice(-7).replaceAll(":", "")
    apInfo.password = "" // insecure...
  }
  trace("starting AP ssid=" + apInfo.ssid + "\n")
  const opts: AccessPointOptions = {
    ssid: apInfo.ssid,
    channel: apInfo.channel,
    station: mode != "off", // yuck, why is this mixed in here?
  }
  if (apInfo.password) opts.password = apInfo.password
  WiFi.accessPoint(opts)
  Timer.set(() => startCaptiveDNS(), 100)
}

function stopAP() {
  stopCaptiveDNS()
  WiFi.mode = (WiFi.mode & ~2) as Modes
  trace("stopped AP\n")
}

let dnsServer: any = undefined

function startCaptiveDNS() {
  if (dnsServer) return
  dnsServer = new DNSServer((message: number, value?: string): string => {
    return Net.get("IP", "ap")
  })
}

function stopCaptiveDNS() {
  if (!dnsServer) return
  dnsServer.close()
  dnsServer = undefined
}
