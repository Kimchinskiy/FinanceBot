import { useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { fmt, sumBalances, accountsByType, assetEmoji, fmtDateTime } from '../utils.js';
import AssetModal from '../components/AssetModal.jsx';

export default function Assets({ toast }) {
  const { state, reload, quotesConfig } = useStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState('deposit');
  const [editing, setEditing] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const dep = sumBalances(state.accounts, ['deposit']);
  const cr = sumBalances(state.accounts, ['crypto']);
  const br = sumBalances(state.accounts, ['broker']);

  const openAdd = (type) => { setEditing(null); setModalType(type); setModalOpen(true); };
  const openEdit = (a) => { setEditing(a); setModalType(a.type); setModalOpen(true); };

  const refreshPrices = async () => {
    setRefreshing(true);
    try {
      const res = await api('POST', '/accounts/refresh-prices');
      await reload('accounts');
      if (res.errors && res.errors.length) toast(`Обновлено: ${res.updated}. Ошибки: ${res.errors.length}`, '#ff9500');
      else toast(`Котировки обновлены (${res.updated})`);
    } catch {
      toast('Ошибка обновления котировок', '#ff3b30');
    } finally {
      setRefreshing(false);
    }
  };

  const renderList = (type) => {
    const items = accountsByType(state.accounts, type);
    if (!items.length) {
      const empty = { deposit: 'Нет вкладов', crypto: 'Нет криптовалюты', broker: 'Нет акций' }[type];
      return <div className="empty-state">{empty}</div>;
    }
    return items.map(a => {
      let sub = '';
      if (type === 'crypto') sub = `${(a.quantity ?? 0)} ${(a.symbol || '').toUpperCase()} × ${fmt(a.unit_price || 0)}`;
      else if (type === 'broker') sub = `${(a.quantity ?? 0)} × ${fmt(a.unit_price || 0)} · ${(a.symbol || '').toUpperCase()}`;
      else { const rate = a.meta && a.meta.rate ? ` · ${a.meta.rate}% годовых` : ''; sub = `${a.currency || 'RUB'}${rate}`; }
      return (
        <div key={a.id} className="asset-item">
          <div className="asset-icon">{assetEmoji(type)}</div>
          <div className="asset-info">
            <div className="asset-name">{a.name}</div>
            <div className="asset-sub">{sub}</div>
          </div>
          <div className="asset-right">
            <div className="asset-value">{fmt(a.balance)}</div>
            <div className="asset-actions">
              <button className="action-btn" onClick={() => openEdit(a)} title="Изменить">✎</button>
              <button className="action-btn" onClick={async () => { await api('DELETE', `/accounts/${a.id}`); await reload('accounts'); toast('Удалено'); }} title="Удалить">🗑</button>
            </div>
          </div>
        </div>
      );
    });
  };

  const invest = state.accounts.filter(a => (a.type === 'crypto' || a.type === 'broker') && a.price_updated_at);
  let updText = '';
  if (invest.length) {
    const latest = invest.map(a => new Date(a.price_updated_at)).sort((a, b) => b - a)[0];
    updText = 'Котировки: ' + fmtDateTime(latest);
  }

  return (
    <>
      <div className="page-actions">
        <button className="btn-primary" onClick={() => openAdd('deposit')}>+ Добавить актив</button>
        <button className="btn-outline" onClick={refreshPrices} disabled={refreshing}>{refreshing ? '⏳ Обновляю…' : '🔄 Обновить котировки'}</button>
        <span className="assets-updated">{updText}</span>
      </div>

      <div className="assets-summary">
        <div className="asum"><div className="asum-label">Всего активов</div><div className="asum-val">{fmt(dep + cr + br)}</div></div>
        <div className="asum"><div className="asum-label">Вклады</div><div className="asum-val">{fmt(dep)}</div></div>
        <div className="asum"><div className="asum-label">Криптовалюта</div><div className="asum-val">{fmt(cr)}</div></div>
        <div className="asum"><div className="asum-label">Акции</div><div className="asum-val">{fmt(br)}</div></div>
      </div>

      <div className="panel asset-module">
        <div className="panel-header"><span>🏦 Вклады и счета</span><button className="link-btn" onClick={() => openAdd('deposit')}>+ Вклад</button></div>
        <div className="asset-list">{renderList('deposit')}</div>
      </div>
      <div className="panel asset-module">
        <div className="panel-header"><span>₿ Криптовалюта</span><button className="link-btn" onClick={() => openAdd('crypto')}>+ Монета</button></div>
        <div className="asset-list">{renderList('crypto')}</div>
      </div>
      <div className="panel asset-module">
        <div className="panel-header"><span>📊 Акции / Брокер</span><button className="link-btn" onClick={() => openAdd('broker')}>+ Акция</button></div>
        <div className="asset-list">{renderList('broker')}</div>
      </div>

      <AssetModal open={modalOpen} type={modalType} editing={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => reload('accounts')}
        toast={toast} />
    </>
  );
}
