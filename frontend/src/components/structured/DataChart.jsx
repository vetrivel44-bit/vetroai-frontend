import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, ZAxis,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend as RechartsLegend, ResponsiveContainer,
  Cell, Brush
} from 'recharts';
import { Chart as ChartJS, RadialLinearScale, PointElement, LineElement, Filler, Tooltip as ChartTooltip, Legend as ChartLegend } from 'chart.js';
import { Radar as ChartJSRadar } from 'react-chartjs-2';
import ReactApexChart from 'react-apexcharts';
import ReactECharts from 'echarts-for-react';
import { normalizeDataset, inferChartType, getColorPalette } from '../../utils/dataNormalizer';
import '../../styles/StructuredResponse.css';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, ChartTooltip, ChartLegend);

const DataChart = ({ title, data, chartType, library = 'recharts', delay = 0 }) => {
  if (!data || data.length === 0) return null;

  // 1. DATA PIPELINE & INTEGRITY VALIDATION
  const processedData = useMemo(() => {
    const mappedData = normalizeDataset(data);
    
    // Fallback: If dataset is empty after validation
    if (mappedData.length === 0) return [];

    // Auto-grouping for Pie/Donut to prevent crowded tiny slices
    if ((chartType === 'pie' || chartType === 'donut') && mappedData.length > 10) {
      const sorted = [...mappedData].sort((a, b) => b.value - a.value);
      const top = sorted.slice(0, 7);
      const others = sorted.slice(7);
      const othersValue = others.reduce((acc, curr) => acc + curr.value, 0);
      
      return [...top, { label: 'Others', value: othersValue, isOthers: true }];
    }
    
    return mappedData;
  }, [data, chartType]);

  if (processedData.length === 0) {
    return (
      <div style={{ padding: '20px', color: 'var(--ink-3)', textAlign: 'center', background: 'var(--surface-2)', borderRadius: '8px' }}>
        ⚠️ Invalid or empty dataset. Unable to render chart.
      </div>
    );
  }

  const count = processedData.length;
  const isLargeDataset = count > 15;
  const hasLongLabels = processedData.some(d => d.label.length > 12);

  // 2. ADAPTIVE CHART LAYOUT ENGINE
  const effectiveChartType = useMemo(() => {
    return inferChartType(processedData, chartType);
  }, [chartType, processedData]);

  // 3. THEME & COLORS (Premium Palette)
  const colors = [
    '#6366F1', '#10B981', '#F59E0B', '#EF4444', 
    '#8B5CF6', '#EC4899', '#3B82F6', '#14B8A6'
  ];

  const darkTheme = {
    textColor: 'var(--structured-text-primary)',
    textColorSecondary: 'var(--structured-text-muted)',
    borderColor: 'var(--structured-border)',
    tooltipBg: 'var(--structured-card)',
    tooltipBorder: 'var(--structured-border)',
    gridColor: 'var(--structured-border)',
  };

  // 4. INTELLIGENT LABEL MANAGEMENT (Auto-abbreviate)
  const getXAxisProps = () => ({
    dataKey: "label",
    stroke: darkTheme.textColorSecondary,
    tick: { fill: darkTheme.textColorSecondary, fontSize: 11 },
    // Truncate labels on axis to prevent overlap, full name shown in tooltip
    tickFormatter: (value) => (typeof value === 'string' && value.length > 12) ? `${value.slice(0, 10)}..` : value,
    angle: hasLongLabels || count > 5 ? -45 : 0,
    textAnchor: hasLongLabels || count > 5 ? 'end' : 'middle',
    minTickGap: 30, // Collision detection
  });

  // Custom Tooltip for professional interactions
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          background: darkTheme.tooltipBg,
          border: `1px solid ${darkTheme.tooltipBorder}`,
          padding: '12px',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(10px)',
          zIndex: 1000
        }}>
          <p style={{ color: darkTheme.textColor, fontWeight: '700', marginBottom: '4px' }}>{label}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color || 'var(--accent)', fontSize: '13px' }}>
              {entry.name}: <span style={{ fontWeight: '700' }}>{entry.value}</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Render Functions
  const renderChart = () => {
    if (library === 'apexcharts') {
      const type = ['bar', 'line', 'area', 'pie', 'donut', 'radar'].includes(effectiveChartType) ? effectiveChartType : 'bar';
      const options = {
        chart: { 
          id: 'apex-chart', 
          toolbar: { show: false },
          background: 'transparent',
          foreColor: darkTheme.textColorSecondary
        },
        xaxis: { 
          categories: processedData.map(d => d.label),
          labels: { style: { colors: darkTheme.textColorSecondary, fontSize: '11px' } }
        },
        yaxis: {
          labels: { style: { colors: darkTheme.textColorSecondary, fontSize: '11px' } }
        },
        colors: colors,
        stroke: { curve: 'smooth', width: 2 },
        fill: { opacity: type === 'area' ? 0.3 : 1 },
        tooltip: { theme: 'dark' },
        legend: { labels: { colors: darkTheme.textColor } },
        dataLabels: { enabled: false }
      };
      
      const isPie = ['pie', 'donut'].includes(type);
      const series = isPie 
        ? processedData.map(d => d.value)
        : [{ name: 'Value', data: processedData.map(d => d.value) }];
        
      if (isPie) {
        options.labels = processedData.map(d => d.label);
      }

      return (
        <div style={{ height: 350 }}>
          <ReactApexChart options={options} series={series} type={type} height={350} />
        </div>
      );
    }

    if (library === 'echarts') {
      const type = effectiveChartType === 'bar' ? 'bar' : 'line';
      const option = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: darkTheme.tooltipBg, borderColor: darkTheme.tooltipBorder, textStyle: { color: darkTheme.textColor } },
        xAxis: { 
          type: 'category', 
          data: processedData.map(d => d.label),
          axisLabel: { color: darkTheme.textColorSecondary, fontSize: 11 },
          axisLine: { lineStyle: { color: darkTheme.borderColor } }
        },
        yAxis: { 
          type: 'value',
          axisLabel: { color: darkTheme.textColorSecondary, fontSize: 11 },
          splitLine: { lineStyle: { color: darkTheme.gridColor } }
        },
        series: [{ 
          data: processedData.map(d => d.value), 
          type: type,
          smooth: true,
          itemStyle: { color: colors[0] },
          areaStyle: effectiveChartType === 'area' ? { opacity: 0.3 } : undefined
        }],
        textStyle: { color: darkTheme.textColorSecondary, fontFamily: 'var(--font)' }
      };
      return (
        <div style={{ height: 350 }}>
          <ReactECharts option={option} style={{ height: 350 }} />
        </div>
      );
    }

    switch (effectiveChartType) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={processedData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={darkTheme.gridColor} />
              <XAxis {...getXAxisProps()} />
              <YAxis stroke={darkTheme.textColorSecondary} tick={{ fill: darkTheme.textColorSecondary, fontSize: 11 }} />
              <RechartsTooltip content={<CustomTooltip />} />
              <RechartsLegend />
              <Line type="monotone" dataKey="value" name="Value" stroke="var(--accent)" strokeWidth={3} dot={{ r: 4, fill: 'var(--accent)' }} activeDot={{ r: 6 }} />
              {(isLargeDataset || count > 10) && (
                <Brush 
                  dataKey="label" 
                  height={20} 
                  stroke="var(--accent)" 
                  fill="var(--surface-2)"
                  tick={{ fill: 'var(--ink-3)', fontSize: 10 }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        );
        
      case 'area':
        return (
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={processedData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={darkTheme.gridColor} />
              <XAxis {...getXAxisProps()} />
              <YAxis stroke={darkTheme.textColorSecondary} tick={{ fill: darkTheme.textColorSecondary, fontSize: 11 }} />
              <RechartsTooltip content={<CustomTooltip />} />
              <RechartsLegend />
              <Area type="monotone" dataKey="value" name="Value" stroke="#6366F1" fill="#6366F1" fillOpacity={0.2} />
              {(isLargeDataset || count > 10) && (
                <Brush 
                  dataKey="label" 
                  height={20} 
                  stroke="var(--accent)" 
                  fill="var(--surface-2)"
                  tick={{ fill: 'var(--ink-3)', fontSize: 10 }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'pie':
      case 'donut':
        return (
          <ResponsiveContainer width="100%" height={350}>
            <PieChart>
              <Pie
                data={processedData}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={100}
                innerRadius={effectiveChartType === 'donut' ? 60 : 0}
                fill="#8884d8"
                label={({ label, percent }) => `${label.length > 10 ? label.slice(0, 8) + '..' : label} (${(percent * 100).toFixed(0)}%)`}
                labelLine={true}
              >
                {processedData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <RechartsTooltip content={<CustomTooltip />} />
              <RechartsLegend />
            </PieChart>
          </ResponsiveContainer>
        );

      case 'radar':
        if (library === 'chartjs') {
          const chartData = {
            labels: processedData.map(d => d.label),
            datasets: [
              {
                label: 'Value',
                data: processedData.map(d => d.value),
                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                borderColor: 'rgba(99, 102, 241, 1)',
                borderWidth: 2,
                pointBackgroundColor: 'rgba(99, 102, 241, 1)',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgba(99, 102, 241, 1)'
              }
            ]
          };
          const options = {
            scales: {
              r: {
                angleLines: { color: darkTheme.gridColor },
                grid: { color: darkTheme.gridColor },
                pointLabels: { color: darkTheme.textColorSecondary, font: { size: 11 } },
                ticks: { backdropColor: 'transparent', color: darkTheme.textColorSecondary, font: { size: 11 } }
              }
            },
            plugins: {
              legend: { labels: { color: darkTheme.textColor } },
              tooltip: { backgroundColor: darkTheme.tooltipBg, titleColor: darkTheme.textColor, bodyColor: darkTheme.textColor }
            },
            maintainAspectRatio: false
          };
          return (
            <div style={{ height: 350 }}>
              <ChartJSRadar data={chartData} options={options} />
            </div>
          );
        }
        return (
          <ResponsiveContainer width="100%" height={350}>
            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={processedData}>
              <PolarGrid stroke={darkTheme.gridColor} />
              <PolarAngleAxis dataKey="label" tick={{ fill: darkTheme.textColorSecondary, fontSize: 11 }} />
              <PolarRadiusAxis stroke={darkTheme.textColorSecondary} tick={{ fill: darkTheme.textColorSecondary, fontSize: 11 }} />
              <Radar name="Value" dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.6} />
              <RechartsTooltip content={<CustomTooltip />} />
              <RechartsLegend />
            </RadarChart>
          </ResponsiveContainer>
        );

      case 'scatter':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={darkTheme.gridColor} />
              <XAxis 
                type="category" 
                dataKey="label" 
                name="Category" 
                stroke={darkTheme.textColorSecondary} 
                tick={{ fill: darkTheme.textColorSecondary, fontSize: 11 }}
              />
              <YAxis 
                type="number" 
                dataKey="value" 
                name="Value" 
                stroke={darkTheme.textColorSecondary} 
                tick={{ fill: darkTheme.textColorSecondary, fontSize: 11 }}
              />
              <ZAxis type="number" range={[64, 400]} />
              <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} content={<CustomTooltip />} />
              <RechartsLegend />
              <Scatter name="Data Points" data={processedData} fill="var(--accent)" />
            </ScatterChart>
          </ResponsiveContainer>
        );

      case 'horizontal-bar':
        return (
          <ResponsiveContainer width="100%" height={Math.max(350, processedData.length * 35)}>
            <BarChart data={processedData} layout="vertical" margin={{ top: 20, right: 30, left: 120, bottom: 20 }}>
              <defs>
                <linearGradient id="barGradientHoriz" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={1}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={darkTheme.gridColor} />
              <XAxis type="number" stroke={darkTheme.textColorSecondary} tick={{ fill: darkTheme.textColorSecondary, fontSize: 11 }} />
              <YAxis dataKey="label" type="category" stroke={darkTheme.textColorSecondary} tick={{ fill: darkTheme.textColorSecondary, fontSize: 11 }} width={110} tickFormatter={(value) => value.length > 15 ? `${value.slice(0, 12)}..` : value} />
              <RechartsTooltip content={<CustomTooltip />} />
              <RechartsLegend />
              <Bar dataKey="value" name="Value" fill="url(#barGradientHoriz)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        );

      case 'bar':
      default:
        return (
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={processedData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={1}/>
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.7}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={darkTheme.gridColor} />
              <XAxis {...getXAxisProps()} />
              <YAxis stroke={darkTheme.textColorSecondary} tick={{ fill: darkTheme.textColorSecondary, fontSize: 11 }} />
              <RechartsTooltip content={<CustomTooltip />} />
              <RechartsLegend />
              <Bar dataKey="value" name="Value" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
              {(isLargeDataset || count > 10) && (
                <Brush 
                  dataKey="label" 
                  height={20} 
                  stroke="var(--accent)" 
                  fill="var(--surface-2)"
                  tick={{ fill: 'var(--ink-3)', fontSize: 10 }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  return (
    <motion.div 
      className="structured-diagram"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, delay }}
      style={{ 
        background: 'var(--surface-2)', 
        padding: '24px', 
        borderRadius: '16px', 
        border: '1px solid var(--border)', 
        marginTop: '16px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        backdropFilter: 'blur(10px)',
        overflow: 'hidden'
      }}
    >
      {title && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '10px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--ink)' }}>{title}</h2>
          <span style={{ fontSize: '11px', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '1px', background: 'var(--surface-3)', padding: '4px 8px', borderRadius: '4px' }}>
            {effectiveChartType}
          </span>
        </div>
      )}
      <div className="structured-diagram-content">
        {renderChart()}
      </div>
    </motion.div>
  );
};

export default DataChart;
