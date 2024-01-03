HTTP Rest-Server
================

The rest-server makes serving a REST API easy. It is based on restana and supports both synchronous
and async handler functions.

## Handlers

### synchronous handlers

Synchronous handler functions must process a request and return a response. They cannot receive a
request body and must send a response body "at once". They are defined as follows:

```js
import { Request, Response } from "embedded:network/http/rest-server"
 
router.get('/path', function (req: Request): Response {
  trace(`Request received: ${req.method} ${req.url} ${req.path}`)

 return [`Got ${req.method} ${req.url} ${req.path}`, 200, "text/plain"]
})
```

- `req.url` is the original request URL found in the request header
- `req.path` is the remainder of the URL after the router has matched the request
- `req.method` is all-caps
- `req.headers` is a map of lower-cased header names to header values

The return value can have one of the following forms:
- `[body, status, contentType]`
- `[body, status, headers]`
- `[body, status]`
- `[body]`
- `[status]`
- the body may be an ArrayBuffer, a string, a String instance, or null

Notes:
- if the request contains a body it will be read and discarded
- a response body will be sent in pieces as write buffer space becomes available, it is
  thus primarily constrained by memory available to hold it in the meantime

### asynchronous handlers

Asynchronous handlers may be used to read a request body, stream a response body, or simply
to perform some asynchronous processing. They are defined as follows:

```js
import { Request, Response } from "embedded:network/http/rest-server"

router.post('/path', async function (req: Request): Promise<Response|undefined> {
  trace(`Request received: ${req.method} ${req.url} ${req.path}`)

  // upload file
  let file = new File(req.path, true)
  let buf = await req.read()
  while (buf != undefined) {
    file.write(buf)
    buf = await req.read()
  }
  file.close()

  // send same file back
  file = new File(req.path, false) // force any error opening file before starting response
  let left = file.length
  const rw = await req.respond(200, {'content-type':"application/binary", "content-length":""+left})
  // write file
  while (left > 0) {
    const l = left > 1024 ? 1024 : left
    const buf = file.read(ArrayBuffer, l)
    await rw!.write(buf)
    left -= l
  }
  file.close()
  return
})
```

- `req.respond` takes `[status]`, `[status, headers]` or `[status, contentType]`
- to stream a response body either a `content-length` header with a non-zero size or a
  `transfer-encoding: chunked` header must be passed to `req.respond`
- if no response body is streamed the handler may simply return the response like a sync handler
  does (and not call `req.respond`)

Notes:
- if the request contains a body anything not read by the handler will be read and discarded as
  soon as `req.respond` is called (or the handler returns a response)
- when writing a response using the ResponseWriter the response is closed when teh handler returns

## Additional notes

- a `Date` header is automatically added when required and not provided
- a `connection: close` header is automatically added unless the status is 1xx
- a `content-length` header is automatically added when a complete body is provided by the handler

## Routing

The provided router is very simple, other routers can be implemented outside of the rest-server.
The router supports two types of routes:
- `router.<method>('/some/path', <handler>)` for exact path matches in which case `req.path` will
  be empty
- `router.<method>('/some/path/*', <handler>)` for prefix matches in which case `req.path` will
  contain the remainder of the URL, i.e. what the '*' matched
