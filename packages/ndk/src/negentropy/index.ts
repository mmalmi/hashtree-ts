import debug from "debug"
import type {NDKEvent} from "../events/index.js"
import type {NDKFilter} from "../subscription/index.js"
import type {NDKRelay} from "../relay/index.js"
import {Negentropy, NegentropyStorageVector} from "./lib.js"

const log = debug("ndk:negentropy")

export interface NegentropyOptions {
  frameSizeLimit?: number
  signal?: AbortSignal
}

export type ReconcileFunction = (have: string[], need: string[]) => Promise<void>

/**
 * Creates a NegentropyStorageVector from an array of events.
 */
export function buildStorageVector(events: NDKEvent[]): NegentropyStorageVector {
  const storage = new NegentropyStorageVector()
  for (const event of events) {
    if (event.id && event.created_at) {
      storage.insert(event.created_at, event.id)
    }
  }
  storage.seal()
  return storage
}

/**
 * Performs Negentropy sync with a relay.
 * Returns true if sync completed successfully, false if aborted.
 */
export async function negentropySync(
  storage: NegentropyStorageVector,
  relay: NDKRelay,
  filter: NDKFilter,
  reconcile: ReconcileFunction,
  opts?: NegentropyOptions
): Promise<boolean> {
  const subId = Math.random().toString(36).substring(2, 15)
  const ne = new Negentropy(storage, opts?.frameSizeLimit)

  const initialMessage = ne.initiate<string>()
  let msg: string | null = initialMessage

  return new Promise<boolean>((resolve, reject) => {
    const messageHandlers = new Map<
      string,
      (relay: NDKRelay, message: unknown[]) => void
    >()
    let isActive = true
    let noticeHandler: ((notice: string) => void) | undefined

    const cleanup = () => {
      isActive = false
      messageHandlers.forEach((handler, type) => {
        relay.unregisterProtocolHandler(type)
      })
      if (noticeHandler) {
        relay.off("notice", noticeHandler)
      }
      opts?.signal?.removeEventListener("abort", onAbort)
    }

    const onAbort = () => {
      log("Sync aborted", subId)
      cleanup()
      // Send NEG-CLOSE
      sendMessage(["NEG-CLOSE", subId])
      resolve(false)
    }

    const sendMessage = (msg: unknown[]) => {
      if (!relay.connected) {
        log("Relay not connected, cannot send message", subId)
        return
      }
      const msgStr = JSON.stringify(msg)
      ;(relay.connectivity as any).send(msgStr)
    }

    // NEG-MSG handler
    const handleNegMsg = async (_relay: NDKRelay, message: unknown[]) => {
      if (!isActive || message[1] !== subId) return

      // Mark negentropy as supported (once true, never changes)
      if (relay.negentropySupport !== true) {
        relay.negentropySupport = true
        log("Relay supports negentropy", relay.url)
      }

      try {
        const receivedMsg = message[2] as string
        const [newMsg, have, need] = ne.reconcile<string>(receivedMsg)

        await reconcile(have, need)

        msg = newMsg

        if (msg) {
          sendMessage(["NEG-MSG", subId, msg])
        } else {
          // Sync complete
          log("Sync complete", subId)
          cleanup()
          sendMessage(["NEG-CLOSE", subId])
          resolve(true)
        }
      } catch (err) {
        log("Error during reconcile", err)
        cleanup()
        sendMessage(["NEG-CLOSE", subId])
        reject(err)
      }
    }

    // NEG-ERR handler
    const handleNegErr = (_relay: NDKRelay, message: unknown[]) => {
      if (!isActive || message[1] !== subId) return

      // Mark negentropy as supported (even if error - protocol exists)
      if (relay.negentropySupport !== true) {
        relay.negentropySupport = true
        log("Relay supports negentropy (via NEG-ERR)", relay.url)
      }

      const errorMsg = message[2] as string
      log("Received NEG-ERR", errorMsg)
      cleanup()
      reject(new Error(errorMsg))
    }

    // NOTICE handler for unsupported detection
    const handleNotice = (notice: string) => {
      const lowerNotice = notice.toLowerCase()

      // Check for explicit "negentropy disabled" message
      if (lowerNotice.includes("negentropy disabled")) {
        // Only mark as disabled if not already confirmed as supported
        if (relay.negentropySupport !== true) {
          relay.negentropySupport = false
          log("Relay disabled negentropy", notice)
        } else {
          log(
            "Relay sent negentropy disabled but already confirmed working, ignoring",
            notice
          )
        }
        cleanup()
        reject(new Error(`Unsupported: ${notice}`))
        return
      }

      if (
        lowerNotice.includes("unsupported") ||
        lowerNotice.includes("not implemented") ||
        lowerNotice.includes("neg-")
      ) {
        log("Relay sent unsupported NOTICE, aborting Negentropy", notice)
        cleanup()
        reject(new Error(`Unsupported: ${notice}`))
      }
    }

    // Register handlers
    relay.registerProtocolHandler("NEG-MSG", handleNegMsg)
    relay.registerProtocolHandler("NEG-ERR", handleNegErr)
    messageHandlers.set("NEG-MSG", handleNegMsg)
    messageHandlers.set("NEG-ERR", handleNegErr)

    // Listen for NOTICE messages
    noticeHandler = handleNotice
    relay.on("notice", noticeHandler)

    // Listen for abort signal
    if (opts?.signal) {
      if (opts.signal.aborted) {
        cleanup()
        resolve(false)
        return
      }
      opts.signal.addEventListener("abort", onAbort)
    }

    // Send NEG-OPEN
    log("Sending NEG-OPEN", subId, filter)
    sendMessage(["NEG-OPEN", subId, filter, initialMessage])
  })
}

export {Negentropy, NegentropyStorageVector}
