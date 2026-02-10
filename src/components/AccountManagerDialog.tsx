import { useEffect, useMemo, useState } from "react";

import {
  addMicrosoftAccount,
  addOfflineAccount,
  loadAccountStore,
  onAccountsChanged,
  refreshAccount,
  removeAccount,
  setActiveAccount,
} from "../services/accountService";
import type { LauncherAccount } from "../types/account";

interface AccountManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

const statusLabel: Record<LauncherAccount["status"], string> = {
  ready: "Lista",
  expired: "Expirada",
  error: "Error",
  loading: "Cargando",
};

export const AccountManagerDialog = ({ open, onClose }: AccountManagerDialogProps) => {
  const [store, setStore] = useState(loadAccountStore());
  const [offlineName, setOfflineName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => setStore(loadAccountStore());
    sync();
    return onAccountsChanged(sync);
  }, []);

  useEffect(() => {
    if (!open) {
      setActionError(null);
      setOfflineName("");
    }
  }, [open]);

  const sortedAccounts = useMemo(
    () => [...store.accounts].sort((a, b) => b.lastUsedAt - a.lastUsedAt),
    [store.accounts],
  );
  const activeAccountId = store.activeAccountId;

  if (!open) {
    return null;
  }

  const runAction = async (task: () => Promise<void>) => {
    setActionError(null);
    setBusy(true);
    try {
      await task();
      setStore(loadAccountStore());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="account-manager"
        role="dialog"
        aria-modal="true"
        aria-label="Administrar cuentas"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="account-manager__header">
          <div>
            <h3>Administrar cuentas</h3>
            <p>Centro de cuentas con estado en tiempo real, perfil predeterminado y acciones seguras.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        <div className="account-manager__summary">
          <article>
            <strong>{sortedAccounts.length}</strong>
            <span>Cuentas totales</span>
          </article>
          <article>
            <strong>{sortedAccounts.filter((account) => account.type === "msa").length}</strong>
            <span>Microsoft</span>
          </article>
          <article>
            <strong>{sortedAccounts.filter((account) => account.id === activeAccountId).length ? "Sí" : "No"}</strong>
            <span>Perfil activo</span>
          </article>
        </div>

        <div className="account-manager__table">
          <div className="account-manager__row account-manager__row--head">
            <span>Cuenta</span>
            <span>Tipo</span>
            <span>Estado</span>
            <span>Gestión</span>
          </div>
          {sortedAccounts.length ? sortedAccounts.map((account) => (
            <div className="account-manager__row" key={account.id}>
              <span>
                <strong>{account.username}</strong>
                <small>{account.uuid}</small>
              </span>
              <span>{account.type === "msa" ? "MSA" : "Offline"}</span>
              <span className={`account-status account-status--${account.status}`}>{statusLabel[account.status]}</span>
              <span className="account-manager__actions">
                <button type="button" onClick={() => void runAction(async () => { setActiveAccount(account.id); })} disabled={account.id === activeAccountId}>Predeterminada</button>
                <button type="button" onClick={() => void runAction(async () => { await refreshAccount(account.id); })}>Refrescar</button>
                <button type="button" onClick={() => void runAction(async () => { removeAccount(account.id); })} className="account-manager__danger">Eliminar</button>
              </span>
            </div>
          )) : (
            <p className="account-manager__empty">No hay cuentas registradas.</p>
          )}
        </div>

        <footer className="account-manager__footer">
          <button type="button" disabled={busy} onClick={() => void runAction(async () => { await addMicrosoftAccount(); })}>Añadir Microsoft</button>
          <label>
            <span>Usuario Offline</span>
            <input
              type="text"
              value={offlineName}
              placeholder="SteveLocal"
              onChange={(event) => setOfflineName(event.target.value)}
            />
          </label>
          <button type="button" disabled={busy || !offlineName.trim()} onClick={() => void runAction(async () => { await addOfflineAccount(offlineName); setOfflineName(""); })}>Añadir Offline</button>
        </footer>
        {actionError ? <p className="account-manager__error">{actionError}</p> : null}
        <p className="account-manager__hint">
          Para login Microsoft real define <code>VITE_MSA_CLIENT_ID</code> en tu entorno.
        </p>
      </section>
    </div>
  );
};
