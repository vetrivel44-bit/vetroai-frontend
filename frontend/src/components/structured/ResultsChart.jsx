import React from 'react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import '../../styles/StructuredResponse.css';

const COLORS = ['#5B8CFF', '#FF6B6B', '#FFD166', '#06D6A0', '#A29BFE', '#FD79A8'];

const ResultsChart = ({ overallScore, topicScores, typeScores, weakAreas, strongestTopic, strongestType, delay = 0 }) => {
  
  // Format data for Recharts
  const topicData = Object.entries(topicScores || {}).map(([name, score]) => ({
    name,
    value: score,
    label: `${name} ${score}/10`
  }));

  const typeData = Object.entries(typeScores || {}).map(([name, score]) => ({
    name,
    value: score,
    label: `${name} ${score}/10`
  }));

  const getScoreColor = (score) => {
    if (score >= 70) return '#06D6A0'; // Green
    if (score >= 50) return '#FFD166'; // Orange
    return '#FF6B6B'; // Red
  };

  const getGenericSuggestions = (area) => {
    const suggestions = {
      'Arrays': ['Practice two-pointer techniques and sliding window problems.', 'Study array manipulation edge cases like empty arrays or single elements.'],
      'Trees': ['Review tree traversal algorithms (BFS, DFS).', 'Practice identifying tree properties (height, balance).'],
      'Dynamic Programming': ['Study memoization and tabulation patterns.', 'Practice breaking problems into smaller subproblems.'],
      'Coding': ['Focus on time and space complexity optimizations.', 'Practice writing clean, readable code with good naming conventions.'],
      'MCQ': ['Review core computer science concepts.', 'Practice predicting output of code snippets.'],
      'Output Prediction': ['Trace code execution step-by-step.', 'Pay attention to loop bounds and edge conditions.'],
      'Conceptual': ['Study data structure use cases and trade-offs.', 'Practice explaining concepts out loud.']
    };
    return suggestions[area] || ['Practice more problems in this category.', 'Review core concepts and patterns.'];
  };

  return (
    <motion.div 
      className="structured-diagram"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, delay }}
      style={{ background: 'var(--surface-2)', padding: '24px', borderRadius: '16px', border: '1px solid var(--border)', marginTop: '16px', color: 'var(--ink)' }}
    >
      {/* Header */}
      <h2 style={{ fontSize: '1.2rem', fontWeight: '500', marginBottom: '24px', textAlign: 'center' }}>
        Your Interview Results
      </h2>

      {/* Overall Score */}
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{ fontSize: '3rem', fontWeight: '700', color: getScoreColor(overallScore) }}>
          {overallScore}%
        </div>
        <div style={{ fontSize: '0.9rem', color: 'var(--ink-3)' }}>
          Overall Score
        </div>
      </div>

      {/* Charts Row */}
      <div style={{ display: 'flex', gap: '24px', marginBottom: '32px', flexWrap: 'wrap' }}>
        {/* Topic Chart */}
        <div style={{ flex: '1', minWidth: '250px', background: 'var(--surface-1)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: '600', marginBottom: '16px', textAlign: 'center' }}>Score by Topic</h3>
          <div style={{ height: '200px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={topicData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  fill="#8884d8"
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, value }) => `${name} ${value}/10`}
                  labelLine={false}
                  style={{ fontSize: '10px', fontFamily: 'sans-serif' }}
                >
                  {topicData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Type Chart */}
        <div style={{ flex: '1', minWidth: '250px', background: 'var(--surface-1)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: '600', marginBottom: '16px', textAlign: 'center' }}>Score by Question Type</h3>
          <div style={{ height: '200px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={typeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  fill="#8884d8"
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, value }) => `${name} ${value}/10`}
                  labelLine={false}
                  style={{ fontSize: '10px', fontFamily: 'sans-serif' }}
                >
                  {typeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Weak Areas Section */}
      {weakAreas && weakAreas.length > 0 ? (
        <div style={{ marginBottom: '32px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '16px' }}>Areas to Improve 🔴</h3>
          {weakAreas.map((area, idx) => (
            <div key={idx} style={{ marginBottom: '16px' }}>
              <div style={{ fontWeight: '600', fontSize: '0.9rem', marginBottom: '4px' }}>{area}</div>
              <ul style={{ paddingLeft: '20px', fontSize: '0.85rem', color: 'var(--ink-3)' }}>
                {getGenericSuggestions(area).map((suggestion, sIdx) => (
                  <li key={sIdx} style={{ marginBottom: '4px' }}>{suggestion}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        /* Congratulations Section */
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#06D6A0', marginBottom: '8px' }}>Excellent work! 🏆</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--ink-3)' }}>
            You showed strong performance in <strong>{strongestTopic}</strong> and <strong>{strongestType}</strong>.
          </p>
          <p style={{ fontSize: '0.9rem', color: 'var(--ink-3)', marginTop: '4px' }}>
            Try tackling advanced problems next to level up further!
          </p>
        </div>
      )}

      {/* Score Table */}
      <div>
        <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '16px' }}>Detailed Breakdown</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600' }}>Topic</th>
              <th style={{ textAlign: 'center', padding: '8px', fontWeight: '600' }}>Score</th>
              <th style={{ textAlign: 'center', padding: '8px', fontWeight: '600' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(topicScores || {}).map(([topic, score], idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px' }}>{topic}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>{score}/10</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>
                  {score >= 7 ? '✅' : '🔴'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
};

export default ResultsChart;
