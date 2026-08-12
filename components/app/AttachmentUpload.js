"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/appapi";
import { Button } from "@/components/ui/button";
import { Download, FileText, Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.doc,.docx";
const MAX_FILES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_SIZE = 25 * 1024 * 1024;

const formatSize = (bytes = 0) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function AttachmentList({ attachments = [], removable = false, onRemove }) {
  if (!attachments.length) return null;
  return (
    <div className="space-y-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex min-w-0 items-center gap-3 rounded-lg border bg-white px-3 py-2"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{attachment.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {formatSize(attachment.size)}
              {attachment.uploaded_by_name
                ? ` · ${attachment.uploaded_by_name}`
                : ""}
            </p>
          </div>
          <Button variant="ghost" size="icon" asChild title="Download file">
            <a href={attachment.url || `/api/attachments/${attachment.id}`}>
              <Download className="h-4 w-4" />
            </a>
          </Button>
          {removable && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-red-600"
              onClick={() => onRemove?.(attachment)}
              title="Remove pending file"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AttachmentUpload({ value = [], onChange, disabled = false }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (event) => {
    const selected = [...(event.target.files || [])];
    event.target.value = "";
    if (!selected.length) return;
    if (value.length + selected.length > MAX_FILES)
      return toast.error(`You can attach up to ${MAX_FILES} files`);
    if (selected.some((file) => file.size > MAX_FILE_SIZE))
      return toast.error("Each file must be 5 MB or smaller");
    const total = [...value, ...selected].reduce(
      (sum, file) => sum + Number(file.size || 0),
      0,
    );
    if (total > MAX_TOTAL_SIZE)
      return toast.error("Combined attachments must not exceed 25 MB");
    const form = new FormData();
    selected.forEach((file) => form.append("files", file));
    setUploading(true);
    try {
      const result = await api("/attachments", {
        method: "POST",
        body: form,
        timeout: 60_000,
      });
      onChange?.([...value, ...(result.attachments || [])]);
      toast.success(`${result.attachments?.length || 0} file(s) uploaded`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (attachment) => {
    try {
      await api(`/attachments/${attachment.id}`, { method: "DELETE" });
      onChange?.(value.filter((item) => item.id !== attachment.id));
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={disabled || uploading || value.length >= MAX_FILES}
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#C9D0DA] bg-[#FAFBFC] p-4 text-sm font-medium text-[#69738B] transition hover:border-[#4A5FE8] hover:bg-[#F6F7FF] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Paperclip className="h-4 w-4" />
        )}
        {uploading
          ? "Uploading and validating…"
          : "Add PDF, JPEG, PNG, DOC or DOCX files"}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED}
        className="hidden"
        onChange={upload}
      />
      <p className="text-[11px] text-muted-foreground">
        Up to 10 files · 5 MB each · 25 MB combined. Files are signature-checked
        and access-controlled.
      </p>
      <AttachmentList attachments={value} removable onRemove={remove} />
    </div>
  );
}
