import { FileTextIcon, UploadCloudIcon, XIcon } from "lucide-react";
import { type DragEvent, useId, useRef, useState } from "react";
import { twJoin } from "tailwind-merge";

type Props = {
  file: File | null;
  onFileChange: (file: File | null) => void;
  accept?: string;
};

// Whether a dropped file satisfies the `accept` string. The native file picker
// already enforces `accept`, but drag-and-drop bypasses it, so we re-check here.
function isAccepted(file: File, accept: string) {
  return accept.split(",").some((token) => {
    const type = token.trim();
    if (!type) return true;
    if (type.startsWith(".")) return file.name.toLowerCase().endsWith(type.toLowerCase());
    if (type.endsWith("/*")) return file.type.startsWith(type.slice(0, -1));
    return file.type === type;
  });
}

export function FileInput({ file, onFileChange, accept = "text/csv" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);

  function selectFile(files: FileList | null) {
    const next = files?.[0] ?? null;
    onFileChange(next && isAccepted(next, accept) ? next : null);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    selectFile(e.dataTransfer.files);
  }

  function clear() {
    onFileChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  if (file) {
    return (
      <div className="border-border bg-surface-muted flex items-center gap-3 rounded-xl border p-4">
        <FileTextIcon className="text-accent shrink-0" />
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <button
          type="button"
          aria-label="Remove file"
          onClick={clear}
          className="text-text-muted hover:text-text cursor-default"
        >
          <XIcon />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={twJoin(
        "rounded-xl border border-dashed transition-colors",
        isDragging ? "border-accent bg-accent-muted/30" : "border-border",
      )}
    >
      <label
        htmlFor={inputId}
        className={twJoin(
          "flex cursor-default flex-col items-center gap-2 p-8 text-center",
          isDragging ? "text-text" : "text-text-muted",
        )}
      >
        <UploadCloudIcon className="size-8" />
        <span>
          <span className="text-accent">Choose a file</span> or drag it here
        </span>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => selectFile(e.target.files)}
        />
      </label>
    </div>
  );
}
