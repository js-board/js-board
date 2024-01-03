// HTTP server loosely modeled after restana and supporting async handlers
// Copyright © 2023 by Thorsten von Eicken

import Timer from "timer"
import HTTPServer, { Connection } from "embedded:network/http/server"
import Listener from "embedded:io/socket/listener"
import TextDecoder from "text/decoder"

const TIMEOUT = 20_000 // inactivity timeout in ms

function traceError(request: { method: string; path: string }, err: any) {
  trace(`HTTP ${request.method} ${request.path}: ${err}\n`)
}

function debug(s: string) {
  //trace(s)
}

function map2str(m: Map<string, string | number>): string {
  let hstr = "{"
  m.forEach((v, k) => (hstr += ` ${k}:${v}`))
  return hstr + " }"
}

export const TYPE_JSON = "application/json; charset=utf-8"
export const TYPE_PLAIN = "text/plain; charset=utf-8"
export const TYPE_OCTET = "application/octet-stream"

try {
  throw new Error("foo")
} catch (e) {}

// Notes about the HTTPServer and Connection classes:
// - Connection.read returns an ArrayBuffer with data or undefined when there is no data available.
// - To determine that the entire request body has been read one has to wait for the onReponse callback
// - To end the response body one has to call Connection.write w/out argument

// Request represents an HTTP request and provides functions to read the request body as well as
// initiate a response.
export interface Request {
  method: string // normalized to upper case
  path: string // portion after route
  url: string // full original URL
  headers: Map<string, string> // keys normalized to lower case
  header(name: string): string | undefined
  read(): Promise<ArrayBuffer | undefined> // async!
  readStringBody(maxBytes?: number): Promise<string | undefined> // limit body to maxBytes
  get responded(): boolean
  respond(
    status: number,
    headers?: Record<string, string> | string // string=>content-type
  ): Promise<ResponseWriter | undefined> // async!
}

// ResponseWriter provides functions to write the response body. The body is ended by returning
// from the handler function.
export interface ResponseWriter {
  write(buf: string | ArrayBuffer): Promise<void> // async
  //close(): void
}

// Response returned by handler function
export type Response = [
  body: ArrayBuffer | string | number | null, // number=>status
  status?: number,
  headers?: Record<string, string> | string // string=>content-type
]

// Handler functions can be sync or async
export type HandlerFuncSync = (req: Request) => Response
export type HandlerFuncAsync = (req: Request) => Promise<void | Response>
export type HandlerFunc = HandlerFuncSync | HandlerFuncAsync

// ===== Router

export function NotFoundHandler(req: Request): Response {
  return [404]
}

export class Router {
  #routes: { [method: string]: { [path: string]: HandlerFunc } } = {}

  constructor() {}

  route(method: string, url: string): [HandlerFunc, string] {
    const paths = Object.keys(this.#routes[method] || {}) // FIXME: allocates an array!
    let path = paths.find(p =>
      p.endsWith("*")
        ? url.startsWith(p.slice(0, -1))
        : p == url || (url.startsWith(p) && url.charAt(p.length) == "?")
    )
    if (path === undefined) return [NotFoundHandler, ""]
    const handler = this.#routes[method][path]
    const remainder = path.endsWith("*") ? url.slice(path.length - 1) : ""
    //trace(`ROUTE ${method} ${url} -> ${path} ${remainder}\n`)
    return [handler, remainder]
  }

  method(method: string, path: string, handler: HandlerFunc) {
    this.#routes[method] = this.#routes[method] || {}
    this.#routes[method][path] = handler
  }

  get(path: string, handler: HandlerFunc) {
    this.method("GET", path, handler)
  }

  post(path: string, handler: HandlerFunc) {
    this.method("POST", path, handler)
  }

  put(path: string, handler: HandlerFunc) {
    this.method("PUT", path, handler)
  }

  delete(path: string, handler: HandlerFunc) {
    this.method("DELETE", path, handler)
  }

  options(path: string, handler: HandlerFunc) {
    this.method("OPTIONS", path, handler)
  }
}

// ===== Server

// the response of a handler can have onbe of several forms: normalize it
function normalizeResponse(
  body: ArrayBuffer | string | number | null,
  status?: number,
  headers?: Record<string, string> | string
): [ArrayBuffer | null, number, Record<string, string>] {
  if (typeof body === "number") {
    status = body
    body = null
  }
  if (body instanceof String) body = "" + body
  if (typeof body === "string") body = ArrayBuffer.fromString(body)

  if (status === undefined) status = 200
  if (headers === undefined) headers = {}
  else if (typeof headers == "string" || headers instanceof String) {
    headers = { "content-type": "" + headers }
  }
  return [body as ArrayBuffer | null, status, headers]
}

function connectionHandler(connection: Connection, router: Router, options: ServerOptions) {
  let responded = false
  let done = false
  // promises for pending operations/tasks
  let responder: undefined | { resolve: () => void; reject: (err: any) => void }
  let respondable = false
  let reader: undefined | { resolve: (buf?: ArrayBuffer) => void; reject: (err: any) => void }
  let readable = 0
  let writer: { buf: ArrayBuffer; resolve: () => void; reject: (err: any) => void } | undefined
  let writable = 0
  let rw: ResponseWriter | undefined

  let request: undefined | Request

  let timeout: any = undefined
  function active() {
    if (timeout !== undefined) Timer.clear(timeout)
    timeout = Timer.set(() => {
      trace(`TIMEOUT\n`)
      connection?.close()
      route?.onError(new Error("inactivity timeout"))
    }, TIMEOUT)
  }

  function augmentHeaders(
    headers: undefined | Record<string, string>,
    status: number
  ): Map<string, string> {
    const hh = new Map() as Map<string, string>
    if (options.headers)
      for (const k in options.headers) hh.set(k.toLowerCase(), options.headers[k])
    for (const k in headers) {
      hh.set(k.toLowerCase(), headers[k])
    }
    // https://stackoverflow.com/questions/4726515/what-http-response-headers-are-required
    if (status >= 200 && status < 500 && !hh.has("date")) hh.set("date", new Date().toUTCString())
    if (status >= 200) hh.set("connection", "close")
    return hh
  }

  function newResponseWriter(): ResponseWriter {
    debug(`RW allocated\n`)

    rw = {
      // write a chunk of the response body
      async write(buf: string | ArrayBuffer): Promise<void> {
        if (writer !== undefined) throw new Error("write already in progress")
        // ensure we have an ArrayBuffer
        if (!(buf instanceof ArrayBuffer)) {
          buf = ArrayBuffer.fromString(buf)
        }
        try {
          // if we can write at all, do so
          if (writable >= buf.byteLength) {
            debug(`WRITING ${buf.byteLength}\n`)
            writable = connection.write(buf)
            return
          } else
            while (writable > 0 && buf.byteLength > 0) {
              debug(`WRITING ${writable}\n`)
              const l = writable
              writable = connection.write(buf.slice(0, l))
              buf = buf.slice(l)
            }
          if (buf.byteLength == 0) return
        } catch (err) {
          traceError(request!, err)
          trace(`writable=${writable} buf=${buf.byteLength}\n`)
          if (err instanceof Error && err.stack) trace(err.stack + "\n")
          throw err
        }
        // buf not all written, return a promise we'll fulfill later
        debug(`queuing writer\n`)
        return new Promise((resolve, reject) => {
          writer = { buf: buf as ArrayBuffer, resolve, reject }
        })
      },
    }
    return rw
  }

  const route = {
    onRequest(info: { method: string; path: string; headers: Map<string, string> }): void {
      const { method, headers } = info
      const url = info.path
      // perform routing
      const [handler, path] = router.route(method, url)
      trace(`*** HTTP ${method} ${url} -> ${path}\n`)
      active()

      // Request "class"
      request = {
        method,
        path,
        url,
        headers, // keys normalized to lower case by HTTPClient

        header(this: Request, name: string): string | undefined {
          return this.headers.get(name.toLowerCase())
        },

        // async reading of the request body: returns a non-empty ArrayBuffer or undefined if the
        // request body has been fully read.
        async read(): Promise<ArrayBuffer | undefined> {
          if (readable > 0) {
            const r = readable
            readable = 0
            const buf = connection.read(r)
            debug(`READ ${r} -> ${buf?.byteLength}\n`)
            return buf
          }
          if (respondable) return undefined // request has been fully consumed
          if (reader !== undefined) throw new Error("read already in progress")
          debug("queuing reader\n")
          return new Promise((resolve, reject) => {
            reader = { resolve, reject }
          })
        },

        // read a string body from the request, return undefined if there is no body, throw is there
        // is an error. maxBytes is the max payload (UTF-8) to accept.
        async readStringBody(this: Request, maxBytes?: number): Promise<string | undefined> {
          let buf = await this.read()
          if (buf == undefined) return undefined
          const td = new TextDecoder()
          let rb = [td.decode(buf, { stream: true })]
          let len = buf.byteLength
          while ((buf = await this.read()) != undefined) {
            if (maxBytes && len + buf.byteLength > maxBytes) {
              while ((await this.read()) != undefined) {}
              throw new Error("body too large")
            }
            rb.push(td.decode(buf, { stream: true }))
            len += buf.byteLength
          }
          rb.push(td.decode())
          return rb.join("")
        },

        get responded(): boolean {
          return responded
        },

        // initiate a response
        async respond(
          status: number,
          headers?: Record<string, string> | string // string=>content-type
        ): Promise<ResponseWriter | undefined> {
          if (responded) {
            throw new Error("response already initiated")
          }
          if (reader !== undefined) throw new Error("read still in progress") // is that OK?
          responded = true
          // normalize headers
          if (typeof headers == "string" || headers instanceof String) {
            headers = { "content-type": "" + headers }
          }
          const hmap = augmentHeaders(headers, status)
          const hasCL = hmap.has("content-length")
          const isChunked = hmap.get("transfer-encoding")?.toLowerCase() == "chunked"
          const needBody = isChunked || !hasCL || hmap.get("content-length") !== "0"
          if (needBody && !hasCL && !isChunked) hmap.set("transfer-encoding", "chunked")
          //trace(`RESP status ${status} ${map2str(hmap)} ${needBody ? "need-body" : "no-body"}\n`)
          const len = hasCL ? `content-length:${hmap.get("content-length")}` : "no-length"
          trace(`RESP status ${status} ${len} ${needBody ? "need-body" : "no-body"}\n`)
          if (!respondable) {
            // delay a tad to give the onResponse callback a chance to fire
            await new Promise((resolve, reject) => Timer.set(resolve, 0))
          }
          // if we can't respond yet we need to consume the request body
          while (!respondable && (await request!.read()) !== undefined);
          // if we can now respond, do so
          if (respondable) {
            connection.respond({ status, headers: hmap })
            return needBody ? newResponseWriter() : undefined
          }
          // need to delay... (this should not happen or be rare)
          return new Promise((resolve, reject) => {
            const resolution = () => {
              connection.respond({ status, headers: hmap })
              resolve(needBody ? newResponseWriter() : undefined)
            }
            debug("queuing responder\n")
            responder = { resolve: resolution, reject }
          })
        },
      }

      // call handler
      let response: Response | Promise<void | Response>
      try {
        response = handler(request)
      } catch (err) {
        traceError(request, err)
        if (err instanceof Error && err.stack) trace(err.stack)
        response = [500]
      }
      // function to finish request: normalize response and respond
      function finish(response: Response) {
        let [body, status, headers] = normalizeResponse(...response)
        if (body == null) headers["content-length"] = "0"
        else headers["content-length"] = "" + body.byteLength
        request!
          .respond(status, headers)
          .then(writer => {
            if (writer == undefined) return
            if (!body || body.byteLength == 0) {
              trace(`internal error: no body ${JSON.stringify(headers)}\n`)
            } else {
              writer!.write(body).then(() => {})
            }
          })
          .catch(err => {
            traceError(request!, err)
          })
      }
      // process what handler returned
      if (response instanceof Promise) {
        // was async handler
        response.then(r => {
          if (Array.isArray(r)) {
            // handler returned a response (array), need to ship it off
            if (responded) traceError(request!, "handler returned response after respond")
            else finish(r)
          } else if (!responded) {
            traceError(request!, "handler did not provide a response")
            finish([500])
          } else {
            // handler returned nothing, close response body if there was one
            // (but server closes if content-length reached...)
            if (rw && !done) {
              connection.write(undefined)
            }
          }
        })
      } else {
        // was sync handler
        if (!Array.isArray(response)) {
          traceError(request!, "handler must return a response")
          finish([500])
        } else finish(response)
      }
    },

    // count bytes of request body are available: satisfy any pending async read, else take note
    // of the count for when a read is initiated
    onReadable(count: number): void {
      debug(`READABLE ${count}\n`)
      active()
      readable = 0
      if (count <= 0) return // presumably this shouldn't happen...
      if (reader === undefined) {
        // nobody waiting
        readable = count
        return
      }
      // we got a reader waiting: satisfy it
      let { resolve } = reader
      reader = undefined
      debug(`resolving reader ${count}\n`)
      resolve(connection.read(count))
    },

    onWritable(count: number) {
      debug(`WRITABLE ${count}\n`)
      active()
      if (writer === undefined) {
        // no writer waiting, stash away the count
        writable = count
        return
      }
      // we got a writer waiting: satisfy it
      let { buf } = writer
      if (count >= buf.byteLength) {
        writable = connection.write(buf)
        buf = buf.slice(buf.byteLength) // wrote all
      } else
        while (count > 0 && buf.byteLength > 0) {
          writable = connection.write(buf.slice(0, count))
          buf = buf.slice(count)
          count = writable
        }
      if (buf.byteLength == 0) {
        // wrote everything, unblock writer
        const w = writer
        writer = undefined
        debug(`resolving writer\n`)
        w.resolve()
      } else {
        writer.buf = buf
      }
    },

    // request fully consumed, ready to respond: tell any pending async read that there is no more
    // data and unblock any pending responder
    onResponse(options: { status: number; headers: any }): void {
      debug(`RESPONDABLE\n`)
      active()
      respondable = true
      if (reader !== undefined) {
        // signal end of request body
        let { resolve } = reader
        reader = undefined
        debug(`resolving reader\n`)
        resolve(undefined)
      }
      if (responder !== undefined) {
        // somebody waiting to respond
        let { resolve } = responder
        responder = undefined
        debug(`resolving responder\n`)
        resolve()
      }
    },

    // request fully processed: reject any pending promise
    onDone(err?: Error): void {
      trace(`DONE ${err || ""}\n`)
      if (timeout !== undefined) Timer.clear(timeout)
      timeout = undefined
      if (!err) err = new Error("request done")
      responded = true
      done = true
      if (reader !== undefined) {
        let { reject } = reader
        reader = undefined
        reject(err)
      }
      if (responder !== undefined) {
        let { reject } = responder
        responder = undefined
        reject(err)
      }
      if (writer !== undefined) {
        let { reject } = writer
        writer = undefined
        reject(err)
      }
    },

    onError(err: Error) {
      if (request) traceError(request, err)
      //if (!responded) request?.respond(500)
      route.onDone(err)
    },
  }
  connection.accept(route)
}

export type ServerOptions = {
  port?: number
  headers?: Record<string, string>
}

export class Server {
  server: HTTPServer

  constructor(router: Router, options?: ServerOptions) {
    this.server = new HTTPServer({
      io: Listener,
      port: options?.port || 80,
      onConnect: (connection: Connection) => connectionHandler(connection, router, options || {}),
    })
  }
}
