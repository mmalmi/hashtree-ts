/**
 * Simplified connectivity indicator - network icon with count
 * Red: not connected, Yellow: relays only, Green: peers connected
 * Clicking navigates to settings
 */
import { Link } from 'react-router-dom';
import { useAppStore } from '../store';
import { useNostrStore } from '../nostr';

export function ConnectivityIndicator() {
  const peers = useAppStore(s => s.peerCount);
  const relayList = useNostrStore(s => s.relays);
  const loggedIn = useNostrStore(s => s.isLoggedIn);
  const relayCount = relayList.length;

  // Color logic: red = nothing, yellow = relays only, green = peers
  let color: string;
  let title: string;

  if (!loggedIn) {
    color = '#f85149'; // red
    title = 'Not connected';
  } else if (peers === 0) {
    color = '#d29922'; // yellow
    title = `${relayCount} relays, no peers`;
  } else {
    color = '#3fb950'; // green
    title = `${peers} peer${peers !== 1 ? 's' : ''}, ${relayCount} relays`;
  }

  // Total connections = relays + peers
  const totalConnections = relayCount + peers;

  return (
    <Link
      to="/settings"
      className="flex items-center gap-1.5 px-2 py-1 text-sm no-underline"
      title={title}
    >
      <span
        data-testid="peer-indicator-dot"
        className="i-lucide-wifi"
        style={{ color }}
      />
      <span data-testid="peer-count" style={{ color }}>{totalConnections}</span>
    </Link>
  );
}
