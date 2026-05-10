import HeroSummary from './HeroSummary';
import HighlightAlert from './HighlightAlert';
import ComparisonCards from './ComparisonCards';
import MetricCards from './MetricCards';
import StepTimeline from './StepTimeline';
import CollapsibleDetails from './CollapsibleDetails';
import ArchitectureDiagram from './ArchitectureDiagram';
import StructuredSection from './StructuredSection';
import LocationMap from './LocationMap';
import ImageGallery from './ImageGallery';
import DataChart from './DataChart';
import InteractiveEditor from './InteractiveEditor';
import ResultsChart from './ResultsChart';
import OnboardingCard from './OnboardingCard';
import { Copy, FileDown, Check } from 'lucide-react';
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import '../../styles/StructuredResponse.css';

const extractKnownJsonBlocks = (text) => {
  const result = { sections: [], remaining: text };
  const regex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  let cleaned = text;

  while ((match = regex.exec(text)) !== null) {
    try {
      const rawContent = match[1].trim();
      const cleanedContent = rawContent.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
      const parsed = JSON.parse(cleanedContent);
      if (['onboarding', 'editor', 'results', 'mcq'].includes(parsed.type)) {
        result.sections.push({
          type: parsed.type,
          ...parsed,
          delay: 0.3
        });
        cleaned = cleaned.replace(match[0], '');
      }
    } catch (e) {}
  }

  result.remaining = cleaned.trim();
  return result;
};

const StructuredResponseRenderer = ({ response, onSubmitCode }) => {
  const [copied, setCopied] = useState(false);
  if (!response) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    window.print();
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
    while ((bMatch = backtickRegex.exec(text)) !== null) {
      blocks.push({
        raw: bMatch[0],
        content: bMatch[1],
        index: bMatch.index
      });
    }

    // Find raw JSON blocks (bracket matching)
    let bIndex = 0;
    while (bIndex < text.length) {
      const start = text.indexOf('{', bIndex);
      if (start === -1) break;

      // Skip if this start is inside a known backtick block
      const isInside = blocks.some(b => start >= b.index && start < b.index + b.raw.length);
      if (isInside) {
        bIndex = start + 1;
        continue;
      }

      // Check if it looks like our structured JSON
      const sub = text.slice(start, start + 300);
      if (!sub.includes('"type"') || !/(onboarding|editor|results|location|gallery|chart)/.test(sub)) {
        bIndex = start + 1;
        continue;
      }

      // Bracket matching
      let bracketCount = 1;
      let end = start + 1;
      let inString = false;
      let escape = false;

      while (end < text.length && bracketCount > 0) {
        const char = text[end];
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
        const raw = text.slice(start, end);
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
          .replace(/\/\/.*$/gm, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*\]/g, ']');
        const data = JSON.parse(cleanedContent);
        if (data.type === 'location') {
          sections.push({ type: 'location', place: data.place, summary: data.summary, coordinates: data.coordinates, details: data.details, delay: 0.4 });
        } else if (data.type === 'visual_gallery') {
          sections.push({ type: 'gallery', query: data.query, images: data.images, delay: 0.5 });
        } else if (data.type === 'chart') {
          sections.push({ type: 'chart', chartType: data.chartType || 'bar', library: data.library || 'recharts', title: data.title, data: data.data, delay: 0.5 });
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

    // 3. Global Location Detection (Fallback if no JSON location)
    if (!sections.some(s => s.type === 'location')) {
      // Catch "[Place] is a [city/town/etc]" or "institution called [Place] located in"
      // Handles optional markdown like **Name** or _Name_
      const locRegex = /(?:^|\n|#|called|regarding)\s*[*_]*([A-Z][A-Za-z0-9&'’\.\-\s,]+?)[*_]*\s*(?:is a (?:city|town|village|district|place|region|state|country|school|institution|hospital|hotel|mall|restaurant|park|temple|monument|landmark|beach)|is (?:located|situated|found) in|also known as|Here is the address:|Location:)/i;
      const locMatch = remainingText.match(locRegex);
      
      if (locMatch) {
        sections.push({
          type: 'location',
          place: locMatch[1].trim(),
          summary: `Exploring ${locMatch[1]}...`,
          coordinates: null,
          details: [],
          delay: 0.3
        });
      }
    }

    // 4. Extract Alert Boxes
    const alertRegex = /> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n> (.+)|(⚠️|✅|❌|ℹ️) (.+)/gi;
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
        if (emoji === '⚠️') type = 'warning';
        else if (emoji === '✅') type = 'success';
        else if (emoji === '❌') type = 'danger';
      }
      sections.push({ type: 'alert', alertType: type, content, delay: 0.2 + (sections.length * 0.1) });
    }
    remainingText = remainingText.replace(alertRegex, '').trim();

    // 5. Extract Block Sections (Comparison, Metrics, Timeline)
    const blockRegex = /## ([^\n]+)\n\n(.*?)(?=\n\n##|$)/gs;
    let blockMatch;
    while ((blockMatch = blockRegex.exec(remainingText)) !== null) {
      const title = blockMatch[1];
      const content = blockMatch[2].trim();
      const lowerTitle = title.toLowerCase();

      if (lowerTitle.includes('vs') || lowerTitle.includes('comparison')) {
        const leftMatch = content.match(/\*\*([^\*]+)\*\*\n(.*?)(?=\n\n\*\*|$)/s);
        const rightMatch = content.match(/(?<=\n\n|^)\*\*([^\*]+)\*\*\n(.*?)$/s);
        if (leftMatch && rightMatch) {
          sections.push({ type: 'comparison', left: { title: leftMatch[1], description: leftMatch[2].trim() }, right: { title: rightMatch[1], description: rightMatch[2].trim() }, delay: 0.4 });
          remainingText = remainingText.replace(blockMatch[0], '').trim();
          continue;
        }
      }

      if (lowerTitle.includes('metrics') || lowerTitle.includes('stats')) {
        const metrics = [];
        content.split('\n').forEach(line => {
          const m = line.match(/[-*•]?\s*\*\*([^*]+)\*\*:\s*(.+)/) || line.match(/[-*•]?\s*([^:]+):\s*(.+)/);
          if (m) metrics.push({ label: m[1], value: m[2] });
        });
        if (metrics.length > 0) {
          sections.push({ type: 'metrics', metrics, delay: 0.5 });
          remainingText = remainingText.replace(blockMatch[0], '').trim();
          continue;
        }
      }

      if (lowerTitle.includes('step') || lowerTitle.includes('timeline')) {
        const steps = [];
        content.split(/\n(?=\d+\. )/).forEach(block => {
          const m = block.match(/(\d+)\. \*\*([^*]+)\*\*[:\n]+(.*?)$/s) || block.match(/(\d+)\. ([^\n]+)\n+(.*?)$/s);
          if (m) steps.push({ title: m[2], description: m[3].trim() });
        });
        if (steps.length > 0) {
          sections.push({ type: 'timeline', steps, delay: 0.6 });
          remainingText = remainingText.replace(blockMatch[0], '').trim();
          continue;
        }
      }
    }

    // 6. Remaining Text as Main Content
    if (remainingText.length > 10) {
      sections.push({
        type: 'section',
        title: 'Analysis',
        content: remainingText,
        delay: 0.2
      });
    }
    return sections;
  };

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

  const renderSection = (section, index) => {
    let component = null;
    const commonProps = { key: `s-${index}`, delay: section.delay };

    switch (section.type) {
      case 'hero':
        component = <HeroSummary {...commonProps} title={section.title} tagline={section.tagline} badge={section.badge} />;
        break;
      case 'alert':
        component = <HighlightAlert {...commonProps} type={section.alertType}>{section.content}</HighlightAlert>;
        break;
      case 'comparison':
        component = <ComparisonCards {...commonProps} left={section.left} right={section.right} />;
        break;
      case 'metrics':
        component = <MetricCards {...commonProps} metrics={section.metrics} />;
        break;
      case 'timeline':
        component = <StepTimeline {...commonProps} steps={section.steps} />;
        break;
      case 'architecture':
        component = <ArchitectureDiagram {...commonProps} title={section.title} nodes={section.nodes} connections={section.connections} />;
        break;
      case 'location':
        component = <LocationMap {...commonProps} place={section.place} summary={section.summary} coordinates={section.coordinates} details={section.details} />;
        break;
      case 'gallery':
        component = <ImageGallery {...commonProps} query={section.query} images={section.images} />;
        break;
      case 'chart':
        component = <DataChart {...commonProps} title={section.title} data={section.data} chartType={section.chartType} library={section.library} />;
        break;
      case 'editor':
        component = <InteractiveEditor {...commonProps} language={section.language} signature={section.signature} questionNumber={section.questionNumber} totalQuestions={section.totalQuestions} onSubmit={onSubmitCode} />;
        break;
      case 'results':
        component = <ResultsChart {...commonProps} overallScore={section.overallScore} topicScores={section.topicScores} typeScores={section.typeScores} weakAreas={section.weakAreas} strongestTopic={section.strongestTopic} strongestType={section.strongestType} />;
        break;
      case 'mcq':
      case 'onboarding':
        component = <OnboardingCard {...commonProps} step={section.step} question={section.question} options={section.options} onSelect={onSubmitCode} totalSteps={4} />;
        break;
      case 'collapsible':
        component = <CollapsibleDetails {...commonProps} title={section.title} content={section.content} icon={section.icon} />;
        break;
      case 'section':
        component = <StructuredSection {...commonProps} title={section.title} content={section.content} />;
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
        {component}
      </motion.div>
    );
  };

  const sections = useMemo(() => parseResponse(response), [response]);

  return (
    <div className="structured-response-container">
      <motion.div 
        className="structured-response"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {sections.map((section, index) => renderSection(section, index))}
        
        <motion.div 
          className="structured-actions-bar"
          variants={blockVariants}
        >
          <button className="structured-action-btn" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Copied' : 'Copy Response'}</span>
          </button>
          <button className="structured-action-btn" onClick={handleExport}>
            <FileDown size={14} />
            <span>Export Document</span>
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default StructuredResponseRenderer;
