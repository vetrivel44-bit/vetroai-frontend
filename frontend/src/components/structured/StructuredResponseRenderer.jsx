import HeroSummary from './HeroSummary';
import HighlightAlert from './HighlightAlert';
import ComparisonCards from './ComparisonCards';
import ComparisonTable from './ComparisonTable';
import MetricCards from './MetricCards';
import StepTimeline from './StepTimeline';
import CollapsibleDetails from './CollapsibleDetails';
import ArchitectureDiagram from './ArchitectureDiagram';
import StructuredSection from './StructuredSection';
import ImageGallery from './ImageGallery';
import OnboardingCard from './OnboardingCard';
import { Copy, FileDown, Check } from 'lucide-react';
import React, { useState, useMemo, Suspense } from 'react';
import { motion } from 'framer-motion';
import '../../styles/StructuredResponse.css';

// The four heavyweights. Between them these pull in recharts, chart.js,
// apexcharts, echarts, the MapTiler SDK and four CodeMirror language modes —
// several megabytes that most answers never touch. Loading them on demand keeps
// them out of the bundle every visitor downloads before the first chat appears;
// an answer that does contain a chart or a map fetches its chunk as it renders.
const LocationMap = React.lazy(() => import('./LocationMap'));
const DataChart = React.lazy(() => import('./DataChart'));
const InteractiveEditor = React.lazy(() => import('./InteractiveEditor'));
const ResultsChart = React.lazy(() => import('./ResultsChart'));

// Keeps the section's height from collapsing while its chunk arrives.
const BlockLoader = () => (
  <div className="structured-block-loading" style={{ minHeight: 120 }} />
);

const INTERACTIVE_BLOCK_TYPES = new Set(['onboarding', 'editor', 'results', 'mcq']);

// Hoisted so the engine compiles it once instead of on every candidate brace of
// every answer. It has no /g flag, so it carries no lastIndex state to leak
// between calls.
const STRUCTURED_TYPE_HINT_RE = /(onboarding|editor|results|location|route|gallery|chart|timeline|comparison_table|comparison|metrics|architecture|collapsible|mcq)/;

const extractKnownJsonBlocks = (text) => {
  const result = { sections: [], remaining: text };
  const regex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  // Each consumed block used to be cut with `cleaned.replace(match[0], '')`,
  // which rescans the whole answer from the start for every block — quadratic
  // in the length of a long reply, and it re-runs on every streamed token.
  // Record the spans instead and splice them out in one pass. Cutting at the
  // match's own index is also what was always meant: `replace` removes the
  // *first* identical substring, which is the wrong one when an earlier block
  // with the same text failed to parse and was deliberately left in place.
  const cuts = [];

  while ((match = regex.exec(text)) !== null) {
    try {
      const rawContent = match[1].trim();
      const cleanedContent = rawContent.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
      const parsed = JSON.parse(cleanedContent);
      if (INTERACTIVE_BLOCK_TYPES.has(parsed.type)) {
        result.sections.push({
          type: parsed.type,
          ...parsed,
          delay: 0.3
        });
        cuts.push([match.index, match.index + match[0].length]);
      }
    } catch (e) {}
  }

  result.remaining = spliceOut(text, cuts).trim();
  return result;
};

// Remove a set of non-overlapping [start, end) spans, given in ascending order,
// in a single left-to-right pass.
const spliceOut = (text, cuts) => {
  if (cuts.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const [start, end] of cuts) {
    if (start > cursor) out += text.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  return out + text.slice(cursor);
};

// Parse the response to determine structure
const parseResponse = (text) => {
  if (!text) return [];
  const sections = [];

  // MUST BE FIRST — extract known JSON blocks before anything else
  const { sections: jsonSections, remaining } = extractKnownJsonBlocks(text);
  sections.push(...jsonSections);
  let remainingText = remaining;

  // 1. Extract JSON blocks (Highest Priority)
  const blocks = [];
  
  // Find backtick blocks
  const backtickRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let bMatch;
  while ((bMatch = backtickRegex.exec(remainingText)) !== null) {
    blocks.push({
      raw: bMatch[0],
      content: bMatch[1],
      index: bMatch.index
    });
  }

  // Find raw JSON blocks (bracket matching).
  //
  // Two things here used to run once per `{` in the answer, which on a reply
  // full of code or JSON is a lot: a linear scan of every fenced block to test
  // containment, and a fresh 300-character substring allocated just to be
  // regex-tested. The fenced blocks found above are already in ascending
  // order, so containment is a forward-moving cursor over them, and the
  // look-ahead probe can read the window in place.
  // The fenced matches, frozen before raw blocks start being appended below,
  // so the cursor only ever walks an ascending, immutable list.
  const fenceBlocks = blocks.slice();
  let bIndex = 0;
  let fenceCursor = 0;
  while (bIndex < remainingText.length) {
    const start = remainingText.indexOf('{', bIndex);
    if (start === -1) break;

    // Skip if this start is inside a known backtick block. The regex found
    // them left to right, so advancing past every block that ends before
    // `start` never needs a rescan.
    while (fenceCursor < fenceBlocks.length && fenceBlocks[fenceCursor].index + fenceBlocks[fenceCursor].raw.length <= start) {
      fenceCursor++;
    }
    const fence = fenceBlocks[fenceCursor];
    if (fence && start >= fence.index) {
      // Jump straight past the whole fenced block rather than stepping one
      // character at a time through everything inside it.
      bIndex = fence.index + fence.raw.length;
      continue;
    }

    // Check if it looks like our structured JSON
    const windowEnd = Math.min(start + 300, remainingText.length);
    const typeAt = remainingText.indexOf('"type"', start);
    if (typeAt === -1 || typeAt + 6 > windowEnd || !STRUCTURED_TYPE_HINT_RE.test(remainingText.slice(start, windowEnd))) {
      bIndex = start + 1;
      continue;
    }

    // Bracket matching
    let bracketCount = 1;
    let end = start + 1;
    let inString = false;
    let escape = false;

    while (end < remainingText.length && bracketCount > 0) {
      const char = remainingText[end];
      if (char === '"' && !escape) inString = !inString;
      else if (!inString) {
        if (char === '{') bracketCount++;
        else if (char === '}') bracketCount--;
      }
      if (char === '\\' && !escape) escape = true;
      else escape = false;
      end++;
    }

    if (bracketCount === 0) {
      const raw = remainingText.slice(start, end);
      blocks.push({
        raw,
        content: raw,
        index: start
      });
      bIndex = end;
    } else {
      bIndex = start + 1;
    }
  }

  // Sort blocks by index
  blocks.sort((a, b) => a.index - b.index);

  // Process blocks and remove from remainingText
  for (const block of blocks) {
    try {
      const rawContent = block.content.trim();
      const cleanedContent = rawContent
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*\]/g, ']');
      const data = JSON.parse(cleanedContent);
      if (data.type === 'location' || data.type === 'route') {
        sections.push({ 
          place: data.place || data.destination, 
          summary: data.summary, 
          coordinates: data.coordinates, 
          points: data.points, 
          details: data.details,
          origin: data.origin,
          destination: data.destination,
          waypoints: data.waypoints,
          routeData: data.routeData,
          type: data.type === 'route' ? 'route' : 'location',
          delay: 0.4 
        });
      } else if (data.type === 'visual_gallery') {
        sections.push({ type: 'gallery', query: data.query, images: data.images, delay: 0.5 });
      } else if (data.type === 'chart') {
        sections.push({ type: 'chart', chartType: data.chartType || 'bar', library: data.library || 'recharts', title: data.title, data: data.data, delay: 0.5 });
      } else if (data.type === 'timeline') {
        sections.push({ type: 'timeline', title: data.title, steps: data.steps, delay: 0.5 });
      } else if (data.type === 'comparison_table') {
        sections.push({ type: 'comparison_table', title: data.title, options: data.options, features: data.features, delay: 0.5 });
      } else if (data.type === 'comparison') {
        sections.push({ type: 'comparison', left: data.left, right: data.right, delay: 0.5 });
      } else if (data.type === 'metrics') {
        sections.push({ type: 'metrics', metrics: data.metrics, delay: 0.5 });
      } else if (data.type === 'architecture') {
        sections.push({ type: 'architecture', title: data.title, nodes: data.nodes, connections: data.connections, delay: 0.5 });
      } else if (data.type === 'collapsible') {
        sections.push({ type: 'collapsible', title: data.title, content: data.content, icon: data.icon, delay: 0.5 });
      } else if (data.type === 'editor') {
        sections.push({ type: 'editor', language: data.language, questionNumber: data.questionNumber, totalQuestions: data.totalQuestions, signature: data.signature, delay: 0.5 });
      } else if (data.type === 'results') {
        sections.push({ type: 'results', overallScore: data.overallScore, topicScores: data.topicScores, typeScores: data.typeScores, weakAreas: data.weakAreas, strongestTopic: data.strongestTopic, strongestType: data.strongestType, delay: 0.5 });
      } else if (data.type === 'onboarding') {
        sections.push({ type: 'onboarding', step: data.step, question: data.question, options: data.options, delay: 0.5 });
      } else if (data.type === 'mcq') {
        sections.push({ type: 'mcq', question: data.question, options: data.options, delay: 0.5 });
      }
      // Remove from remainingText
      remainingText = remainingText.replace(block.raw, '').trim();
    } catch (e) {
      // Ignore invalid JSON
    }
  }

  // 2. Extract Hero Summary
  const heroMatch = remainingText.match(/^# (.+)\n\n(.+?)(?:\n\n|$)/s);
  if (heroMatch) {
    sections.push({
      type: 'hero',
      title: heroMatch[1],
      tagline: heroMatch[2],
      badge: 'Analysis',
      delay: 0.1
    });
    remainingText = remainingText.replace(heroMatch[0], '').trim();
  }

  // 3. Global Location Detection - DISABLED.
  // Maps only render when AI explicitly outputs a JSON block with type='location'.

  // 4. Extract Alert Boxes
  const alertRegex = /> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n> (.+)|(\u26a0\ufe0f|\u2705|\u274c|\u2139\ufe0f) (.+)/gi;
  let alertMatch;
  while ((alertMatch = alertRegex.exec(remainingText)) !== null) {
    let type = 'info';
    let content = '';
    if (alertMatch[1]) {
      type = alertMatch[1].toLowerCase();
      if (type === 'note') type = 'info';
      if (type === 'caution') type = 'danger';
      if (type === 'tip') type = 'success';
      content = alertMatch[2];
    } else {
      const emoji = alertMatch[3];
      content = alertMatch[4];
      if (emoji === '\u26a0\ufe0f') type = 'warning';
      else if (emoji === '\u2705') type = 'success';
      else if (emoji === '\u274c') type = 'danger';
    }
    sections.push({ type: 'alert', alertType: type, content, delay: 0.2 + (sections.length * 0.1) });
  }
  remainingText = remainingText.replace(alertRegex, '').trim();

  // 5. Section detection for comparison/metrics/timeline — DISABLED for auto-detection.
  // These components now ONLY render when the AI explicitly outputs structured JSON blocks.
  // Auto-detecting section headers caused e.g. "## Key Features" to become cards on every answer.

  // 6. Remaining text renders as clean markdown.
  if (remainingText.length > 0) {
    sections.push({
      type: 'section',
      content: remainingText,
      delay: 0.1
    });
  }
  return sections;
};

// Parsing an answer walks it several times over, and the chat feed re-renders
// the message that is still streaming on every token — so the same prefix gets
// re-parsed once per token. Hand back the previous result whenever the exact
// text comes round again (a re-render that did not change the answer, the same
// answer shown in two places). Bounded, because a long chat would otherwise pin
// every answer it has ever rendered in memory.
const EMPTY_SECTIONS = [];
const PARSE_CACHE_LIMIT = 32;
const parseCache = new Map();

const parseResponseCached = (text) => {
  if (!text) return EMPTY_SECTIONS;
  const hit = parseCache.get(text);
  if (hit) {
    // Refresh recency so the entries in active use are the ones that survive.
    parseCache.delete(text);
    parseCache.set(text, hit);
    return hit;
  }
  const sections = parseResponse(text);
  parseCache.set(text, sections);
  if (parseCache.size > PARSE_CACHE_LIMIT) {
    parseCache.delete(parseCache.keys().next().value);
  }
  return sections;
};

// Hoisted out of the component: rebuilding these object literals on every render
// handed framer-motion fresh `variants` each time, which is enough on its own to
// make it re-evaluate every animated block in a streaming answer.
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.2
    }
  }
};

const blockVariants = {
  hidden: {
    opacity: 0,
    y: 20,
    filter: 'blur(10px)',
    scale: 0.98
  },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    scale: 1,
    transition: {
      duration: 0.8,
      ease: [0.23, 1, 0.32, 1]
    }
  }
};

const StructuredResponseRenderer = ({ response, onSubmitCode }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    window.print();
  };


  const renderSection = (section, index) => {
    let component = null;
    const commonProps = { delay: section.delay };

    switch (section.type) {
      case 'hero':
        component = <HeroSummary key={`hero-${index}`} {...commonProps} title={section.title} tagline={section.tagline} badge={section.badge} />;
        break;
      case 'alert':
        component = <HighlightAlert key={`alert-${index}`} {...commonProps} type={section.alertType}>{section.content}</HighlightAlert>;
        break;
      case 'comparison':
        component = <ComparisonCards key={`comp-${index}`} {...commonProps} left={section.left} right={section.right} />;
        break;
      case 'metrics':
        component = <MetricCards key={`met-${index}`} {...commonProps} metrics={section.metrics} />;
        break;
      case 'comparison_table':
        component = <ComparisonTable key={`table-${index}`} {...commonProps} title={section.title} options={section.options} features={section.features} />;
        break;
      case 'timeline':
        component = <StepTimeline key={`time-${index}`} {...commonProps} title={section.title} steps={section.steps} />;
        break;
      case 'architecture':
        component = <ArchitectureDiagram key={`arch-${index}`} {...commonProps} title={section.title} nodes={section.nodes} connections={section.connections} />;
        break;
      case 'location':
      case 'route':
        component = (
          <LocationMap 
            key={`map-${index}`}
            type={section.type}
            place={section.place} 
            summary={section.summary} 
            coordinates={section.coordinates} 
            points={section.points}
            origin={section.origin}
            destination={section.destination}
            waypoints={section.waypoints}
            details={section.details} 
            delay={section.delay}
          />
        );
        break;
      case 'gallery':
        component = <ImageGallery key={`gal-${index}`} {...commonProps} query={section.query} images={section.images} />;
        break;
      case 'chart':
        component = <DataChart key={`chart-${index}`} {...commonProps} title={section.title} data={section.data} chartType={section.chartType} library={section.library} />;
        break;
      case 'editor':
        component = <InteractiveEditor key={`edit-${index}`} {...commonProps} language={section.language} signature={section.signature} questionNumber={section.questionNumber} totalQuestions={section.totalQuestions} onSubmit={onSubmitCode} />;
        break;
      case 'results':
        component = <ResultsChart key={`res-${index}`} {...commonProps} overallScore={section.overallScore} topicScores={section.topicScores} typeScores={section.typeScores} weakAreas={section.weakAreas} strongestTopic={section.strongestTopic} strongestType={section.strongestType} />;
        break;
      case 'mcq':
      case 'onboarding':
        component = <OnboardingCard key={`onb-${index}`} {...commonProps} step={section.step} question={section.question} options={section.options} onSelect={onSubmitCode} totalSteps={4} />;
        break;
      case 'collapsible':
        component = <CollapsibleDetails key={`coll-${index}`} {...commonProps} title={section.title} content={section.content} icon={section.icon} />;
        break;
      case 'section':
        component = <StructuredSection key={`sec-${index}`} {...commonProps} title={section.title} content={section.content} />;
        break;
      default:
        return null;
    }

    return (
      <motion.div 
        key={`wrap-${index}`}
        className="structured-block"
        variants={blockVariants}
      >
        <Suspense fallback={<BlockLoader />}>{component}</Suspense>
      </motion.div>
    );
  };

  const sections = useMemo(() => parseResponseCached(response), [response]);

  if (!response) return null;

  return (
    <div className="structured-response-container">
      <motion.div 
        className="structured-response"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {sections.map((section, index) => renderSection(section, index))}
        
      </motion.div>
    </div>
  );
};

// Memoized: the chat feed re-renders on every streamed token, and re-running
// this on a message whose text has not changed means re-parsing the whole answer
// and rebuilding every chart, map and editor under it.
export default React.memo(StructuredResponseRenderer);
