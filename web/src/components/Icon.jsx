import {
  Activity, Archive, ArrowDownLeft, ArrowUpRight, BarChart3, Bell, Bot,
  BriefcaseBusiness, Building2, CalendarDays, Car, ChartNoAxesCombined,
  CircleDollarSign, CreditCard, Database, Dices, FileText, Gift, GraduationCap,
  HandCoins, HeartPulse, Home, Landmark, Laptop, Lightbulb, MessageCircle,
  Package, Palette, PiggyBank, PlugZap, Receipt, RefreshCw, Settings2,
  ShoppingBag, Smartphone, Sparkles, Tag, Target, Trash2, TrendingDown,
  TrendingUp, Wallet, Wrench, X,
} from 'lucide-react';

const icons = { activity: Activity, archive: Archive, down: ArrowDownLeft, up: ArrowUpRight,
  analytics: BarChart3, bell: Bell, bot: Bot, briefcase: BriefcaseBusiness, building: Building2,
  calendar: CalendarDays, car: Car, chart: ChartNoAxesCombined, cash: CircleDollarSign,
  card: CreditCard, database: Database, games: Dices, file: FileText, gift: Gift, circleDollarSign: CircleDollarSign,
  health: HeartPulse, home: Home, invest: Landmark, laptop: Laptop, bulb: Lightbulb,
  message: MessageCircle, package: Package, palette: Palette, piggy: PiggyBank,
  plug: PlugZap, receipt: Receipt, refresh: RefreshCw, settings: Settings2,
  shop: ShoppingBag, phone: Smartphone, sparkles: Sparkles, tag: Tag, target: Target,
  trash: Trash2, downTrend: TrendingDown, upTrend: TrendingUp, wallet: Wallet,
  wrench: Wrench, close: X,
};

export default function Icon({ name, size = 17, strokeWidth = 1.8, className = '' }) {
  const Component = icons[name] || CircleDollarSign;
  return <Component size={size} strokeWidth={strokeWidth} className={`ui-icon ${className}`} aria-hidden="true" />;
}

export function CategoryIcon({ category, ...props }) {
  const map = { 'Еда': 'shop', 'Транспорт': 'car', 'Жильё': 'home', 'Одежда': 'tag', 'Здоровье': 'health', 'Развлечения': 'games', 'Связь': 'phone', 'Коммуналка': 'bulb', 'Кредит': 'building', 'Зарплата': 'briefcase', 'Фриланс': 'laptop', 'Подработка': 'wrench', 'Подарок': 'gift', 'Инвестиции': 'chart' };
  return <Icon name={map[category] || 'package'} {...props} />;
}
