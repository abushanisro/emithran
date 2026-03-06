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
  LineChart,
  Line,
  AreaChart,
  Area,
  ComposedChart,
  Legend
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
    status?: string;
    createdAt?: string;
  }>;
}

export function CostChart({ projects }: CostChartProps) {
  if (!projects || projects.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="text-4xl mb-2">📊</div>
          <p className="text-sm">No project data available for cost analysis</p>
        </div>
      </div>
    );
  }

  const chartData = projects.slice(0, 8).map((p) => ({
    name: p.name?.substring(0, 15) || 'Unnamed',
    targetPrice: Number(p.targetPrice) || 0,
    shouldCost: Number(p.shouldCost) || 0,
    savings: (Number(p.targetPrice) || 0) - (Number(p.shouldCost) || 0),
    savingsPercent: Number(p.targetPrice) ? (((Number(p.targetPrice) - Number(p.shouldCost)) / Number(p.targetPrice)) * 100) : 0
  }));

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartData}
          margin={{ top: 20, right: 60, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="name"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis
            yAxisId="cost"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis
            yAxisId="percent"
            orientation="right"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickFormatter={(v) => `${v.toFixed(1)}%`}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
            formatter={(value: any, name: string) => {
              if (name === 'Savings %') return [`${Number(value).toFixed(1)}%`, name];
              return [`₹${Number(value).toLocaleString('en-IN')}`, name];
            }}
          />
          <Legend />
          <Bar yAxisId="cost" dataKey="targetPrice" name="Target Price" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
          <Bar yAxisId="cost" dataKey="shouldCost" name="Should Cost" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
          <Line yAxisId="percent" type="monotone" dataKey="savingsPercent" name="Savings %" stroke="hsl(var(--chart-3))" strokeWidth={3} dot={{ fill: 'hsl(var(--chart-3))', strokeWidth: 2, r: 4 }} />
        </ComposedChart>
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
  const total = statusDistribution.reduce((sum, item) => sum + item.count, 0);
  const dataWithPercentage = statusDistribution.map(item => ({
    ...item,
    percentage: ((item.count / total) * 100).toFixed(1)
  }));

  return (
    <div className="space-y-4">
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={dataWithPercentage}
              cx="50%"
              cy="50%"
              innerRadius={35}
              outerRadius={65}
              paddingAngle={2}
              dataKey="count"
              nameKey="label"
            >
              {dataWithPercentage.map((_, index) => (
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
              formatter={(value: any, name: string) => [`${value} projects`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      
      <div className="space-y-2">
        {dataWithPercentage.map((item, index) => (
          <div key={item.label} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
              />
              <span className="text-muted-foreground">{item.label}</span>
            </div>
            <div className="text-right">
              <span className="font-semibold">{item.count}</span>
              <span className="text-muted-foreground ml-1">({item.percentage}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// New comprehensive analytics charts
export function ProjectTrendChart({ projects }: { projects: any[] }) {
  const last30Days = Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    return date;
  });

  const trendData = last30Days.map(date => {
    const dayProjects = projects.filter(p => {
      const projectDate = new Date(p.createdAt || Date.now());
      return projectDate.toDateString() === date.toDateString();
    });
    
    return {
      date: date.getDate(),
      projects: dayProjects.length,
      value: dayProjects.reduce((sum, p) => sum + (Number(p.targetPrice) || 0), 0),
      savings: dayProjects.reduce((sum, p) => sum + ((Number(p.targetPrice) || 0) - (Number(p.shouldCost) || 0)), 0)
    };
  });

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={trendData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <defs>
            <linearGradient id="colorProjects" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis 
            dataKey="date" 
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis 
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
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
          <Area 
            type="monotone" 
            dataKey="projects" 
            stroke="hsl(var(--chart-1))" 
            fillOpacity={1} 
            fill="url(#colorProjects)"
            name="New Projects"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EfficiencyGaugeChart({ efficiency }: { efficiency: number }) {
  const data = [
    { name: 'Efficiency', value: efficiency },
    { name: 'Remaining', value: 100 - efficiency }
  ];

  return (
    <div className="h-32">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            startAngle={180}
            endAngle={0}
            innerRadius={40}
            outerRadius={60}
            dataKey="value"
          >
            <Cell fill="hsl(var(--chart-1))" />
            <Cell fill="hsl(var(--muted))" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// Manufacturing Analytics Dashboard Charts
export function ManufacturingPerformanceChart({ modules }: { modules: any[] }) {
  const performanceData = modules.map(module => ({
    name: module.title.replace(' Management', '').replace(' & ', ' '),
    active: module.stats.active,
    total: module.stats.total,
    efficiency: ((module.stats.active / module.stats.total) * 100) || 0,
    value: module.stats.value / 100000, // Convert to lakhs
  }));

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={performanceData}
          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis 
            dataKey="name" 
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis 
            yAxisId="count"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis 
            yAxisId="percent"
            orientation="right"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickFormatter={(v) => `${v.toFixed(0)}%`}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
            formatter={(value: any, name: string) => {
              if (name === 'Efficiency') return [`${Number(value).toFixed(1)}%`, name];
              if (name === 'Value') return [`₹${Number(value).toFixed(1)}L`, name];
              return [value, name];
            }}
          />
          <Legend />
          <Bar yAxisId="count" dataKey="active" name="Active" fill="hsl(var(--chart-1))" radius={[2, 2, 0, 0]} />
          <Bar yAxisId="count" dataKey="total" name="Total" fill="hsl(var(--chart-2))" radius={[2, 2, 0, 0]} />
          <Line yAxisId="percent" type="monotone" dataKey="efficiency" name="Efficiency" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={{ fill: 'hsl(var(--chart-3))', strokeWidth: 2, r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CostSavingsChart({ projects }: { projects: any[] }) {
  // Always show chart with available data, even if incomplete
  const savingsData = projects
    .map(p => {
      const targetPrice = Number(p.targetPrice) || 0;
      const shouldCost = Number(p.shouldCost) || 0;
      const savings = targetPrice - shouldCost;
      const savingsPercent = targetPrice > 0 ? ((savings / targetPrice) * 100) : 0;
      
      return {
        name: p.name?.substring(0, 12) || `Project ${p.id?.slice(-4) || Math.random().toString(36).slice(-4)}`,
        targetPrice,
        shouldCost,
        savings,
        savingsPercent,
        hasData: targetPrice > 0 || shouldCost > 0,
        fillColor: savings >= 0 ? 'hsl(var(--chart-3))' : 'hsl(var(--destructive))'
      };
    })
    .filter(p => p.hasData)
    .slice(0, 6);

  // Debug logging for cost savings chart
  if (process.env.NODE_ENV === 'development') {
    console.log('CostSavingsChart - Projects received:', projects?.length || 0);
    console.log('CostSavingsChart - Savings data:', savingsData);
    console.log('CostSavingsChart - Projects sample:', projects?.slice(0, 2));
  }

  // If no projects with cost data, show projects with placeholder data
  if (savingsData.length === 0 && projects.length > 0) {
    const placeholderData = projects.slice(0, 6).map((p, index) => ({
      name: p.name?.substring(0, 12) || `Project ${index + 1}`,
      targetPrice: 0,
      shouldCost: 0,
      savings: 0,
      savingsPercent: 0,
      hasData: false,
      fillColor: 'hsl(var(--muted))'
    }));

    return (
      <div className="h-64 relative">
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/80 backdrop-blur-sm">
          <div className="text-center">
            <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-950/20 flex items-center justify-center mx-auto mb-3">
              <div className="text-xl font-bold text-green-600">₹</div>
            </div>
            <p className="text-sm font-medium">Add cost data to see savings analysis</p>
            <p className="text-xs text-muted-foreground mt-1">Enter target price and should cost in projects</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={placeholderData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis 
              dataKey="name" 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
            />
            <YAxis 
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              tickFormatter={() => '₹0'}
              axisLine={{ stroke: 'hsl(var(--border))' }}
            />
            <Bar dataKey="savings" fill="hsl(var(--muted))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-950/20 flex items-center justify-center mx-auto mb-3">
            <div className="text-xl font-bold text-green-600">₹</div>
          </div>
          <p className="text-sm">No projects available</p>
          <p className="text-xs text-muted-foreground mt-1">Create projects to see cost savings analysis</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={savingsData}
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
            tickFormatter={(v) => {
              const absV = Math.abs(v);
              if (absV >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
              if (absV >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
              return `₹${v.toFixed(0)}`;
            }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
            formatter={(value: any, name: string) => {
              if (name === 'Cost Savings') {
                const numValue = Number(value);
                const sign = numValue >= 0 ? 'Savings' : 'Overspend';
                return [`₹${Math.abs(numValue).toLocaleString('en-IN')} (${sign})`, name];
              }
              return [`₹${Number(value).toLocaleString('en-IN')}`, name];
            }}
            labelFormatter={(label) => `Project: ${label}`}
          />
          <Bar 
            dataKey="savings" 
            name="Cost Savings" 
            fill="hsl(var(--chart-3))"
            radius={[4, 4, 0, 0]}
          >
            {savingsData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fillColor} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}