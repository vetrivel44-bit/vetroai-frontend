import { Copy, FileSpreadsheet, FolderInput, Image as ImageIcon } from "lucide-react";

// The one-tap folder tools in VetroAI Computer (see components/screens/FolderTools.jsx).
export const FOLDER_ACTIONS = [
  { id: "organize", icon: FolderInput, title: "Sort into folders", detail: "Images, Documents, Videos… by kind", prompt: "Sort the loose files in this folder into folders by kind." },
  { id: "photos", icon: ImageIcon, title: "Rename photos by date", detail: "2024-03-15 14.22.07.jpg — the date taken", prompt: "Rename my photos to the date and time they were taken." },
  { id: "duplicates", icon: Copy, title: "Find duplicates", detail: "Identical files, by their contents", prompt: "Find files that are exact duplicates and set the extra copies aside." },
  { id: "summarize", icon: FileSpreadsheet, title: "Summarise documents", detail: "PDFs and Word files → one spreadsheet", prompt: "Summarise every document in this folder into a spreadsheet." },
];
