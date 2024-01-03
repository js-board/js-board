// HTTP admin server to configure and manage this device
// Copyright © 2023 by Thorsten von Eicken

import { Router, Server, Request, Response } from "embedded:network/http/rest-server"
//import mountFS from "./http-fs"
import mountMOD from "./http-mod"
//import mountPREFS from "./http-prefs"

export let server: Server | undefined
export const router = new Router()

export function start(): void {
  server = new Server(router, {
    port: "device" in globalThis ? 80 : 8000,
    headers: { "Access-Control-Allow-Origin": "*" },
  })

  // root redirects to admin for now, in the future an app could hook in here
  router.get("/", function (req: Request): Response {
    return [null, 307, { Location: "/fs/ui/index.html" }]
  })

  router.options("/*", function (req: Request): Response {
    return [null, 200, { "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" }]
  })

  mountMOD(router)
  //mountFS(router)
  //mountPREFS(router)
}
