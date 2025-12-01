import { useState, useEffect, useMemo } from 'react';
import {
  useWalletStore,
  initWallet,
  addMint,
  createMintQuote,
  redeemMintQuote,
  send,
  receive,
  createMeltQuote,
  payMeltQuote,
  getDefaultMint,
  decodeToken,
  getMnemonic,
} from '../wallet';

type View = 'main' | 'receive' | 'send' | 'pay' | 'settings';

interface PendingQuote {
  mintUrl: string;
  quoteId: string;
  request: string;
  amount: number;
}

export function WalletPanel() {
  // Zustand hooks for reactive wallet state
  const walletReady = useWalletStore(s => s.walletReady);
  const balances = useWalletStore(s => s.balances);
  const mints = useWalletStore(s => s.mints);
  const totalBalance = useMemo(() => Object.values(balances).reduce((sum, b) => sum + b, 0), [balances]);

  const [view, setView] = useState<View>('main');
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState('');
  const [invoice, setInvoice] = useState('');
  const [mintUrl, setMintUrl] = useState('');
  const [newMint, setNewMint] = useState('');
  const [pendingQuote, setPendingQuote] = useState<PendingQuote | null>(null);
  const [pendingMelt, setPendingMelt] = useState<{ mintUrl: string; quoteId: string; amount: number; fee: number } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    initWallet();
  }, []);

  useEffect(() => {
    if (mints.length > 0 && !mintUrl) {
      setMintUrl(mints[0]);
    }
  }, [mints, mintUrl]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleAddMint = async () => {
    if (!newMint.trim()) return;
    setLoading(true);
    const success = await addMint(newMint.trim());
    setLoading(false);
    if (success) {
      showMessage('success', 'Mint added');
      setNewMint('');
      if (!mintUrl) setMintUrl(newMint.trim());
    } else {
      showMessage('error', 'Failed to add mint');
    }
  };

  const handleCreateReceive = async () => {
    const amt = parseInt(amount);
    if (!amt || amt <= 0 || !mintUrl) return;
    setLoading(true);

    // Add mint if not known
    if (!mints.includes(mintUrl)) {
      await addMint(mintUrl);
    }

    const quote = await createMintQuote(mintUrl, amt);
    setLoading(false);
    if (quote) {
      setPendingQuote({ mintUrl, quoteId: quote.quote, request: quote.request, amount: amt });
    } else {
      showMessage('error', 'Failed to create invoice');
    }
  };

  const handleCheckPayment = async () => {
    if (!pendingQuote) return;
    setLoading(true);
    const success = await redeemMintQuote(pendingQuote.mintUrl, pendingQuote.quoteId);
    setLoading(false);
    if (success) {
      showMessage('success', `Received ${pendingQuote.amount} sats`);
      setPendingQuote(null);
      setAmount('');
      setView('main');
    } else {
      showMessage('error', 'Payment not found yet');
    }
  };

  const handleReceiveToken = async () => {
    if (!token.trim()) return;
    setLoading(true);
    const success = await receive(token.trim());
    setLoading(false);
    if (success) {
      showMessage('success', 'Token received');
      setToken('');
      setView('main');
    } else {
      showMessage('error', 'Failed to receive token');
    }
  };

  const handleSend = async () => {
    const amt = parseInt(amount);
    if (!amt || amt <= 0 || !mintUrl) return;
    setLoading(true);
    const tokenStr = await send(mintUrl, amt);
    setLoading(false);
    if (tokenStr) {
      setToken(tokenStr);
      showMessage('success', 'Token created');
    } else {
      showMessage('error', 'Failed to create token');
    }
  };

  const handleCreateMelt = async () => {
    if (!invoice.trim() || !mintUrl) return;
    setLoading(true);
    const quote = await createMeltQuote(mintUrl, invoice.trim());
    setLoading(false);
    if (quote) {
      setPendingMelt({ mintUrl, quoteId: quote.quote, amount: quote.amount, fee: quote.fee });
    } else {
      showMessage('error', 'Failed to create payment quote');
    }
  };

  const handlePayInvoice = async () => {
    if (!pendingMelt) return;
    setLoading(true);
    const success = await payMeltQuote(pendingMelt.mintUrl, pendingMelt.quoteId);
    setLoading(false);
    if (success) {
      showMessage('success', 'Payment sent');
      setPendingMelt(null);
      setInvoice('');
      setView('main');
    } else {
      showMessage('error', 'Payment failed');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tokenInfo = token ? decodeToken(token) : null;

  if (!walletReady) {
    return (
      <div className="p-3">
        <span className="text-xs text-muted">Loading wallet...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-3">
      <div className="flex-between mb-2">
        <span className="text-xs text-muted uppercase tracking-wide">Wallet</span>
        <button onClick={() => setView(view === 'settings' ? 'main' : 'settings')} className="btn-ghost text-xs py-1 px-2">
          {view === 'settings' ? 'Back' : 'Settings'}
        </button>
      </div>

      {message && (
        <div className={`text-xs p-2 rounded mb-2 ${message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
          {message.text}
        </div>
      )}

      {view === 'main' && (
        <>
          <div className="bg-surface-2 rounded p-3 mb-3 text-center">
            <div className="text-2xl font-bold text-text-1">{totalBalance}</div>
            <div className="text-xs text-muted">sats</div>
          </div>

          <div className="flex gap-2 mb-3">
            <button onClick={() => setView('receive')} className="flex-1 btn-success text-sm py-2">
              Receive
            </button>
            <button onClick={() => setView('send')} className="flex-1 btn-ghost text-sm py-2" disabled={totalBalance === 0}>
              Send
            </button>
            <button onClick={() => setView('pay')} className="flex-1 btn-ghost text-sm py-2" disabled={totalBalance === 0}>
              Pay
            </button>
          </div>

          {Object.entries(balances).length > 0 && (
            <div className="text-xs text-muted mb-2">Balances by mint:</div>
          )}
          <div className="flex-1 overflow-auto">
            {Object.entries(balances).map(([mint, bal]) => (
              <div key={mint} className="flex-between text-xs py-1 border-b border-surface-3">
                <span className="truncate flex-1 text-muted" title={mint}>{new URL(mint).hostname}</span>
                <span className="font-mono">{bal}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {view === 'receive' && (
        <>
          <button onClick={() => { setView('main'); setPendingQuote(null); setAmount(''); setToken(''); }} className="text-xs text-muted mb-2 text-left">
            &larr; Back
          </button>

          {!pendingQuote ? (
            <>
              <div className="mb-3">
                <label className="text-xs text-muted block mb-1">Mint</label>
                <select
                  value={mintUrl}
                  onChange={(e) => setMintUrl((e.target as HTMLSelectElement).value)}
                  className="w-full input text-sm"
                >
                  {mints.map(m => (
                    <option key={m} value={m}>{new URL(m).hostname}</option>
                  ))}
                  <option value={getDefaultMint()}>{new URL(getDefaultMint()).hostname} (default)</option>
                </select>
              </div>

              <div className="mb-3">
                <label className="text-xs text-muted block mb-1">Amount (sats)</label>
                <input
                  type="number"
                  value={amount}
                  onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
                  placeholder="100"
                  className="w-full input text-sm"
                />
              </div>

              <button onClick={handleCreateReceive} disabled={loading || !amount} className="btn-success text-sm w-full mb-3">
                {loading ? 'Creating...' : 'Create Invoice'}
              </button>

              <div className="border-t border-surface-3 pt-3 mt-3">
                <label className="text-xs text-muted block mb-1">Or paste cashu token</label>
                <textarea
                  value={token}
                  onInput={(e) => setToken((e.target as HTMLTextAreaElement).value)}
                  placeholder="cashuA..."
                  className="w-full input text-sm h-20 resize-none"
                />
                <button onClick={handleReceiveToken} disabled={loading || !token} className="btn-success text-sm w-full mt-2">
                  {loading ? 'Receiving...' : 'Receive Token'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-muted mb-2">Pay this Lightning invoice:</div>
              <div className="bg-surface-2 p-2 rounded mb-3 break-all text-xs font-mono select-all">
                {pendingQuote.request}
              </div>
              <button onClick={() => copyToClipboard(pendingQuote.request)} className="btn-ghost text-xs w-full mb-2">
                {copied ? 'Copied!' : 'Copy Invoice'}
              </button>
              <button onClick={handleCheckPayment} disabled={loading} className="btn-success text-sm w-full">
                {loading ? 'Checking...' : 'Check Payment'}
              </button>
            </>
          )}
        </>
      )}

      {view === 'send' && (
        <>
          <button onClick={() => { setView('main'); setAmount(''); setToken(''); }} className="text-xs text-muted mb-2 text-left">
            &larr; Back
          </button>

          {!token ? (
            <>
              <div className="mb-3">
                <label className="text-xs text-muted block mb-1">From mint</label>
                <select
                  value={mintUrl}
                  onChange={(e) => setMintUrl((e.target as HTMLSelectElement).value)}
                  className="w-full input text-sm"
                >
                  {Object.entries(balances).map(([m, b]) => (
                    <option key={m} value={m}>{new URL(m).hostname} ({b} sats)</option>
                  ))}
                </select>
              </div>

              <div className="mb-3">
                <label className="text-xs text-muted block mb-1">Amount (sats)</label>
                <input
                  type="number"
                  value={amount}
                  onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
                  placeholder="100"
                  max={balances[mintUrl] || 0}
                  className="w-full input text-sm"
                />
              </div>

              <button onClick={handleSend} disabled={loading || !amount || parseInt(amount) > (balances[mintUrl] || 0)} className="btn-success text-sm w-full">
                {loading ? 'Creating...' : 'Create Token'}
              </button>
            </>
          ) : (
            <>
              <div className="text-xs text-muted mb-2">Share this cashu token:</div>
              {tokenInfo && (
                <div className="text-xs text-muted mb-2">
                  Amount: {tokenInfo.amount} sats
                </div>
              )}
              <div className="bg-surface-2 p-2 rounded mb-3 break-all text-xs font-mono select-all max-h-32 overflow-auto">
                {token}
              </div>
              <button onClick={() => copyToClipboard(token)} className="btn-ghost text-xs w-full mb-2">
                {copied ? 'Copied!' : 'Copy Token'}
              </button>
              <button onClick={() => setToken('')} className="btn-success text-sm w-full">
                Done
              </button>
            </>
          )}
        </>
      )}

      {view === 'pay' && (
        <>
          <button onClick={() => { setView('main'); setInvoice(''); setPendingMelt(null); }} className="text-xs text-muted mb-2 text-left">
            &larr; Back
          </button>

          {!pendingMelt ? (
            <>
              <div className="mb-3">
                <label className="text-xs text-muted block mb-1">From mint</label>
                <select
                  value={mintUrl}
                  onChange={(e) => setMintUrl((e.target as HTMLSelectElement).value)}
                  className="w-full input text-sm"
                >
                  {Object.entries(balances).map(([m, b]) => (
                    <option key={m} value={m}>{new URL(m).hostname} ({b} sats)</option>
                  ))}
                </select>
              </div>

              <div className="mb-3">
                <label className="text-xs text-muted block mb-1">Lightning Invoice</label>
                <textarea
                  value={invoice}
                  onInput={(e) => setInvoice((e.target as HTMLTextAreaElement).value)}
                  placeholder="lnbc..."
                  className="w-full input text-sm h-20 resize-none"
                />
              </div>

              <button onClick={handleCreateMelt} disabled={loading || !invoice} className="btn-success text-sm w-full">
                {loading ? 'Getting quote...' : 'Get Quote'}
              </button>
            </>
          ) : (
            <>
              <div className="bg-surface-2 p-3 rounded mb-3">
                <div className="flex-between text-sm mb-1">
                  <span className="text-muted">Amount:</span>
                  <span>{pendingMelt.amount} sats</span>
                </div>
                <div className="flex-between text-sm">
                  <span className="text-muted">Fee:</span>
                  <span>{pendingMelt.fee} sats</span>
                </div>
                <div className="flex-between text-sm font-bold border-t border-surface-3 mt-2 pt-2">
                  <span>Total:</span>
                  <span>{pendingMelt.amount + pendingMelt.fee} sats</span>
                </div>
              </div>

              <button onClick={handlePayInvoice} disabled={loading} className="btn-success text-sm w-full">
                {loading ? 'Paying...' : 'Confirm Payment'}
              </button>
            </>
          )}
        </>
      )}

      {view === 'settings' && (
        <>
          <div className="mb-4">
            <label className="text-xs text-muted block mb-1">Add Mint</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newMint}
                onInput={(e) => setNewMint((e.target as HTMLInputElement).value)}
                placeholder="https://mint.example.com"
                className="flex-1 input text-sm"
              />
              <button onClick={handleAddMint} disabled={loading || !newMint} className="btn-success text-sm px-3">
                Add
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="text-xs text-muted block mb-1">Known Mints</label>
            <div className="bg-surface-2 rounded p-2 max-h-24 overflow-auto">
              {mints.length === 0 ? (
                <span className="text-xs text-muted">No mints added</span>
              ) : (
                mints.map(m => (
                  <div key={m} className="text-xs truncate" title={m}>{m}</div>
                ))
              )}
            </div>
          </div>

          <div className="border-t border-surface-3 pt-4">
            <button onClick={() => setShowMnemonic(!showMnemonic)} className="btn-ghost text-xs w-full mb-2">
              {showMnemonic ? 'Hide Seed Phrase' : 'Show Seed Phrase'}
            </button>
            {showMnemonic && (
              <div className="bg-surface-2 p-2 rounded text-xs font-mono break-words select-all">
                {getMnemonic()}
              </div>
            )}
            <p className="text-xs text-muted mt-2">
              Back up your seed phrase to restore your wallet on another device.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
