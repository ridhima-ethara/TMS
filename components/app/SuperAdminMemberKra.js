"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/appapi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Bell,
  Check,
  Clock3,
  Copy,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

const initials = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const dayKey = (date) => date.toISOString().slice(0, 10);
const statusStyle = {
  Completed: "bg-[#E4F5EE] text-[#0E6B47]",
  Partial: "bg-[#FDF3E0] text-[#8A5A06]",
  "Not submitted": "bg-[#FDECEC] text-[#A32D2D]",
  "Not Submitted": "bg-[#FDECEC] text-[#A32D2D]",
  Issue: "bg-[#FDECEC] text-[#A32D2D]",
  Late: "bg-[#FDECEC] text-[#A32D2D]",
};

function Summary({ lists, submissions }) {
  const today = dayKey(new Date());
  const todays = submissions.filter((submission) => submission.date === today);
  const totalTasks = lists.reduce((sum, list) => sum + list.items.length, 0);
  const doneTasks = todays.reduce(
    (sum, submission) => sum + (submission.done_count || 0),
    0,
  );
  const lastSeven = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - index);
    return dayKey(date);
  });
  const expected = lists.length * lastSeven.length;
  const submitted = submissions
    .filter((submission) => lastSeven.includes(submission.date))
    .reduce(
      (sum, submission) =>
        sum + (submission.total ? submission.done_count / submission.total : 0),
      0,
    );
  const compliance = expected ? Math.round((submitted / expected) * 100) : 0;
  const remaining = Math.max(0, new Date().setHours(19, 0, 0, 0) - Date.now());
  const remainingHours = Math.floor(remaining / 3600000);
  const remainingMinutes = Math.floor((remaining % 3600000) / 60000);
  return (
    <Card className="flex flex-wrap items-center gap-5 border-[#E5E9EF] px-4 py-4 shadow-none sm:gap-7 sm:px-5">
      <div className="min-w-[calc(50%-0.625rem)] sm:min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
          Today ·{" "}
          {new Date().toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
          })}
        </p>
        <p className="mt-1 text-xl font-bold">
          {todays.length}
          <span className="font-medium text-[#9CA3AF]">
            /{lists.length}
          </span>{" "}
          <span className="text-sm text-[#A32D2D]">submitted</span>
        </p>
      </div>
      <span className="hidden h-10 w-px bg-[#E5E9EF] sm:block" />
      <div className="w-full sm:w-auto">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
          Tasks completed today
        </p>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[#EDF0F4] sm:w-44 sm:flex-none">
            <div
              className="h-full bg-[#1E9E6A]"
              style={{
                width: `${totalTasks ? (doneTasks / totalTasks) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="text-sm font-semibold text-[#4B5563]">
            {doneTasks}/{totalTasks}
          </span>
        </div>
      </div>
      <span className="hidden h-10 w-px bg-[#E5E9EF] lg:block" />
      <div className="min-w-[calc(50%-0.625rem)] sm:min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
          7-day compliance
        </p>
        <p className="mt-1 text-xl font-bold">
          {compliance}%{" "}
          <span className="text-xs font-semibold text-[#8A5A06]">
            live average
          </span>
        </p>
      </div>
      <div className="w-full text-left sm:ml-auto sm:w-auto sm:text-right">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
          Cut-off
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-[#4B5563]">
          <Clock3 className="h-4 w-4" />
          7:00 PM ·{" "}
          {remaining ? `in ${remainingHours}h ${remainingMinutes}m` : "closed"}
        </p>
      </div>
    </Card>
  );
}

function Streak({ list, submissions }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return dayKey(date);
  });
  const records = days.map((day) =>
    submissions.find(
      (submission) =>
        submission.checklist_id === list.id && submission.date === day,
    ),
  );
  const completed = records.reduce(
    (sum, record) =>
      sum +
      (record?.status === "Completed"
        ? 1
        : record?.status === "Partial"
          ? 0.5
          : 0),
    0,
  );
  return (
    <>
      <div className="flex gap-1">
        {records.map((record, index) => (
          <span
            key={days[index]}
            title={`${days[index]}: ${record?.status || "Missed"}`}
            className={`h-3 w-3 rounded-[3px] ${index === 6 && !record ? (list.overdue ? "bg-[#DC3D3D]" : "bg-[#EDF0F4]") : record?.status === "Completed" ? "bg-[#1E9E6A]" : record?.status === "Partial" ? "bg-[#E8930C]" : "bg-[#DC3D3D]"}`}
          />
        ))}
      </div>
      <span className="text-xs font-semibold text-[#4B5563]">
        {Math.round((completed / 7) * 100)}%
      </span>
    </>
  );
}

function KraCard({ list, member, submissions, onEdit, onDelete, onDuplicate }) {
  const todaySubmission = submissions.find(
    (submission) =>
      submission.checklist_id === list.id &&
      submission.date === dayKey(new Date()),
  );
  const status = list.today_status || todaySubmission?.status || "Not submitted";
  const done = todaySubmission?.done_count || 0;
  const avatar = list.member_role === "it" ? "bg-[#2E7CD6]" : "bg-[#6C5CE7]";
  return (
    <Card className="border-[#E5E9EF] p-5 shadow-none transition hover:shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`grid h-10 w-10 place-items-center rounded-full text-xs font-semibold text-white ${avatar}`}
        >
          {initials(list.member_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">
            {list.title}{" "}
            <span className="font-medium text-[#9CA3AF]">
              · {list.member_name}
            </span>
          </p>
          <p className="text-xs text-[#9CA3AF]">
            {member?.location || "Location not set"}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle[status] || statusStyle.Partial}`}
        >
          {status}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          title="Edit checklist"
          onClick={() => onEdit(list)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          title="Duplicate checklist"
          onClick={() => onDuplicate(list)}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 text-red-600"
          title="Delete checklist"
          onClick={() => onDelete(list.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-4 space-y-2">
        {list.items.map((item) => {
          const response = todaySubmission?.responses?.find(
            (entry) => entry.item === item.label,
          );
          return (
            <div
              key={item.key}
              className="flex items-center gap-2 text-sm text-[#4B5563]"
            >
              <span
                className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border ${response?.done ? "border-[#1E9E6A] bg-[#1E9E6A] text-white" : "border-[#C9D1DB]"}`}
              >
                {response?.done && <Check className="h-3 w-3" />}
              </span>
              {item.label}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#E5E9EF] pt-3">
        <span className="text-xs text-[#9CA3AF]">Last 7 days</span>
        <Streak list={list} submissions={submissions} />
        <span className="ml-auto text-xs text-[#9CA3AF]">
          {done}/{list.items.length} tasks today
        </span>
      </div>
    </Card>
  );
}

// Super Admin edits an existing member KRA. The member it belongs to is fixed
// here — reassigning would be a different checklist, so only the title,
// schedule, location and task list are editable.
function EditChecklist({ list, locations, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: list?.title || "",
    items: (list?.items || []).map((item) => item.label),
    repeat: list?.frequency || "Daily",
    location: list?.location || "",
    active: list?.active !== false,
  });
  const [newTask, setNewTask] = useState("");
  const [busy, setBusy] = useState(false);

  const addTask = () => {
    const label = newTask.trim();
    if (!label) return;
    setForm((current) => ({ ...current, items: [...current.items, label] }));
    setNewTask("");
  };
  const updateTask = (index, value) =>
    setForm((current) => ({
      ...current,
      items: current.items.map((item, i) => (i === index ? value : item)),
    }));
  const removeTask = (index) =>
    setForm((current) => ({
      ...current,
      items: current.items.filter((_, i) => i !== index),
    }));

  const save = async () => {
    const items = form.items.map((item) => item.trim()).filter(Boolean);
    if (!form.title.trim()) return toast.error("Title is required");
    if (!items.length) return toast.error("Add at least one daily work item");
    setBusy(true);
    try {
      await api(`/member-checklists/${list.id}`, {
        method: "PATCH",
        body: {
          title: form.title.trim(),
          items,
          frequency: form.repeat,
          location: form.location,
          active: form.active,
        },
      });
      toast.success(`Updated ${list.member_name}'s KRA`);
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(list)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[640px] overflow-y-auto rounded-2xl sm:max-h-[92vh]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            Edit daily KRA
          </DialogTitle>
          <p className="mt-1 text-sm text-[#9CA3AF]">
            {list?.member_name} ·{" "}
            {list?.member_role === "it" ? "IT team" : "Admin team"}
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Checklist title</Label>
            <Input
              className="mt-1 h-11"
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
              placeholder="Daily Checklist"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Repeats</Label>
              <Select
                value={form.repeat}
                onValueChange={(value) => setForm({ ...form, repeat: value })}
              >
                <SelectTrigger className="mt-1 h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Daily">Daily</SelectItem>
                  <SelectItem value="Weekdays">Weekdays</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Location</Label>
              <Select
                value={form.location || "none"}
                onValueChange={(value) =>
                  setForm({ ...form, location: value === "none" ? "" : value })
                }
              >
                <SelectTrigger className="mt-1 h-11">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {locations.map((location) => (
                    <SelectItem key={location.name} value={location.name}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <Label className="text-xs">
                Daily tasks{" "}
                <span className="text-[#9CA3AF]">({form.items.length})</span>
              </Label>
              <button
                type="button"
                onClick={() => setForm({ ...form, active: !form.active })}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${form.active ? "bg-[#E4F5EE] text-[#0E6B47]" : "bg-[#EDF0F4] text-[#6B7280]"}`}
              >
                {form.active ? "Active" : "Paused"}
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {form.items.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    className="h-10"
                    value={item}
                    onChange={(event) => updateTask(index, event.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0 text-red-600"
                    title="Remove task"
                    onClick={() => removeTask(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {!form.items.length && (
                <p className="rounded-lg bg-[#FAFBFC] px-3 py-4 text-center text-xs text-[#9CA3AF]">
                  No tasks yet — add at least one below.
                </p>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input
                className="h-10"
                value={newTask}
                onChange={(event) => setNewTask(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTask();
                  }
                }}
                placeholder="Add a daily task and press Enter"
              />
              <Button
                variant="outline"
                className="h-10 shrink-0"
                onClick={addTask}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignChecklist({ members, lists, locations, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    member_id: "",
    title: "",
    items: [],
    repeat: "Daily",
    cutoff: "19:00",
    location: "",
  });
  const [newTask, setNewTask] = useState("");
  const [importing, setImporting] = useState(false);
  const [importedFile, setImportedFile] = useState("");
  const templates = {
    support: [
      "Review assigned tickets",
      "Update pending ticket notes",
      "Check SLA breaches",
    ],
    operations: [
      "Review daily requests",
      "Complete scheduled follow-ups",
      "Share end-of-day update",
    ],
  };
  const selectedHasKra = lists.some(
    (list) => list.member_id === form.member_id,
  );
  const submit = async () => {
    const items = form.items.map((item) => item.trim()).filter(Boolean);
    if (!form.member_id || !form.title || !items.length)
      return toast.error("Member, title and at least one task are required");
    try {
      await api("/member-checklists", {
        method: "POST",
        body: {
          member_id: form.member_id,
          title: form.title,
          items,
          repeat: form.repeat,
          cutoff: form.cutoff,
          location: form.location,
        },
      });
      toast.success("Checklist assigned");
      setOpen(false);
      setImportedFile("");
      setForm({
        member_id: "",
        title: "",
        items: [],
        repeat: "Daily",
        cutoff: "19:00",
        location: "",
      });
      onCreated();
    } catch (error) {
      toast.error(error.message);
    }
  };
  const importSpreadsheet = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    setImporting(true);
    try {
      const result = await api("/member-checklists/import-preview", {
        method: "POST",
        body: data,
        timeout: 30000,
      });
      setForm((current) => ({
        ...current,
        title:
          current.title ||
          file.name.replace(/\.(xlsx|csv)$/i, "").replace(/[_-]+/g, " "),
        items: result.items,
      }));
      setImportedFile(file.name);
      toast.success(`${result.rows_imported} daily work items imported`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setImporting(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#131C26] hover:bg-[#1C2836]">
          <Plus className="h-4 w-4" />
          Assign checklist
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign daily checklist</DialogTitle>
          <p className="text-sm text-[#6B7280]">
            Create a recurring KRA checklist for a team member.
          </p>
        </DialogHeader>
        <div className="space-y-5">
          <div>
            <Label>Choose member</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {members.map((member) => {
                const hasKra = lists.some(
                  (list) => list.member_id === member.id,
                );
                return (
                  <button
                    type="button"
                    key={member.id}
                    onClick={() =>
                      setForm({
                        ...form,
                        member_id: member.id,
                        location: member.location || form.location,
                      })
                    }
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left ${form.member_id === member.id ? "border-[#6C5CE7] bg-[#FAF9FF] ring-1 ring-[#6C5CE7]" : "border-[#E5E9EF]"}`}
                  >
                    <span
                      className={`grid h-9 w-9 place-items-center rounded-full text-xs font-semibold text-white ${member.role === "it" ? "bg-[#2E7CD6]" : "bg-[#1B7F6E]"}`}
                    >
                      {initials(member.name)}
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-semibold">
                        {member.name}
                      </span>
                      <span className="block text-xs text-[#9CA3AF]">
                        {member.role === "it" ? "IT team" : "Admin team"}
                      </span>
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-semibold ${hasKra ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}
                    >
                      {hasKra ? "Has KRA" : "No KRA"}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedHasKra && (
              <div className="mt-2 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                This member already has a KRA. This will add another checklist.
              </div>
            )}
          </div>
          <div>
            <Label>Location</Label>
            <Select
              value={form.location}
              onValueChange={(value) => setForm({ ...form, location: value })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((location) => (
                  <SelectItem key={location.name} value={location.name}>
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-[#9CA3AF]">
              The selected member&apos;s saved location is filled automatically.
            </p>
          </div>
          <div>
            <Label>Checklist title</Label>
            <Input
              className="mt-1"
              placeholder="e.g. Daily support responsibilities"
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
            />
          </div>
          <div>
            <Label>Start from a template</Label>
            <Select
              onValueChange={(value) =>
                setForm({ ...form, items: templates[value] })
              }
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select a template (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="support">Ticket support</SelectItem>
                <SelectItem value="operations">Daily operations</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-xl border border-dashed border-[#CFC8F8] bg-[#FAF9FF] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#ECE9FF] text-[#6C5CE7]">
                <FileSpreadsheet className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Import daily work from Excel</p>
                <p className="text-xs text-[#9CA3AF]">
                  Upload .xlsx or .csv with a Task, Daily Work, Activity or Responsibility column.
                </p>
                {importedFile && (
                  <p className="mt-1 truncate text-xs font-medium text-[#6C5CE7]">
                    {importedFile} · {form.items.length} items populated below
                  </p>
                )}
              </div>
              <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border bg-white px-3 text-xs font-semibold shadow-sm hover:bg-[#F7F7FA]">
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                {importing ? "Reading…" : "Choose sheet"}
                <input
                  type="file"
                  className="sr-only"
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  disabled={importing}
                  onChange={importSpreadsheet}
                />
              </label>
            </div>
          </div>
          <div>
            <Label>Tasks</Label>
            <div className="mt-2 space-y-2">
              {form.items.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={item}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        items: form.items.map((task, taskIndex) =>
                          taskIndex === index ? event.target.value : task,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-red-600"
                    onClick={() =>
                      setForm({
                        ...form,
                        items: form.items.filter(
                          (_, taskIndex) => taskIndex !== index,
                        ),
                      })
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Add another task"
                value={newTask}
                onChange={(event) => setNewTask(event.target.value)}
              />
              <Button
                className="w-full sm:w-auto"
                variant="outline"
                disabled={!newTask.trim()}
                onClick={() => {
                  setForm({ ...form, items: [...form.items, newTask.trim()] });
                  setNewTask("");
                }}
              >
                <Plus className="h-4 w-4" />
                Add task
              </Button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Repeats</Label>
              <Select
                value={form.repeat}
                onValueChange={(value) => setForm({ ...form, repeat: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Daily">Every day</SelectItem>
                  <SelectItem value="Weekdays">Weekdays only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Daily cut-off</Label>
              <div className="mt-1 rounded-md border bg-[#FAFBFC] px-3 py-2">
                <p className="text-sm font-semibold">7:00 PM</p>
                <p className="text-[10px] text-[#9CA3AF]">
                  Incomplete work is marked red and escalated after cut-off.
                </p>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Assign checklist</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SuperAdminMemberKra() {
  const [members, setMembers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [lists, setLists] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [mode, setMode] = useState("define");
  const [team, setTeam] = useState("all");
  const [editing, setEditing] = useState(null);
  const load = () =>
    Promise.all([
      api("/users"),
      api("/member-checklists"),
      api("/member-checklist-submissions"),
      api("/locations"),
    ])
      .then(([users, checklists, records, availableLocations]) => {
        setMembers(users.filter((user) => ["it", "admin"].includes(user.role)));
        setLists(checklists);
        setSubmissions(records);
        setLocations(availableLocations);
      })
      .catch((error) => toast.error(error.message));
  useEffect(() => {
    load();
  }, []);
  const visible = lists.filter(
    (list) => team === "all" || list.member_role === team,
  );
  const del = async (id) => {
    try {
      await api(`/member-checklists/${id}`, { method: "DELETE" });
      toast.success("Checklist deleted");
      load();
    } catch (error) {
      toast.error(error.message);
    }
  };
  const duplicate = async (list) => {
    try {
      await api("/member-checklists", {
        method: "POST",
        body: {
          member_id: list.member_id,
          title: `${list.title} copy`,
          items: list.items.map((item) => item.label),
        },
      });
      toast.success("Checklist duplicated");
      load();
    } catch (error) {
      toast.error(error.message);
    }
  };
  const pending = lists.filter(
    (list) =>
      !submissions.some(
        (submission) =>
          submission.checklist_id === list.id &&
          submission.date === dayKey(new Date()),
      ),
  ).length;
  const remindPending = async () => {
    try {
      const result = await api("/member-checklists/remind-pending", {
        method: "POST",
      });
      toast.success(
        `Reminder sent to ${result.reminded} pending member${result.reminded === 1 ? "" : "s"}`,
      );
    } catch (error) {
      toast.error(error.message);
    }
  };
  return (
    <div className="space-y-5 text-[#111827]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-full overflow-x-auto rounded-lg bg-[#EDF0F4] p-1 sm:w-auto">
          <button
            onClick={() => setMode("define")}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${mode === "define" ? "bg-white shadow-sm" : "text-[#4B5563]"}`}
          >
            Define checklists
          </button>
          <button
            onClick={() => setMode("tracking")}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${mode === "tracking" ? "bg-white shadow-sm" : "text-[#4B5563]"}`}
          >
            Submission tracking
          </button>
        </div>
        <Select value={team} onValueChange={setTeam}>
          <SelectTrigger className="w-full bg-white sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teams</SelectItem>
            <SelectItem value="it">IT team</SelectItem>
            <SelectItem value="admin">Admin team</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="w-full sm:ml-auto sm:w-auto"
          disabled={!pending}
          onClick={remindPending}
        >
          <Bell className="h-4 w-4" />
          Remind pending ({pending})
        </Button>
        <AssignChecklist
          members={members}
          lists={lists}
          locations={locations}
          onCreated={load}
        />
      </div>
      <Summary lists={visible} submissions={submissions} />
      {mode === "define" ? (
        ["it", "admin"]
          .filter((role) => team === "all" || team === role)
          .map((role) => {
            const roleLists = visible.filter(
              (list) => list.member_role === role,
            );
            return (
              <section key={role}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  {role === "it" ? "IT" : "Admin"} team · {roleLists.length}{" "}
                  members
                </p>
                <div className="grid gap-4 xl:grid-cols-2">
                  {roleLists.map((list) => (
                    <KraCard
                      key={list.id}
                      list={list}
                      member={members.find(
                        (member) => member.id === list.member_id,
                      )}
                      submissions={submissions}
                      onEdit={setEditing}
                      onDelete={del}
                      onDuplicate={duplicate}
                    />
                  ))}
                </div>
                {!roleLists.length && (
                  <Card className="border-dashed p-8 text-center text-sm text-[#9CA3AF] shadow-none">
                    No checklists assigned.
                  </Card>
                )}
              </section>
            );
          })
      ) : (
        <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Checklist</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions
                  .filter((submission) => {
                    const list = lists.find(
                      (item) => item.id === submission.checklist_id,
                    );
                    return team === "all" || list?.member_role === team;
                  })
                  .map((submission) => {
                    const list = lists.find(
                      (item) => item.id === submission.checklist_id,
                    );
                    return (
                      <TableRow key={submission.id}>
                        <TableCell>{submission.date}</TableCell>
                        <TableCell className="font-medium">
                          {submission.member_name}
                        </TableCell>
                        <TableCell className="capitalize">
                          {list?.member_role || "—"}
                        </TableCell>
                        <TableCell>{submission.checklist_title}</TableCell>
                        <TableCell>
                          {submission.done_count}/{submission.total}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle[submission.status] || statusStyle.Partial}`}
                          >
                            {submission.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      {editing && (
        <EditChecklist
          list={editing}
          locations={locations}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
