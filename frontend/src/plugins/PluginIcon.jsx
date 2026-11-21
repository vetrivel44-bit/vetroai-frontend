import React from "react";
import {
  BarChart3, Bug, BriefcaseBusiness, Calendar, ChartColumn, CloudSun, Coins, Database, FileSearch, FileText,
  FileType2, FileUser, GitBranch, GitPullRequest, Globe2, GraduationCap, Handshake, HelpCircle, Image,
  Languages, Layers, Lightbulb, ListChecks, Mail, MapPinned, Megaphone, Newspaper, NotebookPen, PenLine,
  Presentation, Puzzle, Regex, Scale, ScrollText, Sheet, SpellCheck, Table2, TerminalSquare, TrendingUp,
  Trophy, Users, Wallet,
} from "lucide-react";

// The catalog names each plugin's icon with a word (plugins/catalog.js).
const ICONS = {
  globe: Globe2, report: ScrollText, file: FileSearch, calendar: Calendar, mail: Mail, notes: NotebookPen,
  check: ListChecks, terminal: TerminalSquare, review: GitPullRequest, bug: Bug, git: GitBranch,
  database: Database, regex: Regex, doc: FileText, sheet: Sheet, slides: Presentation, pdf: FileType2,
  chart: BarChart3, bars: ChartColumn, table: Table2, trophy: Trophy, weather: CloudSun, news: Newspaper,
  trend: TrendingUp, currency: Coins, spell: SpellCheck, translate: Languages, pen: PenLine,
  resume: FileUser, study: GraduationCap, cards: Layers, quiz: HelpCircle, bulb: Lightbulb, image: Image,
  map: MapPinned, briefcase: BriefcaseBusiness, handshake: Handshake, megaphone: Megaphone, scale: Scale,
  wallet: Wallet, people: Users,
};

/** A plugin's icon on a soft tile of its colour. */
export default function PluginIcon({ plugin, size = 18, className = "plugin-icon" }) {
  const Icon = ICONS[plugin?.icon] || Puzzle;
  return (
    <span className={className} style={{ "--plugin-color": plugin?.color || "#64748b" }} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}
