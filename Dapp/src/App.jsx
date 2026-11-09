import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';

const TARGET_CHAIN_ID = 560048;
const TARGET_CHAIN_ID_HEX = '0x88bb0';
const ELEMENT_COUNT = 3;

// University assignment identity — must be visible on first paint.
const STUDENT_NAME = 'ณัฏฐณิชา ปรือปรัง';
const STUDENT_ID = '66013672';

function getConfig() {
  return (typeof window !== 'undefined' && window.__QUICK_DAPP_CONFIG__) || {};
}

function parseAmount(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    return ethers.parseEther(trimmed);
  } catch (err) {
    return null;
  }
}

function formatAmount(big) {
  if (big === null || big === undefined) return '—';
  try {
    const raw = ethers.formatEther(big);
    const [whole, frac = ''] = raw.split('.');
    const shortFrac = frac.slice(0, 6).replace(/0+$/, '');
    return shortFrac ? `${whole}.${shortFrac}` : whole;
  } catch (err) {
    return '—';
  }
}

function shortAddress(addr) {
  if (!addr || typeof addr !== 'string') return '';
  return `${addr.slice(0, 6)}···${addr.slice(-4)}`;
}

function formatTime(at) {
  try {
    return new Date(at).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (err) {
    return '';
  }
}

export default function App() {
  const config = getConfig();
  const bindings = Array.isArray(config.contracts) ? config.contracts : [];
  const primary =
    bindings.find((c) => c && c.id === config.primaryContractId) || bindings[0] || null;

  const configError = useMemo(() => {
    if (!primary) return 'No contract binding found in this DApp configuration.';
    if (!primary.address || !/^0x[a-fA-F0-9]{40}$/.test(primary.address)) {
      return 'The configured contract address is missing or invalid.';
    }
    const hasExpectedFns = ['deposit', 'withdraw', 'checkBlance'].every((fn) =>
      (primary.abi || []).some((entry) => entry && entry.type === 'function' && entry.name === fn)
    );
    if (!hasExpectedFns) return 'The configured contract ABI is missing required functions.';
    return null;
  }, [primary]);

  const rawProviderRef = useRef(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(null);

  const [balance, setBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [activity, setActivity] = useState([]);

  const [depositValue, setDepositValue] = useState('');
  const [withdrawValue, setWithdrawValue] = useState('');
  const [pending, setPending] = useState(null);
  const [notice, setNotice] = useState(null);
  const [done, setDone] = useState({ deposit: false, withdraw: false });

  const contractRef = useRef(null);
  const readContractRef = useRef(null);

  const addActivity = useCallback((kind, text, status = 'ok') => {
    setActivity((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          kind,
          text,
          status,
          at: Date.now(),
        },
        ...prev,
      ].slice(0, ELEMENT_COUNT + 3)
    );
  }, []);

  const refreshBalance = useCallback(async () => {
    const contract = readContractRef.current;
    if (!contract) {
      setBalance(null);
      return;
    }
    setBalanceLoading(true);
    try {
      // Contract spells it checkBlance (sic) — do not "fix" this name.
      const value = await contract.checkBlance();
      setBalance(value);
    } catch (err) {
      setBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const handleAccountsChanged = useCallback(
    async (accounts) => {
      const list = Array.isArray(accounts) ? accounts : [];
      if (list.length === 0) {
        contractRef.current = null;
        readContractRef.current = null;
        setAccount(null);
        setBalance(null);
        return;
      }
      const nextAccount = list[0];
      setAccount(nextAccount);
      const raw = rawProviderRef.current;
      if (!raw) return;
      try {
        const provider = new ethers.BrowserProvider(raw);
        const signer = await provider.getSigner();
        if (primary) {
          contractRef.current = new ethers.Contract(primary.address, primary.abi, signer);
        }
      } catch (err) {
        contractRef.current = null;
      }
    },
    [primary]
  );

  const handleChainChanged = useCallback(
    async (nextChainId) => {
      const parsed =
        typeof nextChainId === 'string' && nextChainId.startsWith('0x')
          ? parseInt(nextChainId, 16)
          : Number(nextChainId);
      setChainId(Number.isFinite(parsed) ? parsed : null);
      const raw = rawProviderRef.current;
      if (!raw || !primary) return;
      try {
        const provider = new ethers.BrowserProvider(raw);
        const signer = await provider.getSigner();
        contractRef.current = new ethers.Contract(primary.address, primary.abi, signer);
        if (Number.isFinite(parsed) && parsed === TARGET_CHAIN_ID) {
          await refreshBalance();
        }
      } catch (err) {
        contractRef.current = null;
      }
    },
    [primary, refreshBalance]
  );

  useEffect(() => {
    return () => {
      const raw = rawProviderRef.current;
      if (raw && typeof raw.removeListener === 'function') {
        raw.removeListener('accountsChanged', handleAccountsChanged);
        raw.removeListener('chainChanged', handleChainChanged);
      }
      rawProviderRef.current = null;
    };
  }, [handleAccountsChanged, handleChainChanged]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    setNotice(null);
    try {
      if (!primary) throw new Error('No contract binding is configured for this DApp.');

      let raw = null;
      if (typeof window !== 'undefined' && typeof window.__qdapp_getProvider === 'function') {
        raw = await withTimeout(
          window.__qdapp_getProvider(),
          45000,
          'Timed out selecting a wallet provider. Unlock your wallet and retry.'
        );
      } else if (typeof window !== 'undefined' && window.ethereum) {
        raw = window.ethereum;
      }
      if (!raw || typeof raw.request !== 'function') {
        throw new Error('No Ethereum wallet was found. Install or unlock a wallet, then retry.');
      }
      console.info('[QDBinding] wallet.connect', { stage: 'provider-selected' });

      const accounts = await withTimeout(
        raw.request({ method: 'eth_requestAccounts' }),
        45000,
        'Timed out waiting for wallet approval. Unlock your wallet and retry.'
      );
      if (!Array.isArray(accounts) || accounts.length === 0 || !accounts[0]) {
        throw new Error('Wallet returned no accounts. Unlock your wallet and retry.');
      }
      console.info('[QDBinding] wallet.connect', { stage: 'accounts-authorized' });

      const previous = rawProviderRef.current;
      if (previous && previous !== raw && typeof previous.removeListener === 'function') {
        previous.removeListener('accountsChanged', handleAccountsChanged);
        previous.removeListener('chainChanged', handleChainChanged);
      }

      rawProviderRef.current = raw;
      if (typeof raw.on === 'function') {
        if (typeof raw.removeListener === 'function') {
          raw.removeListener('accountsChanged', handleAccountsChanged);
          raw.removeListener('chainChanged', handleChainChanged);
        }
        raw.on('accountsChanged', handleAccountsChanged);
        raw.on('chainChanged', handleChainChanged);
      }

      const provider = new ethers.BrowserProvider(raw);
      let network = null;
      try {
        network = await provider.getNetwork();
      } catch (err) {
        network = null;
      }
      const resolvedChainId = network ? Number(network.chainId) : null;
      setChainId(resolvedChainId);

      const signer = await provider.getSigner();
      console.info('[QDBinding] wallet.connect', { stage: 'connected' });

      contractRef.current = new ethers.Contract(primary.address, primary.abi, signer);
      setAccount(accounts[0]);

      if (resolvedChainId === TARGET_CHAIN_ID) {
        readContractRef.current = new ethers.Contract(primary.address, primary.abi, provider);
        await refreshBalance();
      } else {
        readContractRef.current = null;
        setBalance(null);
      }
    } catch (err) {
      contractRef.current = null;
      readContractRef.current = null;
      setAccount(null);
      setBalance(null);
      setConnectError(err && err.message ? err.message : 'Wallet connection failed.');
    } finally {
      setConnecting(false);
    }
  }, [primary, handleAccountsChanged, handleChainChanged, refreshBalance]);

  const disconnect = useCallback(() => {
    const raw = rawProviderRef.current;
    if (raw && typeof raw.removeListener === 'function') {
      raw.removeListener('accountsChanged', handleAccountsChanged);
      raw.removeListener('chainChanged', handleChainChanged);
    }
    rawProviderRef.current = null;
    contractRef.current = null;
    readContractRef.current = null;
    setAccount(null);
    setChainId(null);
    setBalance(null);
    try {
      window.localStorage.removeItem('__qdapp_wallet_rdns');
    } catch (err) {
      /* ignore */
    }
  }, [handleAccountsChanged, handleChainChanged]);

  const switchNetwork = useCallback(async () => {
    const raw = rawProviderRef.current || (typeof window !== 'undefined' ? window.ethereum : null);
    if (!raw || typeof raw.request !== 'function') {
      setConnectError('No wallet available to switch networks.');
      return;
    }
    setConnectError(null);
    try {
      await raw.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: TARGET_CHAIN_ID_HEX }],
      });
    } catch (err) {
      setConnectError(err && err.message ? err.message : 'Network switch was rejected.');
    }
  }, []);

  const runDeposit = useCallback(async () => {
    const contract = contractRef.current;
    if (!contract) return;
    const parsed = parseAmount(depositValue);
    if (parsed === null) {
      setNotice({ status: 'error', text: 'Enter a valid ETH amount for the deposit.' });
      return;
    }
    if (parsed <= 0n) {
      setNotice({ status: 'error', text: 'Deposit amount must be greater than zero.' });
      return;
    }
    setPending('deposit');
    setNotice({ status: 'pending', text: 'Confirm the deposit in your wallet…' });
    try {
      const tx = await contract.deposit({ value: parsed });
      addActivity('Deposit', `${formatAmount(parsed)} ETH submitted`, 'pending');
      setNotice({ status: 'pending', text: 'Deposit sent. Waiting for confirmation…' });
      await tx.wait();
      addActivity('Deposit', `${formatAmount(parsed)} ETH confirmed`, 'ok');
      setDone((prev) => ({ ...prev, deposit: true }));
      setNotice({ status: 'ok', text: 'Deposit confirmed.' });
      setDepositValue('');
      await refreshBalance();
    } catch (err) {
      const message = err && err.message ? err.message : 'Deposit failed.';
      addActivity('Deposit', message.slice(0, 90), 'error');
      setNotice({ status: 'error', text: message });
    } finally {
      setPending(null);
    }
  }, [depositValue, addActivity, refreshBalance]);

  const runWithdraw = useCallback(async () => {
    const contract = contractRef.current;
    if (!contract) return;
    const parsed = parseAmount(withdrawValue);
    if (parsed === null) {
      setNotice({ status: 'error', text: 'Enter a valid ETH amount to withdraw.' });
      return;
    }
    if (parsed <= 0n) {
      setNotice({ status: 'error', text: 'Withdraw amount must be greater than zero.' });
      return;
    }
    setPending('withdraw');
    setNotice({ status: 'pending', text: 'Confirm the withdrawal in your wallet…' });
    try {
      const tx = await contract.withdraw(parsed);
      addActivity('WithdrawEvent', `${formatAmount(parsed)} ETH submitted`, 'pending');
      setNotice({ status: 'pending', text: 'Withdrawal sent. Waiting for confirmation…' });
      await tx.wait();
      addActivity('WithdrawEvent', `${formatAmount(parsed)} ETH confirmed`, 'ok');
      setDone((prev) => ({ ...prev, withdraw: true }));
      setNotice({ status: 'ok', text: 'Withdrawal confirmed.' });
      setWithdrawValue('');
      await refreshBalance();
    } catch (err) {
      const message = err && err.message ? err.message : 'Withdrawal failed.';
      addActivity('WithdrawEvent', message.slice(0, 90), 'error');
      setNotice({ status: 'error', text: message });
    } finally {
      setPending(null);
    }
  }, [withdrawValue, addActivity, refreshBalance]);

  const title = config.title || primary?.name || 'Bank';
  const wrongNetwork = account !== null && chainId !== null && chainId !== TARGET_CHAIN_ID;
  const canWrite = Boolean(account) && !wrongNetwork && !pending;

  const balanceRead = Boolean(account) && !wrongNetwork && balance !== null;
  const requirements = [
    {
      key: 'wallet',
      name: 'MetaMask connect',
      ok: Boolean(account),
      detail: account ? shortAddress(account) : 'not connected',
    },
    {
      key: 'network',
      name: `Network ${TARGET_CHAIN_ID}`,
      ok: Boolean(account) && !wrongNetwork,
      detail: chainId === null ? 'Hoodi · 0x88bb0' : String(chainId),
    },
    {
      key: 'contract',
      name: 'Smart contract',
      ok: Boolean(primary && primary.address),
      detail: primary ? shortAddress(primary.address) : 'not bound',
    },
    {
      key: 'check',
      name: 'Check Blance',
      ok: balanceRead,
      detail: 'checkBlance()',
    },
    {
      key: 'deposit',
      name: 'Deposit',
      ok: done.deposit,
      detail: 'deposit()',
    },
    {
      key: 'withdraw',
      name: 'Withdraw',
      ok: done.withdraw,
      detail: 'withdraw(uint256)',
    },
  ];
  const requirementsMet = requirements.filter((r) => r.ok).length;

  if (configError) {
    return (
      <div className="center-wrap">
        <div className="card config-card fade-up">
          <div className="config-head">
            <span className="dot dot-error" aria-hidden="true" />
            <p className="label">Configuration error</p>
          </div>
          <p className="config-text">{configError}</p>
        </div>
      </div>
    );
  }

  const balanceText = account ? (balanceLoading ? null : formatAmount(balance)) : '0';

  return (
    <div className="shell">
      <div className="wrap">
        {/* ---------- header ---------- */}
        <header className="head">
          <div className="brand">
            <span className="mark" aria-hidden="true" />
            <div className="brand-copy">
              <h1 className="title">{title}</h1>
              <p className="hint sub">Deposit and withdraw ETH with your wallet.</p>
            </div>
          </div>

          <div className="wallet">
            {account ? (
              <>
                <span className="chip mono">
                  <span
                    className={`dot ${wrongNetwork ? 'dot-error' : 'dot-live'}`}
                    aria-hidden="true"
                  />
                  {shortAddress(account)}
                </span>
                <div className="wallet-links">
                  <button type="button" className="link-btn" onClick={disconnect}>
                    Disconnect
                  </button>
                  {wrongNetwork && (
                    <button type="button" className="link-btn" onClick={switchNetwork}>
                      Switch network
                    </button>
                  )}
                </div>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-sm"
                onClick={connect}
                disabled={connecting}
              >
                {connecting ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}
          </div>
        </header>

        {/* ---------- student identity + assignment coverage ---------- */}
        <section className="card ident fade-up" aria-label="Student identity">
          <div className="ident-row">
            <div className="ident-main">
              <p className="label ident-label">Student identity</p>
              <p className="student-line">
                <span className="student-name" lang="th">
                  {STUDENT_NAME}
                </span>
                <span className="student-sep" aria-hidden="true">·</span>
                <span className="mono student-id">{STUDENT_ID}</span>
              </p>
            </div>
            <span className="chip ident-status">
              <span
                className={`dot ${requirementsMet === requirements.length ? 'dot-live' : 'dot-muted'}`}
                aria-hidden="true"
              />
              <span className="mono">
                {requirementsMet}/{requirements.length} verified
              </span>
            </span>
          </div>

          <hr className="hair" />

          <div className="reqs-head">
            <p className="label">Assignment requirements</p>
          </div>
          <ul className="req-list">
            {requirements.map((req) => (
              <li key={req.key} className={`req ${req.ok ? 'is-ok' : ''}`}>
                <span
                  className={`dot ${req.ok ? 'dot-live' : 'dot-muted'}`}
                  aria-hidden="true"
                />
                <span className="req-name">{req.name}</span>
                <span className="mono req-detail">{req.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------- balance ---------- */}
        <section className="card balance-card">
          <div className="card-head">
            <p className="label">Your balance</p>
            {account && !wrongNetwork && (
              <button
                type="button"
                className="link-btn"
                onClick={refreshBalance}
                disabled={balanceLoading}
              >
                {balanceLoading ? 'Syncing…' : 'Refresh'}
              </button>
            )}
          </div>

          <div className="balance">
            <span className="mono display balance-figure">
              {balanceText === null ? (
                <span className="skeleton" aria-label="Loading balance" />
              ) : (
                balanceText
              )}
            </span>
            <span className="unit">ETH</span>
          </div>

          <p className="hint mt-12">
            {!account
              ? 'Connect a wallet to read your on-chain balance.'
              : wrongNetwork
                ? `You are on chain ${chainId}. Switch to ${TARGET_CHAIN_ID} to read and update.`
                : 'Read live from checkBlance() on the deployed contract.'}
          </p>

          <hr className="hair" />

          <dl className="meta">
            <div className="meta-item">
              <dt className="label">Network</dt>
              <dd className="meta-value">
                Ethereum Hoodi <span className="mono ink-faint">· {TARGET_CHAIN_ID}</span>
              </dd>
            </div>
            <div className="meta-item">
              <dt className="label">Contract</dt>
              <dd className="mono meta-value">{primary.address}</dd>
            </div>
          </dl>
        </section>

        {/* ---------- actions ---------- */}
        <section className="actions">
          <div className="card-quiet action fade-up">
            <div className="action-head">
              <span className="dot" aria-hidden="true" />
              <p className="label">Deposit</p>
            </div>
            <label className="action-body">
              <span className="sr-only">Deposit amount in ETH</span>
              <span className={`amount-shell ${!canWrite ? 'is-disabled' : ''}`}>
                <input
                  className="field mono"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={depositValue}
                  onChange={(e) => setDepositValue(e.target.value)}
                  disabled={!canWrite}
                />
                <span className="unit">ETH</span>
              </span>
            </label>
            <button
              type="button"
              className="btn btn-full"
              onClick={runDeposit}
              disabled={!canWrite}
            >
              {pending === 'deposit' ? 'Depositing…' : 'Deposit ETH'}
            </button>
            <p className="hint mt-12">
              {!account
                ? 'Connect a wallet to enable deposits.'
                : wrongNetwork
                  ? `Switch to chain ${TARGET_CHAIN_ID} to enable deposits.`
                  : 'Calls deposit() with your amount as msg.value.'}
            </p>
          </div>

          <div className="card-quiet action fade-up">
            <div className="action-head">
              <span className="dot dot-muted" aria-hidden="true" />
              <p className="label">Withdraw</p>
            </div>
            <label className="action-body">
              <span className="sr-only">Withdraw amount in ETH</span>
              <span className={`amount-shell ${!canWrite ? 'is-disabled' : ''}`}>
                <input
                  className="field mono"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={withdrawValue}
                  onChange={(e) => setWithdrawValue(e.target.value)}
                  disabled={!canWrite}
                />
                <span className="unit">ETH</span>
              </span>
            </label>
            <button
              type="button"
              className="btn btn-ghost btn-full"
              onClick={runWithdraw}
              disabled={!canWrite}
            >
              {pending === 'withdraw' ? 'Withdrawing…' : 'Withdraw ETH'}
            </button>
            <p className="hint mt-12">
              {!account
                ? 'Connect a wallet to enable withdrawals.'
                : wrongNetwork
                  ? `Switch to chain ${TARGET_CHAIN_ID} to enable withdrawals.`
                  : 'Calls withdraw(uint256 amount) from your balance.'}
            </p>
          </div>
        </section>

        {(notice || connectError) && (
          <div
            className={`notice fade-up ${
              (notice && notice.status === 'error') || connectError ? 'notice-error' : ''
            }`}
            role="status"
            aria-live="polite"
          >
            <span
              className={`dot ${
                (notice && notice.status === 'error') || connectError
                  ? 'dot-error'
                  : notice && notice.status === 'pending'
                    ? 'dot-muted'
                    : ''
              }`}
              aria-hidden="true"
            />
            <span className="notice-text">{connectError || notice.text}</span>
          </div>
        )}

        {/* ---------- activity ---------- */}
        <section className="activity">
          <div className="activity-head">
            <p className="label">Activity</p>
            {activity.length > 0 && (
              <p className="mono activity-count">
                {activity.length} event{activity.length === 1 ? '' : 's'}
              </p>
            )}
          </div>

          {activity.length === 0 ? (
            <p className="hint empty">
              No transactions yet. Your deposits and withdrawals appear here.
            </p>
          ) : (
            <ul>
              {activity.map((item) => (
                <li key={item.id} className="row fade-up">
                  <div className="row-left">
                    <span
                      className={`dot ${
                        item.status === 'error'
                          ? 'dot-error'
                          : item.status === 'pending'
                            ? 'dot-muted'
                            : ''
                      }`}
                      aria-hidden="true"
                    />
                    <div className="row-main">
                      <p className="mono row-kind">{item.kind}</p>
                      <p className="row-text">{item.text}</p>
                    </div>
                  </div>
                  <div className="row-right">
                    <p
                      className={`mono row-status ${
                        item.status === 'error' ? 'ink-danger' : 'ink-faint'
                      }`}
                    >
                      {item.status}
                    </p>
                    <p className="mono row-time">{formatTime(item.at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------- footer ---------- */}
        <footer className="foot">
          <p className="mono foot-signatures">deposit() · withdraw(uint256) · checkBlance()</p>
          <p className="label foot-student">
            <span lang="th">{STUDENT_NAME}</span> · {STUDENT_ID}
          </p>
          <p className="label">Chain {TARGET_CHAIN_ID}</p>
        </footer>
      </div>
    </div>
  );
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
