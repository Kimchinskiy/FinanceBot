import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { fmt } from '../utils.js';

export default function AssetModal({ open, type, editing, onClose, onSaved, toast }) {
  const { state, quotesConfig } = useStore();
  const [assetType, setAssetType] = useState(type || 'deposit');
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [rate, setRate] = useState('');
  const [cryptoSearch, setCryptoSearch] = useState('');
  const [cryptoResults, setCryptoResults] = useState([]);
  const [selectedCrypto, setSelectedCrypto] = useState(null);
  const [qtyCrypto, setQtyCrypto] = useState('');
  const [cryptoPreview, setCryptoPreview] = useState('');
  const [cryptoPrice, setCryptoPrice] = useState(0);
  const [symbolBroker, setSymbolBroker] = useState('');
  const [qtyBroker, setQtyBroker] = useState('');
  const [priceBroker, setPriceBroker] = useState('');
  const [brokerPreview, setBrokerPreview] = useState('');
  const [brokerHint, setBrokerHint] = useState('');
  const [searchTimer, setSearchTimer] = useState(null);

  useEffect(() => {
    if (open) {
      const t = type || 'deposit';
      setAssetType(t);
      setSelectedCrypto(null);
      const asset = editing || null;
      setName(asset && asset.type === 'deposit' ? asset.name : '');
      setBalance(asset && asset.type === 'deposit' ? asset.balance : '');
      setRate(asset && asset.meta && asset.meta.rate ? asset.meta.rate : '');
      setCryptoSearch('');
      setCryptoResults([]);
      setQtyCrypto(asset && asset.type === 'crypto' ? asset.quantity : '');
      setSymbolBroker(asset && asset.type === 'broker' ? (asset.symbol || '') : '');
      setQtyBroker(asset && asset.type === 'broker' ? asset.quantity : '');
      setPriceBroker(asset && asset.type === 'broker' ? asset.unit_price : '');
      setCryptoPreview('');
      setBrokerPreview('');
      if (asset && asset.type === 'crypto') {
        setSelectedCrypto({ id: asset.symbol, symbol: asset.symbol, name: asset.name });
      }
      setBrokerHint(quotesConfig.stocks
        ? 'Можно получить котировку автоматически'
        : 'Авто-котировки выкл. — введите цену вручную (в .env: STOCK_API_KEY)');
    }
  }, [open, type, editing, quotesConfig.stocks]);

  const onCryptoSearch = (q) => {
    setCryptoSearch(q);
    if (!q) { setCryptoResults([]); return; }
    clearTimeout(searchTimer);
    const t = setTimeout(async () => {
      try {
        const results = await api('GET', `/quotes/crypto/search?q=${encodeURIComponent(q)}`);
        setCryptoResults(results);
      } catch {
        setCryptoResults([]);
      }
    }, 350);
    setSearchTimer(t);
  };

  const pickCrypto = (c) => {
    setSelectedCrypto({ id: c.id, symbol: c.symbol, name: c.name });
    setCryptoSearch(c.name);
    setCryptoResults([]);
    updateCryptoPreview(c.id);
  };

  const updateCryptoPreview = async (cryptoId) => {
    const id = cryptoId || selectedCrypto?.id;
    const qty = parseFloat(qtyCrypto);
    if (!id || !qty) { setCryptoPreview(''); return; }
    setCryptoPreview('Загрузка цены…');
    try {
      const prices = await api('GET', `/quotes/crypto/price?ids=${encodeURIComponent(id)}`);
      const price = prices[id];
      if (price) {
        setCryptoPrice(price);
        setCryptoPreview(`Цена: ${fmt(price)} · Стоимость: ${fmt(price * qty)}`);
      } else setCryptoPreview('Цена недоступна');
    } catch {
      setCryptoPreview('Не удалось получить цену');
    }
  };

  const fetchStockQuote = async () => {
    if (!symbolBroker.trim()) { toast('Введите тикер', '#ff3b30'); return; }
    setBrokerHint('Загрузка котировки…');
    try {
      const data = await api('GET', `/quotes/stock?symbol=${encodeURIComponent(symbolBroker.trim())}`);
      if (data && data.priceRub) {
        setPriceBroker(data.priceRub.toFixed(2));
        setBrokerHint(`Котировка: ${fmt(data.priceUsd)} USD × ${data.usdRub.toFixed(2)} = ${fmt(data.priceRub)}`);
        updateBrokerPreview();
      } else setBrokerHint('Котировка недоступна');
    } catch {
      setBrokerHint('Ошибка получения котировки');
    }
  };

  const updateBrokerPreview = () => {
    const qty = parseFloat(qtyBroker);
    const price = parseFloat(priceBroker);
    if (qty && price) setBrokerPreview(`Стоимость: ${fmt(qty * price)}`);
    else setBrokerPreview('');
  };

  const save = async () => {
    let payload = { type: assetType, currency: 'RUB' };
    if (assetType === 'deposit') {
      if (!name.trim()) { toast('Введите название', '#ff3b30'); return; }
      const b = parseFloat(balance);
      if (isNaN(b)) { toast('Введите сумму', '#ff3b30'); return; }
      payload.name = name.trim();
      payload.balance = b;
      payload.meta = { rate: isNaN(parseFloat(rate)) ? null : parseFloat(rate) };
    } else if (assetType === 'crypto') {
      const qty = parseFloat(qtyCrypto);
      if (!selectedCrypto) { toast('Выберите монету', '#ff3b30'); return; }
      if (!qty || qty <= 0) { toast('Введите количество', '#ff3b30'); return; }
      let price = cryptoPrice;
      if (!price) {
        try {
          const prices = await api('GET', `/quotes/crypto/price?ids=${encodeURIComponent(selectedCrypto.id)}`);
          price = prices[selectedCrypto.id] || 0;
        } catch {}
      }
      payload.name = selectedCrypto.name;
      payload.symbol = selectedCrypto.id;
      payload.quantity = qty;
      payload.unit_price = price;
    } else if (assetType === 'broker') {
      const qty = parseFloat(qtyBroker);
      const price = parseFloat(priceBroker);
      if (!symbolBroker.trim()) { toast('Введите тикер', '#ff3b30'); return; }
      if (!qty || qty <= 0) { toast('Введите количество', '#ff3b30'); return; }
      if (isNaN(price) || price <= 0) { toast('Введите цену', '#ff3b30'); return; }
      payload.name = symbolBroker.trim().toUpperCase();
      payload.symbol = symbolBroker.trim().toUpperCase();
      payload.quantity = qty;
      payload.unit_price = price;
    }
    try {
      if (editing) await api('PUT', `/accounts/${editing.id}`, payload);
      else await api('POST', '/accounts', payload);
      onSaved();
      onClose();
      toast('Актив сохранён!');
    } catch {
      toast('Ошибка сохранения', '#ff3b30');
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>{editing ? 'Изменить актив' : 'Добавить актив'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Тип актива</label>
            <select className="input-field" value={assetType} onChange={(e) => setAssetType(e.target.value)}>
              <option value="deposit">🏦 Вклад / счёт</option>
              <option value="crypto">₿ Криптовалюта</option>
              <option value="broker">📊 Акция / брокер</option>
            </select>
          </div>

          {assetType === 'deposit' && (
            <>
              <div className="form-group">
                <label>Название</label>
                <input type="text" className="input-field" placeholder="Вклад в Сбере" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Сумма (₽)</label>
                <input type="number" className="input-field" placeholder="0" value={balance} onChange={(e) => setBalance(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Ставка, % годовых (необязательно)</label>
                <input type="number" className="input-field" placeholder="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
              </div>
            </>
          )}

          {assetType === 'crypto' && (
            <>
              <div className="form-group">
                <label>Монета</label>
                <input type="text" className="input-field" placeholder="Например: bitcoin, eth, solana" autoComplete="off" value={cryptoSearch} onChange={(e) => onCryptoSearch(e.target.value)} />
                <div className="crypto-results">
                  {cryptoResults.map(c => (
                    <div key={c.id} className="crypto-result" onClick={() => pickCrypto(c)}>
                      <span className="cr-name">{c.name}</span>
                      <span className="cr-sym">{c.symbol}</span>
                    </div>
                  ))}
                </div>
                {selectedCrypto && <div className="asset-selected">Выбрано: <b>{selectedCrypto.name}</b> ({selectedCrypto.symbol})</div>}
              </div>
              <div className="form-group">
                <label>Количество</label>
                <input type="number" className="input-field" placeholder="0.00" step="any" value={qtyCrypto} onChange={(e) => { setQtyCrypto(e.target.value); updateCryptoPreview(); }} />
              </div>
              {cryptoPreview && <div className="asset-preview">{cryptoPreview}</div>}
            </>
          )}

          {assetType === 'broker' && (
            <>
              <div className="form-group">
                <label>Тикер</label>
                <input type="text" className="input-field" placeholder="AAPL, SBER, TSLA" autoComplete="off" value={symbolBroker} onChange={(e) => setSymbolBroker(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Количество</label>
                <input type="number" className="input-field" placeholder="0" step="any" value={qtyBroker} onChange={(e) => { setQtyBroker(e.target.value); updateBrokerPreview(); }} />
              </div>
              <div className="form-group">
                <label>Цена за шт, ₽</label>
                <div className="price-row">
                  <input type="number" className="input-field" placeholder="0" step="any" value={priceBroker} onChange={(e) => { setPriceBroker(e.target.value); updateBrokerPreview(); }} />
                  {quotesConfig.stocks && <button type="button" className="btn-outline" onClick={fetchStockQuote}>Котировка</button>}
                </div>
                <span className="text-muted">{brokerHint}</span>
              </div>
              {brokerPreview && <div className="asset-preview">{brokerPreview}</div>}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-outline" onClick={onClose}>Отмена</button>
          <button className="btn-primary" onClick={save}>Сохранить</button>
        </div>
      </div>
    </div>
  );
}
