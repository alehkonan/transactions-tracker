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

/** Renders an axis tick as a pill-shaped chip, matching the `Chip` component's look. */
function AxisChipTick({
  x,
  y,
  label,
  align,
}: {
  x: number;
  y: number;
  label: string;
  align: "center" | "end";
}) {
  const width = label.length * 6.5 + 16;
  const height = 18;
  const rectX = align === "end" ? -width : -width / 2;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect
        x={rectX}
        y={-height / 2}
        width={width}
        height={height}
        rx={height / 2}
        fill="var(--color-surface)"
        stroke="var(--color-border)"
      />
      <text
        x={rectX + width / 2}
        y={4}
        textAnchor="middle"
        fontSize={11}
        fill="var(--color-text-muted)"
      >
        {label}
      </text>
    </g>
  );
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

const renderDayTick = ({ x, y, payload }: TickProps) => (
  <AxisChipTick x={Number(x)} y={Number(y) + 10} label={String(payload?.value)} align="center" />
);

const renderUsdTick = ({ x, y, payload }: TickProps) => (
  <AxisChipTick x={Number(x)} y={Number(y)} label={formatUsd(payload?.value ?? 0)} align="end" />
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
  const weekTicks = pickWeekTicks(year, monthNum - 1, trend.length);
  const moneyTicks = pickMoneyTicks(Math.max(0, ...trend.map((point) => point.cumulativeUsd)));

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
            <AreaChart data={trend} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
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
                width={90}
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
