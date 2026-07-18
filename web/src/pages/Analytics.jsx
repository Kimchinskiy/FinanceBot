import { useState, useMemo } from 'react';
import { Doughnut, Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, ArcElement, LineElement, BarElement, PointElement,
  CategoryScale, LinearScale, Tooltip, Legend, Filler
} from 'chart.js';
import { useStore } from '../store.jsx';
import { fmt, inPeriod, groupBy, getCategoryColor, fmtDate, spendableTotal } from '../utils.js';

ChartJS.register(ArcElement, LineElement, BarElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

const tooltipRub = (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString('ru-RU')} ₽`;
const tooltipPie = (ctx) => ` ${ctx.label}: ${ctx.parsed.toLocaleString('ru-RU')} ₽`;

export default function Analytics() {
  const { state } = useStore();
  const [period, setPeriod] = useState('month');

  const incomes = state.incomes.filter(i => inPeriod(i.datetime, period));
  const expenses = state.expenses.filter(e => inPeriod(e.datetime, period));
  const mandSum = state.mandatory.reduce((s, m) => s + Number(m.amount), 0);
  const totalInc = incomes.reduce((s, i) => s + Number(i.amount), 0);
  const totalExp = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const profit = totalInc - totalExp;

  const expenseGroup = groupBy(expenses, 'category');
  const incomeGroup = groupBy(incomes, 'category');

  const expensePie = {
    labels: Object.keys(expenseGroup),
    datasets: [{
      data: Object.values(expenseGroup),
      backgroundColor: Object.keys(expenseGroup).map(l => getCategoryColor(l)),
      borderColor: '#ffffff', borderWidth: 3, hoverBorderWidth: 3, hoverOffset: 6,
    }],
  };
  const incomePie = {
    labels: Object.keys(incomeGroup),
    datasets: [{
      data: Object.values(incomeGroup),
      backgroundColor: Object.keys(incomeGroup).map(l => getCategoryColor(l)),
      borderColor: '#ffffff', borderWidth: 3, hoverBorderWidth: 3, hoverOffset: 6,
    }],
  };

  const balance = useMemo(() => {
    const allTx = [
      ...state.incomes.map(i => ({ date: i.datetime, amount: +i.amount })),
      ...state.expenses.map(e => ({ date: e.datetime, amount: -e.amount })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));
    const netTx = allTx.reduce((s, t) => s + t.amount, 0);
    let running = spendableTotal(state.accounts) - netTx;
    const labels = []; const data = [];
    if (allTx.length) {
      const first = new Date(allTx[0].date);
      labels.push(fmtDate(first)); data.push(running);
      allTx.forEach(tx => { running += tx.amount; labels.push(fmtDate(tx.date)); data.push(running); });
    } else { labels.push('Сейчас'); data.push(running); }
    return { labels, data };
  }, [state.incomes, state.expenses, state.accounts]);

  const months = [];
  const monthLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
    monthLabels.push(d.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' }));
  }
  const incData = months.map(m => state.incomes.filter(i => i.datetime.startsWith(m)).reduce((s, i) => s + +i.amount, 0));
  const expData = months.map(m => state.expenses.filter(e => e.datetime.startsWith(m)).reduce((s, e) => s + +e.amount, 0));

  const pieOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'bottom', labels: { color: '#6e6e73', font: { family: '-apple-system, Inter', size: 12 }, padding: 14, boxWidth: 12 } },
      tooltip: { backgroundColor: '#1d1d1f', borderColor: 'rgba(0,0,0,0.06)', borderWidth: 1, titleColor: '#ffffff', bodyColor: '#d1d1d6', padding: 12, cornerRadius: 10, callbacks: { label: tooltipPie } },
    },
    cutout: '68%',
  };
  const lineOptions = {
    responsive: true,
    plugins: {
      legend: { labels: { color: '#6e6e73', font: { family: '-apple-system, Inter', size: 12 }, boxWidth: 12, padding: 16 } },
      tooltip: { backgroundColor: '#1d1d1f', borderColor: 'rgba(0,0,0,0.06)', borderWidth: 1, titleColor: '#ffffff', bodyColor: '#d1d1d6', padding: 12, cornerRadius: 10, displayColors: false, callbacks: { label: tooltipRub } },
    },
    scales: {
      x: { ticks: { color: '#86868b', font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: 'rgba(0,0,0,0.05)' } },
      y: { ticks: { color: '#86868b', font: { size: 10 }, callback: v => v.toLocaleString('ru-RU') }, grid: { color: 'rgba(0,0,0,0.05)' } },
    },
  };

  return (
    <>
      <div className="analytics-period">
        <label>Период:</label>
        <select className="filter-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="month">Этот месяц</option>
          <option value="3month">3 месяца</option>
          <option value="6month">6 месяцев</option>
          <option value="year">Год</option>
          <option value="all">Всё время</option>
        </select>
      </div>
      <div className="analytics-cards">
        <div className="acard"><div className="acard-label">Доходы</div><div className="acard-val green">{fmt(totalInc)}</div></div>
        <div className="acard"><div className="acard-label">Расходы</div><div className="acard-val red">{fmt(totalExp)}</div></div>
        <div className="acard"><div className="acard-label">Прибыль</div><div className={`acard-val ${profit >= 0 ? 'green' : 'red'}`}>{fmt(profit, true)}</div></div>
        <div className="acard"><div className="acard-label">Обяз. платежи</div><div className="acard-val orange">{fmt(mandSum)}</div></div>
      </div>
      <div className="two-col">
        <div className="panel">
          <div className="panel-header"><span>Расходы по категориям</span></div>
          <Doughnut data={expensePie} options={pieOptions} />
        </div>
        <div className="panel">
          <div className="panel-header"><span>Доходы по категориям</span></div>
          <Doughnut data={incomePie} options={pieOptions} />
        </div>
      </div>
      <div className="panel">
        <div className="panel-header"><span>Динамика баланса</span></div>
        <Line data={{ labels: balance.labels, datasets: [{
          label: 'Баланс', data: balance.data, borderColor: '#34c759', backgroundColor: 'rgba(34,197,94,0.08)',
          fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2,
          segment: {
            borderColor: ctx => ctx.p1.parsed.y < 0 ? '#ff3b30' : '#34c759',
            backgroundColor: ctx => ctx.p1.parsed.y < 0 ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
          },
        }] }} options={lineOptions} />
      </div>
      <div className="panel">
        <div className="panel-header"><span>Доходы vs Расходы по месяцам</span></div>
        <Bar data={{ labels: monthLabels, datasets: [
          { label: 'Доходы', data: incData, backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 6, borderSkipped: false },
          { label: 'Расходы', data: expData, backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 6, borderSkipped: false },
        ] }} options={{ ...lineOptions, scales: { ...lineOptions.scales, x: { ...lineOptions.scales.x, stacked: false }, y: { ...lineOptions.scales.y, stacked: false } } }} />
      </div>
    </>
  );
}
