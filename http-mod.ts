// HTTP handler to update 'mods'
// Copyright © 2023 by Thorsten von Eicken

import Flash from "flash"
import Timer from "timer"
import Modules from "modules"
import * as Sys from "sys"
import { Request, Response } from "embedded:network/http/rest-server"

export default function mount(router: any) {
  // install a new mod received via PUT
  router.put("/mod/*", async function (req: Request): Promise<void | Response> {
    if (req.path != "0") return [404] // slot has to be 0 for now

    const flash = new Flash("xs")
    let flOffset = 0
    const flSize = flash.byteLength
    const flSector = flash.blockSize
    if (!flash) return
    trace(`PUT mod, max ${flSize} bytes\n`)

    try {
      let buf = await req.read()
      while (buf !== undefined) {
        const bl = buf.byteLength
        if (flOffset + bl > flSize) {
          return ["Mod too big", 400]
        }
        // erase first
        let firstSector = Math.trunc(flOffset / flSector)
        const lastSector = Math.trunc((flOffset + bl - 1) / flSector)
        if (flOffset % flSector != 0) firstSector++ // previously erased sector
        trace(`Erase sectors ${firstSector} to ${lastSector}\n`)
        for (let sector = firstSector; sector <= lastSector; sector++) flash.erase(sector)
        // write data
        trace(`Write ${bl} bytes at ${flOffset}\n`)
        flash.write(flOffset, bl, buf)
        // next...
        flOffset += bl
        buf = await req.read()
      }

      trace("Mod written, resetting...\n")
      Timer.set(() => Sys.restart(), 300)
      return [204]
    } catch (err) {
      trace(`HTTP ${req.method} ${req.url}: ${err}\n`)
      return ["" + err, 500]
    }
  })

  router.delete("/mod/*", function (req: Request): Response {
    if (req.path != "0") return [404] // slot has to be 0 for now
    try {
      // clobber the current mod so it doesn't get loaded after reset
      const flash = new Flash("xs")
      const erase = new Uint8Array(16)
      flash.write(0, erase.byteLength, erase)
      // reset
      Timer.set(() => Sys.restart(), 300)
      return [204]
    } catch (err) {
      trace(`HTTP ${req.method} ${req.url}: ${err}\n`)
      return ["" + err, 500]
    }
  })

  // return list of modules available in host and in mod
  router.get("/mod/*", function (req: Request): Response {
    if (req.path == "0") return [JSON.stringify(Modules.archive), 200, "application/json"]
    else if (req.path == "host") return [JSON.stringify(Modules.host), 200, "application/json"]
    else return [404]
  })
}
