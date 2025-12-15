/**
 * Simple in-memory Nostr relay for e2e testing
 * Based on https://github.com/coracle-social/bucket
 *
 * This relay stores events in memory and broadcasts to subscribers.
 * Events are cleared every 30 seconds to prevent memory buildup during tests.
 */
import http from 'http'
import fs from 'fs'
import { matchFilters } from 'nostr-tools'
import { WebSocketServer } from 'ws'

// Log to file for debugging (sync to ensure immediate writes)
const log = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')
  const line = `${new Date().toISOString()} ${msg}\n`
  fs.appendFileSync('/tmp/relay-debug.log', line)
  console.log(...args)
}

const PORT = process.env.RELAY_PORT || 4736

const server = http.createServer((req, res) => {
  if (req.url === '/' && req.headers.accept === 'application/nostr+json') {
    res.writeHead(200, {
      'Content-Type': 'application/nostr+json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*'
    });

    res.end(JSON.stringify({
      name: 'hashtree-test-relay',
      description: 'Local relay for e2e testing',
      software: 'https://github.com/coracle-social/bucket',
      supported_nips: [1, 11],
    }))
  } else {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*'
    })
    res.end('hashtree-test-relay')
  }
})

const gsubs = new Map()
const events = new Map()
const wss = new WebSocketServer({server})

// Clear events every 30 seconds to prevent memory buildup
setInterval(() => events.clear(), 30_000)

wss.on('connection', socket => {
  const conid = Math.random().toString().slice(2)
  const lsubs = new Map()
  log(`[relay] New connection: ${conid}`)

  const send = msg => {
    try {
      socket.send(JSON.stringify(msg))
    } catch (e) {
      // Ignore send errors (socket may be closed)
    }
  }

  const makecb = (lsubid, filters, gsubid) => event => {
    const matches = matchFilters(filters, event)
    if (matches) {
      log(`[relay] MATCH sub=${lsubid} event.kind=${event.kind} id=${event.id?.slice(0,8)}`)
      send(['EVENT', lsubid, event])
    }
  }

  socket.on('message', msg => {
    try {
      const message = JSON.parse(msg)

      if (message[0] === 'EVENT') {
        const event = message[1]
        log(`[relay] EVENT kind=${event.kind} pubkey=${event.pubkey?.slice(0,8)} tags=${JSON.stringify(event.tags?.slice(0,3))}`)

        events.set(event.id, event)

        let matchCount = 0
        for (const [gsubid, cb] of gsubs.entries()) {
          cb(event)
          matchCount++
        }
        log(`[relay] Broadcast to ${matchCount} subscribers`)

        send(['OK', event.id, true, ''])
      }

      if (message[0] === 'REQ') {
        const lsubid = message[1]
        const gsubid = `${conid}:${lsubid}`
        const filters = message.slice(2)
        log(`[relay] REQ sub=${lsubid} filters=${JSON.stringify(filters).slice(0,200)}`)

        lsubs.set(lsubid, gsubid)
        gsubs.set(gsubid, makecb(lsubid, filters, gsubid))

        for (const event of events.values()) {
          if (matchFilters(filters, event)) {
            send(['EVENT', lsubid, event])
          }
        }

        send(['EOSE', lsubid])
      }

      if (message[0] === 'CLOSE') {
        const lsubid = message[1]
        const gsubid = `${conid}:${lsubid}`

        lsubs.delete(lsubid)
        gsubs.delete(gsubid)
      }
    } catch (e) {
      // Ignore parse errors
    }
  })

  socket.on('close', () => {
    for (const [subid, gsubid] of lsubs.entries()) {
      gsubs.delete(gsubid)
    }

    lsubs.clear()
  })
})

server.listen(PORT, () => {
  log(`[test-relay] Running on ws://localhost:${PORT}`)
})
