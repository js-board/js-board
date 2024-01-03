// Simple 'mod' host
// Copyright © 2023 by Thorsten von Eicken

import Modules from "modules"
import Timer from "timer"
import Time from "time"
import { restart } from "sys"
import * as WiFiMan from "js-board/wifi-man"
import * as DNS from "js-board/dns"
import * as SNTP from "js-board/sntp"
import * as HTTPAdmin from "js-board/http-admin"

declare global {
  var mcsim: boolean
}

// ensure global.device.network exists and is not frozen so we can add stuff to it as the network
// initializes -- note that in mcsim there is no globalThis.device
if ("device" in globalThis) {
  const dn = globalThis.device.network
  if (!dn) globalThis.device = { ...globalThis.device, network: {} }
  else if (Object.isFrozen(dn)) globalThis.device = { ...globalThis.device, network: { ...dn } }
  globalThis.mcsim = false
} else {
  globalThis.mcsim = true
}

let app: Record<string, any> | undefined
//let mqtt: AsyncMqttClient | undefined

let booting_app = false // true while app is booting
let booting = true // true for the first minute of operation
Timer.set(() => {
  booting = false
}, 60_000)

function boot_app() {
  if (!Modules.has("check")) throw new Error(`no app found\n`)
  ;(Modules.importNow("check") as () => void)()
  if (!Modules.has("app")) throw new Error(`mod has no module 'app'\n`)
  booting_app = true
  app = Modules.importNow("app") as Record<string, any>
  trace("** Init app\n")
  if ("init" in app) {
    app.init()
    Timer.set(() => {
      booting_app = false
    }, 100)
  } else trace("No app.init()\n")
}

let last_abort: number | undefined = undefined

;(globalThis as any).abort = function (msg: string, exception: Error) {
  trace("\n** ABORT: ")
  trace(msg)
  trace("\n") // avoid allocating memory
  if (last_abort && Time.delta(last_abort) < 10_000) {
    trace("** 2x in a row: restarting\n")
    return true // abort/reset
  }
  last_abort = Time.ticks
  ;(globalThis as any).last_abort_msg = msg

  if (exception && exception.stack) trace(exception.stack)
  else trace(exception.toString())
  trace("\nRestarting in 5s\n\n")
  Timer.set(function () {
    restart()
  }, 5_000)
  return false // don't abort/reset immediately
}

export default function () {
  // try {
  trace("\n\n===== JS-Board starting =====\n")
  Timer.repeat(() => trace("JSB alive...\n"), 30000)

  try {
    boot_app()
  } catch (e) {
    trace(`** Booting app failed:\n`)
    if (e instanceof Error && e.stack) {
      trace(e.stack)
      trace("\n")
    } else if (e) trace(e.toString())
  }

  if (!globalThis.mcsim) {
    // start up the network
    WiFiMan.start()
    let once = false
    WiFiMan.onConnect(() => {
      if (!once) {
        once = true
        trace("WiFi connected\n")
        DNS.start()
        SNTP.start()
        HTTPAdmin.start()
      }
    })
  } else {
    trace("Looks like we're in mcsim\n")
    HTTPAdmin.start()
  }
}
