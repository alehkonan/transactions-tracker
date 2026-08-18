import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { twJoin } from "tailwind-merge";
import { Button } from "~/components/Button";
import { Card } from "~/components/Card";
import { Select, type SelectOption } from "~/components/Select";
import { Title } from "~/components/Title";
import { formatMoney } from "~/utils/format-money";
import type { TooltipContentProps } from "recharts";
import type { SpendingTrendPoint } from "~/modules/statistics/compute-monthly-spending-trend";

const formatUsd = (value: number) => formatMoney(String(value), "USD");

/** `$2,500` → `$2.5k` — an axis label, not a quote, so one decimal and a `k` are enough. */
function formatUsdCompact(value: number) {
  if (value >= 1000) {
    const thousands = value / 1000;
    return `$${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }
  return `$${value}`;
}

/**
 * One tick per week, landing on each Sunday, plus the month's first and last day
 * (the leading/trailing partial weeks).
 */
function pickWeekTicks(year: number, monthIndex: number, daysInMonth: number) {
  const ticks: number[] = [1];
  for (let day = 2; day <= daysInMonth; day++) {
    if (new Date(Date.UTC(year, monthIndex, day)).getUTCDay() === 0) ticks.push(day);
  }
  if (ticks.at(-1) !== daysInMonth) ticks.push(daysInMonth);
  return ticks;
}

/** $500-spaced ticks from 0 up to the smallest multiple of 500 that covers `maxValue`. */
function pickMoneyTicks(maxValue: number, step = 500) {
  const top = Math.ceil(Math.max(maxValue, step) / step) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

type TickProps = { x?: string | number; y?: string | number; payload?: { value: number } };

// Plain muted text rather than the pill chips the axes used to wear: chart furniture should
// stay quieter than the data it annotates.
const renderDayTick = ({ x, y, payload }: TickProps) => (
  <text
    x={Number(x)}
    y={Number(y) + 14}
    textAnchor="middle"
    fontSize={11}
    fill="var(--color-text-muted)"
  >
    {payload?.value}
  </text>
);

const renderUsdTick = ({ x, y, payload }: TickProps) => (
  <text
    x={Number(x) - 6}
    y={Number(y)}
    textAnchor="end"
    fontSize={11}
    fill="var(--color-text-muted)"
  >
    {formatUsdCompact(payload?.value ?? 0)}
  </text>
);

const renderChartTooltip = ({ active, payload, label }: TooltipContentProps) => {
  if (!active || !payload?.length) return null;
  return (
    <Card>
      <Title variant="tooltip">{`Day ${label}`}</Title>
      <p className="text-danger text-sm font-semibold">{formatUsd(Number(payload[0]?.value))}</p>
    </Card>
  );
};

type Props = {
  months: SelectOption[];
  month: string;
  trend: SpendingTrendPoint[];
};

export function SpendingTrendCard({ months, month, trend }: Props) {
  const navigate = useNavigate({ from: "/statistics" });
  const goToMonth = (value: string) => navigate({ search: { month: value } });

  // `months` is sorted newest-first, so "next" (more recent) is the previous index.
  const currentIndex = months.findIndex((option) => option.value === month);
  const prevMonth = currentIndex >= 0 ? months[currentIndex + 1] : undefined;
  const nextMonth = currentIndex > 0 ? months[currentIndex - 1] : undefined;

  const [year, monthNum] = month.split("-").map(Number);
  // A current-month series must not run flat into the future — the cumulative total stops at
  // today and the axis stops with it, so the line reads as "spending so far" rather than
  // "spending stopped". Past months keep their full shape.
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === monthNum - 1;
  const visibleTrend = isCurrentMonth ? trend.slice(0, now.getDate()) : trend;
  const weekTicks = pickWeekTicks(year, monthNum - 1, visibleTrend.length);
  const moneyTicks = pickMoneyTicks(
    Math.max(0, ...visibleTrend.map((point) => point.cumulativeUsd)),
  );

  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <Title variant="card">Spending trend</Title>
        {months.length > 0 && (
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              aria-label="Previous month"
              disabled={!prevMonth}
              onClick={() => prevMonth && goToMonth(prevMonth.value)}
            >
              <ChevronLeftIcon />
            </Button>
            <Select options={months} value={month} onValueChange={(v) => v && goToMonth(v)} />
            <Button
              variant="secondary"
              aria-label="Next month"
              disabled={!nextMonth}
              onClick={() => nextMonth && goToMonth(nextMonth.value)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        )}
      </div>
      <hr className="border-border my-3" />
      {months.length === 0 ? (
        <p className="text-text-muted text-sm">No spending data yet.</p>
      ) : (
        <div
          className={twJoin(
            "h-72",
            // Recharts shifts DOM focus between several of its own internal SVG
            // elements (the root surface, its z-index layer groups, ...) as you
            // interact, so every focusable descendant needs the same treatment.
            "[&_*:focus:not(:focus-visible)]:outline-none",
            "[&_*:focus-visible]:outline-2",
            "[&_*:focus-visible]:outline-accent",
            "[&_*:focus-visible]:outline-offset-2",
          )}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={visibleTrend} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="spendingGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-danger)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--color-danger)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                ticks={weekTicks}
                interval="preserveStartEnd"
                tick={renderDayTick}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={44}
                domain={[0, moneyTicks.at(-1) ?? 0]}
                ticks={moneyTicks}
                tick={renderUsdTick}
              />
              <Tooltip content={renderChartTooltip} />
              <Area
                type="monotone"
                dataKey="cumulativeUsd"
                stroke="var(--color-danger)"
                strokeWidth={2}
                fill="url(#spendingGradient)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
