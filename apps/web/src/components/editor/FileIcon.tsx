import type { LucideIcon } from "lucide-react";
import {
  FileCode2,
  ScrollText,
  Library,
  Layers,
  Puzzle,
  BookMarked,
  FileImage,
  Spline,
  FileOutput,
  Table2,
  Shapes,
  File,
} from "lucide-react";

/* Shape carries the meaning, never hue: source (.tex) is the only icon with
   angle brackets, raster art is a picture frame, vector art is a curve,
   bibliography is a book, compiled output is an export arrow. */
export const fileIconMapping: Record<string, LucideIcon> = {
  ".tex": FileCode2,
  ".cls": Layers,
  ".sty": Puzzle,
  ".bib": Library,
  ".bst": BookMarked,
  ".png": FileImage,
  ".jpg": FileImage,
  ".jpeg": FileImage,
  ".gif": FileImage,
  ".svg": Spline,
  ".pdf": FileOutput,
  ".eps": FileOutput,
  ".ps": FileOutput,
  ".txt": ScrollText,
  ".md": ScrollText,
  ".log": ScrollText,
  ".csv": Table2,
  ".dat": Table2,
  ".tikz": Shapes,
  ".pgf": Shapes,
};

interface FileIconProps {
  extension: string;
  className: string | undefined;
}

export default function FileIcon({ extension, className }: FileIconProps) {
  const trimmed = extension.trim().toLowerCase();
  const ext = trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
  const IconComponent = fileIconMapping[ext] ?? File;
  return <IconComponent className={className} strokeWidth={1.75} aria-hidden />;
}
