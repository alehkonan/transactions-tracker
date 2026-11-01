import { FileTextIcon, XIcon } from "lucide-react";
import { type DragEvent, useId, useRef, useState } from "react";
import { twJoin } from "tailwind-merge";

type Props = {
  file?: File | null;
  onFileChange: (file: File | null) => void;
  accept?: string;
  inputTestId?: string;
};

/**
 * Whether a dropped file satisfies the `accept` string. The native file picker
 * already enforces `accept`, but drag-and-drop bypasses it, so we re-check here.
 */
function isAccepted(file: File, accept: string) {
  return accept.split(",").some((token) => {
    const type = token.trim();
    if (!type) return true;
    if (type.startsWith(".")) return file.name.toLowerCase().endsWith(type.toLowerCase());
    if (type.endsWith("/*")) return file.type.startsWith(type.slice(0, -1));
    return file.type === type;
  });
}

export function FileInput({
  file = null,
  onFileChange,
  accept = ".csv,text/csv",
  inputTestId,
}: Props) {
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
      <div className="flex items-center gap-3">
        <FileTextIcon aria-hidden="true" className="text-text-muted size-5 shrink-0" />
        <span className="min-w-0 flex-1 wrap-anywhere">{file.name}</span>
        <button
          type="button"
          aria-label="Remove file"
          onClick={clear}
          data-testid="import-remove-file"
          className="text-text-muted hover:bg-surface-active hover:text-text focus-visible:ring-accent grid size-11 shrink-0 place-items-center rounded-lg focus-visible:ring-2 focus-visible:outline-none"
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
      className={twJoin("rounded-lg", isDragging && "bg-surface-active")}
    >
      <label
        htmlFor={inputId}
        className={twJoin("flex flex-col gap-2", isDragging ? "text-text" : "text-text-muted")}
      >
        <span className="text-text text-sm">
          CSV file
          <span className="text-text-muted hidden sm:inline"> · You can also drag it here</span>
        </span>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          data-testid={inputTestId}
          accept={accept}
          className="text-text focus-visible:ring-accent file:border-border file:bg-surface file:text-text min-h-11 w-full min-w-0 text-base file:mr-3 file:min-h-11 file:rounded-lg file:border file:px-3 focus-visible:ring-2 focus-visible:outline-none"
          onChange={(e) => selectFile(e.target.files)}
        />
      </label>
    </div>
  );
}
