'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

interface CostChartProps {
  projects: Array<{
    name?: string;
    targetPrice?: number | string;
    shouldCost?: number | string;
  }>;
}

export function CostChart({ projects }: CostChartProps) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={projects.slice(0, 8).map((p) => ({
            name: p.name?.substring(0, 15) || 'Unnamed',
            quoted: Number(p.targetPrice) || 0,
            should: Number(p.shouldCost) || 0,
          }))}
          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="name"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          />
          <Bar dataKey="quoted" name="Target Cost" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} />
          <Bar dataKey="should" name="Should Cost" fill="hsl(var(--chart-2))" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface StatusPieChartProps {
  statusDistribution: Array<{
    label: string;
    count: number;
  }>;
}

export function StatusPieChart({ statusDistribution }: StatusPieChartProps) {
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={statusDistribution}
            cx="50%"
            cy="50%"
            innerRadius={45}
            outerRadius={75}
            paddingAngle={3}
            dataKey="count"
            nameKey="label"
          >
            {statusDistribution.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
